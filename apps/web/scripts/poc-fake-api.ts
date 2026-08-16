import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const NormalImportId = "11111111-1111-4111-8111-111111111111";
const ErrorImportId = "22222222-2222-4222-8222-222222222222";
const SafeErrorVideoId = "0000000000000000000";
export const PocFakeApiToken = "poc-local-bearer-token";

interface ImportState {
  approved: boolean;
  pollCount: number;
  sourceUrl: string;
}

interface StartOptions {
  readonly forceStatus?: 409 | 422 | 503;
  readonly host?: string;
  readonly port?: number;
}

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
};

const respond = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const statusForPoll = (state: ImportState) => {
  if (state.sourceUrl.endsWith(SafeErrorVideoId)) {
    return state.pollCount === 1
      ? { kind: "queued" }
      : { code: "private_or_unavailable", kind: "failed" };
  }

  return [
    { kind: "acquiring" },
    { kind: "transcribing" },
    { kind: "extracting_visual" },
    { kind: "needs_review" },
  ][Math.min(state.pollCount - 1, 3)];
};

const importView = (id: string, status: unknown) => ({
  createdAt: "2026-08-16T08:00:00.000Z",
  evidence: [],
  id,
  source: { kind: "tiktok" },
  status,
  updatedAt: "2026-08-16T08:00:01.000Z",
});

const supportedText = (value: string) => ({
  citations: [
    { confidence: 1, evidenceId: "poc-evidence", origin: "creator_provided" },
  ],
  origin: "creator_provided",
  state: "supported",
  value,
});

const supportedList = (values: readonly string[]) => ({
  items: values.map(supportedText),
  state: "supported",
});

const reviewResponse = (state: ImportState) => ({
  review: {
    _tag: state.approved ? "Approved" : "NeedsReview",
    corrections: [],
    draft: {
      extraction: {
        ingredientLines: supportedList([
          "2 aubergines, sliced",
          "400 g chopped tomatoes",
          "1 tsp dried oregano",
        ]),
        instructions: supportedList([
          "Roast the aubergines until golden.",
          "Simmer the tomatoes with oregano.",
          "Layer together and bake until bubbling.",
        ]),
        name: supportedText("Roasted aubergine bake"),
        sourceUrl: supportedText(state.sourceUrl),
      },
      importId: NormalImportId,
    },
    evidence: [
      { kind: "private-poc-evidence", providerPayload: "never project this" },
    ],
    lifecycle: state.approved ? "approved" : "needs_review",
    tags: {
      cuisines: ["Mediterranean"],
      dietaryFit: "household_match",
      difficulty: "easy",
      leftovers: "one_meal",
      mealTypes: ["dinner"],
      totalTimeBand: "30_to_60_minutes",
    },
    transitions: [],
    unresolvedRequiredFields: [],
    version: state.approved ? 2 : 1,
  },
});

