import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/node-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivateOutputSocket } from "./private-output-socket.js";
import { privateOutputGeneration } from "./private-output.database-schema.js";

const connections: DatabaseSync[] = [];
afterEach(() => {
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
const fixture = (
  status: typeof privateOutputGeneration.$inferInsert.status = "connected",
  expiresAt = Date.now() + 60_000
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
      singleton: 1,
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
    {
      AccountOutputLifecycle: { getByName: renewal },
      HouseholdAgent: { getByName: renewal },
    }
  );
  return { generation, output, sockets };
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
