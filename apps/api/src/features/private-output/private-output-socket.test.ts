import { DatabaseSync } from "node:sqlite";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivateOutputSocket } from "./private-output-socket.js";
import { PrivateOutputUnavailable } from "./private-output.contract.js";
import type {
  OutputLifecyclePort,
  OutputRegistration,
} from "./private-output.contract.js";
import { privateOutputGeneration } from "./private-output.database-schema.js";

const connections: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const connection of connections.splice(0)) {
    connection.close();
  }
});

const socket = (generation: string | null, readyState = 1) => {
  const connection = {
    close: vi.fn(),
    deserializeAttachment: () => ({ generation }),
    readyState,
    send: vi.fn(),
  };
  connection.close.mockImplementation(() => {
    connection.readyState = 2;
  });
  return connection;
};
const renewal = () => {
  throw new Error("Wake must not create new authority");
};
const wakeEnvironment = {
  AccountOutputLifecycle: { getByName: renewal },
  HouseholdAgent: { getByName: renewal },
};
const fixture = (
  status: typeof privateOutputGeneration.$inferInsert.status = "connected",
  expiresAt = Date.now() + 60_000,
  environment: ConstructorParameters<
    typeof PrivateOutputSocket
  >[2] = wakeEnvironment
) => {
  const sqlite = new DatabaseSync(":memory:");
  connections.push(sqlite);
  sqlite.exec(`CREATE TABLE private_output_generation (
    singleton INTEGER PRIMARY KEY, generation TEXT NOT NULL,
    status TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`);
  const database = drizzle({ client: sqlite });
  const generation = crypto.randomUUID();
  database
    .insert(privateOutputGeneration)
    .values({
      expiresAt,
      generation,
      singleton: status === "pending_request" || status === "request" ? 2 : 1,
      status,
    })
    .run();
  const sockets: ReturnType<typeof socket>[] = [];
  const output = new PrivateOutputSocket(
    {
      acceptWebSocket: () => {
        throw new Error("Wake must not create a new socket");
      },
      getWebSockets: () => sockets,
    },
    database,
    environment
  );
  return { database, generation, output, sockets };
};

describe("private output on native wake", () => {
  it("preserves the existing unexpired grant of a surviving OPEN native socket", () => {
    const { generation, output, sockets } = fixture();
    const current = socket(generation);
    sockets.push(current);
    output.restart();
    expect(output.isCurrent(generation)).toBe(true);
    output.send(generation, "authorized private message");
    expect(current.close).not.toHaveBeenCalled();
    expect(current.send).toHaveBeenCalledWith("authorized private message");
  });

  it.each(["invalidated", "pending", "authorized"] as const)(
    "never promotes a %s grant on wake",
    (status) => {
      const { generation, output, sockets } = fixture(status);
      const retained = socket(generation);
      sockets.push(retained);
      output.restart();
      output.send(generation, "must not escape");
      expect(output.isCurrent(generation)).toBe(false);
      expect(retained.close).toHaveBeenCalledWith(
        1008,
        "Reauthentication required"
      );
      expect(retained.send).not.toHaveBeenCalled();
    }
  );

  it("closes an expired grant even with a surviving native socket", () => {
    const { generation, output, sockets } = fixture(
      "connected",
      Date.now() - 1
    );
    const retained = socket(generation);
    sockets.push(retained);
    output.restart();
    expect(output.isCurrent(generation)).toBe(false);
    expect(retained.close).toHaveBeenCalled();
  });

  it("requires fresh admission after transport loss", () => {
    const { generation, output } = fixture();
    output.restart();
    expect(output.isCurrent(generation)).toBe(false);
  });

  it("closes stale or malformed attachments while preserving the current live socket", () => {
    const { generation, output, sockets } = fixture();
    const current = socket(generation);
    const stale = socket(crypto.randomUUID());
    const malformed = socket(null);
    const closing = socket(generation, 2);
    sockets.push(current, stale, malformed, closing);
    output.restart();
    expect(output.isCurrent(generation)).toBe(true);
    expect(current.close).not.toHaveBeenCalled();
    output.send(generation, "only the current socket receives this");
    expect(current.send).toHaveBeenCalledOnce();
    for (const rejected of [stale, malformed, closing]) {
      expect(rejected.close).toHaveBeenCalled();
      expect(rejected.send).not.toHaveBeenCalled();
    }
  });

  it("does not revive a grant explicitly revoked before a later wake", () => {
    const { generation, output, sockets } = fixture();
    const retained = socket(generation);
    sockets.push(retained);
    output.invalidate({ generation });
    output.restart();
    output.send(generation, "must not escape");
    expect(output.isCurrent(generation)).toBe(false);
    expect(retained.send).not.toHaveBeenCalled();
  });
});