export const startPocFakeApi = async (options: StartOptions = {}) => {
  const imports = new Map<string, ImportState>();
  const requestKeys = new Map<string, string>();
  const approvalMutations = new Map<string, unknown>();
  const requests: {
    readonly authenticated: boolean;
    readonly method: string;
    readonly path: string;
  }[] = [];
  const approvals: unknown[] = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({
      authenticated:
        request.headers.authorization === `Bearer ${PocFakeApiToken}`,
      method: request.method ?? "",
      path: url.pathname,
    });

    if (request.headers.authorization !== `Bearer ${PocFakeApiToken}`) {
      respond(response, 401, {
        error: { code: "unauthorized", message: "Unauthorized" },
      });
      return;
    }
    if (options.forceStatus !== undefined) {
      respond(response, options.forceStatus, {
        error: { code: "forced", message: "Private test detail" },
      });
      return;
    }

    try {
      if (request.method === "POST" && url.pathname === "/imports") {
        const body = await readJson(request);
        const sourceUrl =
          typeof body === "object" &&
          body !== null &&
          "source" in body &&
          typeof body.source === "object" &&
          body.source !== null &&
          "url" in body.source &&
          typeof body.source.url === "string"
            ? body.source.url
            : undefined;
        const key = request.headers["idempotency-key"];
        if (sourceUrl === undefined || typeof key !== "string") {
          respond(response, 422, {
            error: { code: "invalid_request", message: "Invalid" },
          });
          return;
        }
        const priorUrl = requestKeys.get(key);
        if (priorUrl !== undefined && priorUrl !== sourceUrl) {
          respond(response, 409, {
            error: { code: "idempotency_conflict", message: "Conflict" },
          });
          return;
        }
        requestKeys.set(key, sourceUrl);
        const id = sourceUrl.endsWith(SafeErrorVideoId)
          ? ErrorImportId
          : NormalImportId;
        const state = imports.get(id) ?? {
          approved: false,
          pollCount: 0,
          sourceUrl,
        };
        imports.set(id, state);
        respond(response, priorUrl === undefined ? 202 : 200, {
          disposition:
            priorUrl === undefined ? "created" : "idempotency_replay",
          import: importView(id, { kind: "queued" }),
        });
        return;
      }

      const importMatch = /^\/imports\/([0-9a-f-]+)$/u.exec(url.pathname);
      if (request.method === "GET" && importMatch !== null) {
        const id = importMatch[1] ?? "";
        const state = imports.get(id);
        if (state === undefined) {
          respond(response, 422, {
            error: { code: "invalid_import", message: "Invalid" },
          });
          return;
        }
        state.pollCount += 1;
        respond(response, 200, {
          import: importView(id, statusForPoll(state)),
        });
        return;
      }

      const reviewMatch = /^\/recipe-drafts\/([0-9a-f-]+)$/u.exec(url.pathname);
      if (request.method === "GET" && reviewMatch !== null) {
        const state = imports.get(reviewMatch[1] ?? "");
        if (state === undefined) {
          respond(response, 422, {
            error: { code: "invalid_import", message: "Invalid" },
          });
          return;
        }
        respond(response, 200, reviewResponse(state));
        return;
      }

      const approvalMatch = /^\/recipe-drafts\/([0-9a-f-]+)\/approve$/u.exec(
        url.pathname
      );
      if (request.method === "POST" && approvalMatch !== null) {
        const id = approvalMatch[1] ?? "";
        const state = imports.get(id);
        const body = await readJson(request);
        approvals.push(body);
        const mutationId =
          typeof body === "object" &&
          body !== null &&
          "mutationId" in body &&
          typeof body.mutationId === "string"
            ? body.mutationId
            : undefined;
        if (state === undefined || mutationId === undefined) {
          respond(response, 422, {
            error: { code: "invalid_request", message: "Invalid" },
          });
          return;
        }
        const replay = approvalMutations.get(mutationId);
        if (replay !== undefined) {
          respond(response, 200, replay);
          return;
        }
        if (state.approved) {
          respond(response, 409, {
            error: { code: "review_conflict", message: "Conflict" },
          });
          return;
        }
        state.approved = true;
        const result = {
          outcome: {
            _tag: "Applied",
            mutationId,
            resultingVersion: 2,
            review: reviewResponse(state).review,
          },
        };
        approvalMutations.set(mutationId, {
          outcome: { ...result.outcome, _tag: "Replayed" },
        });
        respond(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/recipe-bank") {
        const recipes = [...imports.entries()].flatMap(([id, state]) =>
          state.approved
            ? [
                {
                  approvedAt: "2026-08-16T08:00:02.000Z",
                  importId: id,
                  recipe: {
                    ingredientLines: [
                      "2 aubergines, sliced",
                      "400 g chopped tomatoes",
                      "1 tsp dried oregano",
                    ],
                    instructions: [
                      "Roast the aubergines until golden.",
                      "Simmer the tomatoes with oregano.",
                      "Layer together and bake until bubbling.",
                    ],
                    name: "Roasted aubergine bake",
                  },
                  source: { sourceUrl: state.sourceUrl },
                  version: 2,
                },
              ]
            : []
        );
        respond(response, 200, { recipes });
        return;
      }

      respond(response, 404, {
        error: { code: "not_found", message: "Not found" },
      });
    } catch {
      respond(response, 422, {
        error: { code: "invalid_request", message: "Invalid" },
      });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake API did not bind");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
    inspect: () => ({
      approvalMutationCount: approvalMutations.size,
      approvals: [...approvals],
      approvedRecipeCount: [...imports.values()].filter(
        (state) => state.approved
      ).length,
      requestKeys: [...requestKeys.entries()],
      requests: [...requests],
    }),
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Math.trunc(Number(process.env["POC_FAKE_API_PORT"] ?? "4311"));
  const running = await startPocFakeApi({ port });
  process.stdout.write(`POC fake API listening at ${running.baseUrl}\n`);
}