const participant = {
  accountKey: "a".repeat(64),
  householdKey: "b".repeat(64),
  linkageSubject: "participant",
  personId: "person",
};
const target = { childName: "c".repeat(64), targetKind: "session" } as const;
const requestFixture = (
  register: OutputLifecyclePort["register"] = () => Promise.resolve(true),
  status: typeof privateOutputGeneration.$inferInsert.status = "invalidated",
  expiresAt = 0
) => {
  const accounts: OutputRegistration[] = [];
  const households: OutputRegistration[] = [];
  const lifecycle = (
    registrations: OutputRegistration[]
  ): OutputLifecyclePort => ({
    beginMutation: renewal,
    completeMutation: renewal,
    findPendingMutation: renewal,
    markDispatched: renewal,
    prepareMutation: renewal,
    readMutation: renewal,
    register: (registration) => {
      registrations.push(registration);
      return register(registration);
    },
  });
  const state = fixture(status, expiresAt, {
    AccountOutputLifecycle: { getByName: () => lifecycle(accounts) },
    HouseholdAgent: { getByName: () => lifecycle(households) },
  });
  return { ...state, accounts, households };
};

describe("private output request leases", () => {
  it("registers with both native lifecycles without granting authority or creating a socket", async () => {
    const { accounts, households, output, sockets } = requestFixture();
    const generation = await output.beginRequest(participant, target);
    expect(accounts).toEqual([{ ...target, generation }]);
    expect(households).toEqual(accounts);
    expect(output.readRequest()?.status).toBe("pending_request");
    expect(output.isCurrent(generation)).toBe(false);
    expect(output.isRequestCurrent(generation)).toBe(false);
    expect(sockets).toEqual([]);

    output.authorizeRequest(generation, Date.now() + 60_000);
    expect(output.isCurrent(generation)).toBe(true);
    expect(output.isRequestCurrent(generation)).toBe(true);
  });

  it("reuses and renews only the current live request grant", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const { accounts, households, output } = requestFixture();
    const generation = await output.beginRequest(participant, target);
    output.authorizeRequest(generation, 2000);
    now.mockReturnValue(1500);
    expect(await output.beginRequest(participant, target)).toBe(generation);
    output.authorizeRequest(generation, 3000);
    now.mockReturnValue(2500);
    expect(output.isRequestCurrent(generation)).toBe(true);
    expect(accounts).toHaveLength(1);
    expect(households).toHaveLength(1);
    now.mockReturnValue(3000);
    expect(output.isCurrent(generation)).toBe(false);
    expect(output.isRequestCurrent(generation)).toBe(false);
  });

  it("requires a newly registered generation after request expiry", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const { accounts, output } = requestFixture();
    const expired = await output.beginRequest(participant, target);
    output.authorizeRequest(expired, 2000);
    now.mockReturnValue(2000);
    expect(() => output.authorizeRequest(expired, 3000)).toThrow(
      new PrivateOutputUnavailable({ reason: "output_disabled" })
    );
    const current = await output.beginRequest(participant, target);
    expect(current).not.toBe(expired);
    expect(accounts).toHaveLength(2);
    expect(output.isCurrent(current)).toBe(false);
    output.authorizeRequest(current, 3000);
    expect(output.isRequestCurrent(current)).toBe(true);
    expect(output.isCurrent(expired)).toBe(false);
  });

  it("cannot renew an invalidated generation or use it after replacement", async () => {
    const { output } = requestFixture();
    const invalidated = await output.beginRequest(participant, target);
    output.authorizeRequest(invalidated, Date.now() + 60_000);
    output.invalidate({ generation: invalidated });
    expect(() =>
      output.authorizeRequest(invalidated, Date.now() + 60_000)
    ).toThrow(new PrivateOutputUnavailable({ reason: "output_disabled" }));
    expect(output.isCurrent(invalidated)).toBe(false);
    const current = await output.beginRequest(participant, target);
    output.authorizeRequest(current, Date.now() + 60_000);
    expect(() =>
      output.authorizeRequest(invalidated, Date.now() + 60_000)
    ).toThrow(new PrivateOutputUnavailable({ reason: "output_disabled" }));
    output.invalidate({ generation: invalidated });
    expect(output.isRequestCurrent(current)).toBe(true);
  });

  it.each(["pending_request", "request"] as const)(
    "invalidates a %s grant on restart",
    (status) => {
      const { generation, output } = fixture(status);
      output.restart();
      expect(output.isCurrent(generation)).toBe(false);
      expect(output.isRequestCurrent(generation)).toBe(false);
      expect(() =>
        output.authorizeRequest(generation, Date.now() + 60_000)
      ).toThrow(new PrivateOutputUnavailable({ reason: "output_disabled" }));
    }
  );

  it.each(["pending", "authorized", "connected"] as const)(
    "never promotes or renews a %s socket grant as a request lease",
    (status) => {
      const { generation, output } = fixture(status);
      expect(() =>
        output.authorizeRequest(generation, Date.now() + 60_000)
      ).toThrow(new PrivateOutputUnavailable({ reason: "output_disabled" }));
      expect(output.isRequestCurrent(generation)).toBe(false);
      expect(output.read()?.status).toBe(status);
    }
  );

  it.each(["pending_request", "request"] as const)(
    "never authorizes a %s request lease as a socket grant",
    (status) => {
      const { generation, output } = fixture(status);
      expect(() => output.authorize(generation, Date.now() + 60_000)).toThrow(
        new PrivateOutputUnavailable({ reason: "output_disabled" })
      );
      expect(output.readRequest()?.status).toBe(status);
    }
  );

  it("preserves a request lease while beginning and authorizing a browser connection", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { accounts, database, output, sockets } = requestFixture();
    const request = await output.beginRequest(participant, target);
    output.authorizeRequest(request, 4000);
    const lease = database
      .select()
      .from(privateOutputGeneration)
      .where(eq(privateOutputGeneration.generation, request))
      .get();
    const browser = await output.begin(participant, target);
    expect(browser).not.toBe(request);
    expect(accounts).toHaveLength(2);
    expect(output.isRequestCurrent(request)).toBe(true);
    output.authorize(browser, 2000);
    expect(output.isRequestCurrent(request)).toBe(true);
    expect(output.isRequestCurrent(browser)).toBe(false);

    // Native accept is covered by the runtime suite; this unit fixture resumes
    // its persisted connected state without inventing a WebSocketPair.
    database
      .update(privateOutputGeneration)
      .set({ status: "connected" })
      .where(eq(privateOutputGeneration.generation, browser))
      .run();
    const retained = socket(browser);
    sockets.push(retained);
    expect(output.isCurrent(browser)).toBe(true);
    expect(output.isRequestCurrent(request)).toBe(true);
    expect(
      database
        .select()
        .from(privateOutputGeneration)
        .where(eq(privateOutputGeneration.generation, request))
        .get()
    ).toEqual(lease);
    output.send(browser, "browser remains connected");
    expect(retained.send).toHaveBeenCalledWith("browser remains connected");
  });

  it("does not physically send or accept an upgrade under a request lease", () => {
    const { generation, output, sockets } = fixture("request");
    const retained = socket(generation);
    sockets.push(retained);
    expect(output.isCurrent(generation)).toBe(true);
    output.send(generation, "must not escape");
    expect(retained.send).not.toHaveBeenCalled();
    const response = output.accept(
      new Request("https://private.example/", {
        headers: {
          "private-output-generation": generation,
          upgrade: "websocket",
        },
      }),
      "ready"
    );
    expect(response.status).toBe(403);
  });

  it("refuses already expired authority without consuming a pending request", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { output } = requestFixture();
    const generation = await output.beginRequest(participant, target);
    expect(() => output.authorizeRequest(generation, 1000)).toThrow(
      new PrivateOutputUnavailable({ reason: "authority_unavailable" })
    );
    expect(output.isCurrent(generation)).toBe(false);
    output.authorizeRequest(generation, 2000);
    expect(output.isRequestCurrent(generation)).toBe(true);
  });

  it("invalidates a request when a native lifecycle refuses registration", async () => {
    const { output } = requestFixture(() => Promise.resolve(false));
    await expect(output.beginRequest(participant, target)).rejects.toEqual(
      new PrivateOutputUnavailable({ reason: "output_disabled" })
    );
    expect(output.readRequest()?.status).toBe("invalidated");
  });

  it("cannot authorize registration completed after invalidation", async () => {
    const registration = Promise.withResolvers<boolean>();
    const { accounts, output } = requestFixture(() => registration.promise);
    const pending = output.beginRequest(participant, target);
    const [first] = accounts;
    expect(first).toBeDefined();
    if (first === undefined) {
      throw new Error("Expected native account registration");
    }
    output.invalidate({ generation: first.generation });
    registration.resolve(true);
    const generation = await pending;
    expect(() =>
      output.authorizeRequest(generation, Date.now() + 60_000)
    ).toThrow(new PrivateOutputUnavailable({ reason: "output_disabled" }));
    expect(output.isCurrent(generation)).toBe(false);
  });
});

describe("coexisting browser and request output leases", () => {
  it("preserves the connected browser generation and expiry through request admission and renewal", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const {
      accounts,
      database,
      generation: browser,
      output,
      sockets,
    } = requestFixture(() => Promise.resolve(true), "connected", 5000);
    const retained = socket(browser);
    sockets.push(retained);
    const browserLease = database
      .select()
      .from(privateOutputGeneration)
      .where(eq(privateOutputGeneration.generation, browser))
      .get();
    const request = await output.beginRequest(participant, target);
    expect(output.isCurrent(browser)).toBe(true);
    expect(output.isRequestCurrent(request)).toBe(false);
    expect(retained.close).not.toHaveBeenCalled();
    output.authorizeRequest(request, 2500);
    now.mockReturnValue(2000);
    expect(await output.beginRequest(participant, target)).toBe(request);
    output.authorizeRequest(request, 3500);
    expect(output.isCurrent(browser)).toBe(true);
    expect(output.isRequestCurrent(request)).toBe(true);
    expect(accounts).toHaveLength(1);
    expect(
      database
        .select()
        .from(privateOutputGeneration)
        .where(eq(privateOutputGeneration.generation, browser))
        .get()
    ).toEqual(browserLease);
    output.send(request, "request data must not reach the browser");
    expect(retained.send).not.toHaveBeenCalled();
    output.send(browser, "browser data still arrives");
    expect(retained.send).toHaveBeenCalledWith("browser data still arrives");
    expect(retained.close).not.toHaveBeenCalled();
  });

  it.each([
    { browserExpiresAt: 3000, expiresFirst: "request", requestExpiresAt: 2000 },
    { browserExpiresAt: 2000, expiresFirst: "browser", requestExpiresAt: 3000 },
  ])(
    "expires $expiresFirst authority without expiring the other channel",
    async ({ browserExpiresAt, requestExpiresAt }) => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1000);
      const {
        generation: browser,
        output,
        sockets,
      } = requestFixture(
        () => Promise.resolve(true),
        "connected",
        browserExpiresAt
      );
      const retained = socket(browser);
      sockets.push(retained);
      const request = await output.beginRequest(participant, target);
      output.authorizeRequest(request, requestExpiresAt);
      expect(output.read()?.generation).toBe(browser);
      expect(output.readRequest()?.generation).toBe(request);
      expect(output.read(browser)?.expiresAt).toBe(browserExpiresAt);
      expect(output.read(request)?.expiresAt).toBe(requestExpiresAt);
      expect(output.isCurrent(browser)).toBe(true);
      expect(output.isRequestCurrent(request)).toBe(true);
      now.mockReturnValue(2000);
      expect(output.isCurrent(browser)).toBe(browserExpiresAt > 2000);
      expect(output.isRequestCurrent(request)).toBe(requestExpiresAt > 2000);
      output.send(browser, "only if browser authority remains");
      expect(retained.send).toHaveBeenCalledTimes(
        browserExpiresAt > 2000 ? 1 : 0
      );
      now.mockReturnValue(3000);
      expect(output.isCurrent(browser)).toBe(false);
      expect(output.isRequestCurrent(request)).toBe(false);
    }
  );

  it("preserves the browser on restart while invalidating its coexisting request lease", async () => {
    const {
      generation: browser,
      output,
      sockets,
    } = requestFixture(
      () => Promise.resolve(true),
      "connected",
      Date.now() + 60_000
    );
    const retained = socket(browser);
    sockets.push(retained);
    const request = await output.beginRequest(participant, target);
    output.authorizeRequest(request, Date.now() + 60_000);
    output.restart();
    expect(output.isCurrent(browser)).toBe(true);
    expect(output.isRequestCurrent(request)).toBe(false);
    expect(retained.close).not.toHaveBeenCalled();
    expect(() => output.authorizeRequest(request, Date.now() + 60_000)).toThrow(
      new PrivateOutputUnavailable({ reason: "output_disabled" })
    );
    output.send(browser, "surviving native connection");
    expect(retained.send).toHaveBeenCalledWith("surviving native connection");
  });

  it("invalidates only the matching generation until the lifecycle fences its other registration", async () => {
    const { accounts, database, households, output, sockets } =
      requestFixture();
    const browser = await output.begin(participant, target);
    output.authorize(browser, Date.now() + 60_000);
    database
      .update(privateOutputGeneration)
      .set({ status: "connected" })
      .where(eq(privateOutputGeneration.generation, browser))
      .run();
    const retained = socket(browser);
    sockets.push(retained);
    const request = await output.beginRequest(participant, target);
    output.authorizeRequest(request, Date.now() + 60_000);
    expect(accounts).toEqual([
      { ...target, generation: browser },
      { ...target, generation: request },
    ]);
    expect(households).toEqual(accounts);
    output.invalidate({ generation: request });
    expect(output.isRequestCurrent(request)).toBe(false);
    expect(output.isCurrent(browser)).toBe(true);
    expect(retained.close).not.toHaveBeenCalled();

    // Each native lifecycle retains both registrations and fences each one.
    for (const registration of accounts) {
      output.invalidate({ generation: registration.generation });
    }
    expect(output.isCurrent(browser)).toBe(false);
    expect(output.isRequestCurrent(request)).toBe(false);
    expect(retained.close).toHaveBeenCalledWith(
      1008,
      "Reauthentication required"
    );
    output.send(browser, "must not escape");
    expect(retained.send).not.toHaveBeenCalled();
  });
});
