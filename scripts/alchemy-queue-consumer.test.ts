import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { CloudflareEnvironment } from "alchemy/Cloudflare";
import { Consumer, ConsumerProviderLive } from "alchemy/Cloudflare/Queues";
import type { ConsumerSettings } from "alchemy/Cloudflare/Queues";
import type * as Plan from "alchemy/Plan";
import * as State from "alchemy/State";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect, it } from "vitest";

interface CloudflareCredentials {
  readonly apiBaseUrl: string;
  readonly type: "apiToken";
}

interface CloudflareCredentialsRequirement {
  readonly CloudflareCredentialsRequirement: unique symbol;
}

interface CloudflareCredentialsModule {
  readonly Credentials: Context.Service<
    CloudflareCredentialsRequirement,
    Effect.Effect<CloudflareCredentials>
  >;
  readonly apiTokenCredentials: (options: {
    readonly apiBaseUrl: string;
    readonly apiToken: string;
  }) => CloudflareCredentials;
}

interface QueuesModule {
  readonly createConsumer: (input: {
    readonly accountId: string;
    readonly deadLetterQueue: string;
    readonly queueId: string;
    readonly scriptName: string;
    readonly settings: ConsumerSettings;
    readonly type: "worker";
  }) => Effect.Effect<
    unknown,
    unknown,
    CloudflareCredentialsRequirement | HttpClient.HttpClient
  >;
  readonly updateConsumer: (input: {
    readonly accountId: string;
    readonly consumerId: string;
    readonly deadLetterQueue: string;
    readonly queueId: string;
    readonly scriptName: string;
    readonly settings: ConsumerSettings;
    readonly type: "worker";
  }) => Effect.Effect<
    unknown,
    unknown,
    CloudflareCredentialsRequirement | HttpClient.HttpClient
  >;
}

interface LoadedQueueModules {
  readonly credentialsModule: CloudflareCredentialsModule;
  readonly queuesModule: QueuesModule;
}

interface ScratchStack {
  readonly name: string;
  readonly state: Layer.Layer<State.State>;
  readonly plan: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<Plan.Plan<A>, unknown, R>;
}

interface TestCoreModule {
  readonly scratchStack: (
    options: {
      readonly providers: ReturnType<typeof ConsumerProviderLive>;
      readonly stage: string;
    },
    name: string
  ) => ScratchStack;
}

interface QueueRequestBody {
  readonly dead_letter_queue?: string;
  readonly script_name?: string;
  readonly settings?: {
    readonly batch_size?: number;
    readonly max_concurrency?: number;
    readonly max_retries?: number;
    readonly max_wait_time_ms?: number;
    readonly retry_delay?: number;
  };
  readonly type?: string;
}

const accountId = "local-account";
const consumerId = "a8967cf391c84eca9456b9e494d1f74a";
const deadLetterQueue = "meal-planner-pilot-gaia-117-import-batch-dlq";
const queueId = "680ad90563bd4be3a8c0ca04862b97fd";
const scriptName = "meal-planner-pilot-gaia-117-api";
const logicalId = "ImportBatchQueueConsumer";
const instanceId = "local-instance";
const desiredSettings: ConsumerSettings = {
  batchSize: 1,
  maxConcurrency: 1,
  maxRetries: 2,
  maxWaitTimeMs: 1000,
  retryDelay: 1,
};

const loadQueueModules = async (): Promise<LoadedQueueModules> => {
  const cloudflareEntry = import.meta.resolve("alchemy/Cloudflare");
  const consumerUrl = new URL("Queues/Consumer.js", cloudflareEntry);
  const requireFromAlchemy = createRequire(consumerUrl);
  const credentialsUrl = pathToFileURL(
    requireFromAlchemy.resolve("@distilled.cloud/cloudflare/Credentials")
  );
  const queuesUrl = pathToFileURL(
    requireFromAlchemy.resolve("@distilled.cloud/cloudflare/queues")
  );

  const [credentialsModule, queuesModule] = await Promise.all([
    import(credentialsUrl.href) as Promise<CloudflareCredentialsModule>,
    import(queuesUrl.href) as Promise<QueuesModule>,
  ]);

  return { credentialsModule, queuesModule };
};

const loadTestCore = (): Promise<TestCoreModule> => {
  const stackEntry = import.meta.resolve("alchemy/Stack");
  const coreUrl = new URL("Test/Core.js", stackEntry);
  return import(coreUrl.href) as Promise<TestCoreModule>;
};

const decodeRequestBody = (body: HttpBody.HttpBody): QueueRequestBody => {
  if (body._tag !== "Uint8Array") {
    throw new TypeError(`Expected a JSON request body, received ${body._tag}`);
  }
  return JSON.parse(new TextDecoder().decode(body.body)) as QueueRequestBody;
};

const cloudflareResponse = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  result: unknown
): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(
    request,
    Response.json({ errors: [], messages: [], result, success: true })
  );

const provideQueueServices = <A, R>(
  modules: LoadedQueueModules,
  client: HttpClient.HttpClient,
  effect: Effect.Effect<A, unknown, R>
): Effect.Effect<A, unknown> => {
  const credentials = modules.credentialsModule.apiTokenCredentials({
    apiBaseUrl: "https://cloudflare.invalid/client/v4",
    apiToken: "local-test-placeholder",
  });

  return effect.pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.provideService(
      modules.credentialsModule.Credentials,
      Effect.succeed(credentials)
    ),
    Effect.provideService(
      CloudflareEnvironment,
      Effect.succeed({
        accountId,
        apiToken: Redacted.make("local-test-placeholder"),
        source: { type: "env" },
        type: "apiToken",
      })
    )
  ) as Effect.Effect<A, unknown>;
};

const makePersistedConsumer = (
  attr: State.CreatedResourceState["attr"]
): State.CreatedResourceState => ({
  attr,
  bindings: [],
  downstream: [],
  fqn: logicalId,
  instanceId,
  logicalId,
  namespace: undefined,
  props: {
    deadLetterQueue,
    queueId,
    scriptName,
    settings: desiredSettings,
  },
  providerVersion: 0,
  resourceType: Consumer.Type,
  status: "created",
});

const runStablePlan = async (
  client: HttpClient.HttpClient,
  persisted: State.CreatedResourceState
) => {
  const [modules, testCore] = await Promise.all([
    loadQueueModules(),
    loadTestCore(),
  ]);
  const scratch = testCore.scratchStack(
    { providers: ConsumerProviderLive(), stage: "test" },
    "queue-consumer-stable-plan"
  );

  await Effect.gen(function* seedPersistedState() {
    const state = yield* yield* State.State;
    yield* state.set({
      fqn: logicalId,
      stack: scratch.name,
      stage: "test",
      value: persisted,
    });
  }).pipe(Effect.provide(scratch.state), Effect.runPromise);

  const plan = await scratch
    .plan(
      Consumer(logicalId, {
        deadLetterQueue,
        queueId,
        scriptName,
        settings: desiredSettings,
      })
    )
    .pipe(
      (effect) => provideQueueServices(modules, client, effect),
      Effect.scoped,
      Effect.runPromise
    );
  const persistedAfter = await Effect.gen(function* readPersistedState() {
    const state = yield* yield* State.State;
    return yield* state.get({
      fqn: logicalId,
      stack: scratch.name,
      stage: "test",
    });
  }).pipe(Effect.provide(scratch.state), Effect.runPromise);

  return { persistedAfter, plan };
};

describe("Alchemy queue consumer reconciliation", () => {
  it("plans one in-place update when stable cached state hides physical DLQ drift", async () => {
    const requests: { method: string; url: string }[] = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push({ method: request.method, url: request.url });
        return cloudflareResponse(request, {
          consumer_id: consumerId,
          dead_letter_queue: null,
          queue_name: "meal-planner-pilot-gaia-117-import-batch",
          script_name: scriptName,
          settings: {
            batch_size: desiredSettings.batchSize,
            max_concurrency: desiredSettings.maxConcurrency,
            max_retries: desiredSettings.maxRetries,
            max_wait_time_ms: desiredSettings.maxWaitTimeMs,
            retry_delay: desiredSettings.retryDelay,
          },
          type: "worker",
        });
      })
    );
    const persisted = makePersistedConsumer({
      accountId,
      consumerId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
    });
    const result = await runStablePlan(client, persisted);

    expect(Object.keys(result.plan.resources)).toEqual([logicalId]);
    expect(result.plan.resources[logicalId]).toMatchObject({
      action: "update",
      state: {
        attr: { consumerId },
        instanceId,
        logicalId,
      },
    });
    expect(result.plan.deletions).toEqual({});
    expect(requests.length).toBeGreaterThan(0);
    expect(new Set(requests.map(({ method }) => method))).toEqual(
      new Set(["GET"])
    );
    expect(
      requests.every(({ url }) => url.endsWith(`/consumers/${consumerId}`))
    ).toBe(true);
    expect(result.persistedAfter).toEqual(persisted);
  });

  it("keeps a physically matching stable consumer as a no-op", async () => {
    const methods: string[] = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        methods.push(request.method);
        return cloudflareResponse(request, {
          consumer_id: consumerId,
          dead_letter_queue: deadLetterQueue,
          queue_name: "meal-planner-pilot-gaia-117-import-batch",
          script_name: scriptName,
          settings: {
            batch_size: desiredSettings.batchSize,
            max_concurrency: desiredSettings.maxConcurrency,
            max_retries: desiredSettings.maxRetries,
            max_wait_time_ms: desiredSettings.maxWaitTimeMs,
            retry_delay: desiredSettings.retryDelay,
          },
          type: "worker",
        });
      })
    );
    const persisted = makePersistedConsumer({
      accountId,
      consumerId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
    });
    const result = await runStablePlan(client, persisted);

    expect(result.plan.resources[logicalId]).toMatchObject({
      action: "noop",
      state: { instanceId, logicalId },
    });
    expect(result.plan.deletions).toEqual({});
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
    expect(result.persistedAfter).toEqual(persisted);
  });

  it("uses the worker-only list scan when stable state lost the consumer ID", async () => {
    const urls: string[] = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        urls.push(request.url);
        return cloudflareResponse(request, [
          {
            consumer_id: "http-pull-consumer",
            dead_letter_queue: null,
            queue_name: "meal-planner-pilot-gaia-117-import-batch",
            settings: {},
            type: "http_pull",
          },
          {
            consumer_id: consumerId,
            dead_letter_queue: null,
            queue_name: "meal-planner-pilot-gaia-117-import-batch",
            script_name: scriptName,
            settings: {
              batch_size: 10,
              max_concurrency: null,
              max_retries: 3,
              max_wait_time_ms: 5000,
              retry_delay: null,
            },
            type: "worker",
          },
        ]);
      })
    );
    const persisted = makePersistedConsumer({
      accountId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
    });
    const result = await runStablePlan(client, persisted);

    expect(result.plan.resources[logicalId]).toMatchObject({
      action: "update",
      state: { instanceId, logicalId },
    });
    expect(result.plan.deletions).toEqual({});
    expect(urls.length).toBeGreaterThan(0);
    expect(
      urls.every((url) => url.endsWith(`/queues/${queueId}/consumers`))
    ).toBe(true);
    expect(result.persistedAfter).toEqual(persisted);
  });

  it("encodes the configured dead letter queue for create and update requests", async () => {
    const modules = await loadQueueModules();
    const bodies: QueueRequestBody[] = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        bodies.push(decodeRequestBody(request.body));
        return cloudflareResponse(request, {
          consumer_id: consumerId,
          dead_letter_queue: deadLetterQueue,
          queue_name: "meal-planner-pilot-gaia-117-import-batch",
          script_name: scriptName,
          settings: {
            batch_size: desiredSettings.batchSize,
            max_concurrency: desiredSettings.maxConcurrency,
            max_retries: desiredSettings.maxRetries,
            max_wait_time_ms: desiredSettings.maxWaitTimeMs,
            retry_delay: desiredSettings.retryDelay,
          },
          type: "worker",
        });
      })
    );
    const request = {
      accountId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
      type: "worker" as const,
    };

    await provideQueueServices(
      modules,
      client,
      Effect.all([
        modules.queuesModule.createConsumer(request),
        modules.queuesModule.updateConsumer({ ...request, consumerId }),
      ])
    ).pipe(Effect.runPromise);

    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toMatchObject({
        dead_letter_queue: deadLetterQueue,
        script_name: scriptName,
        settings: {
          batch_size: 1,
          max_concurrency: 1,
          max_retries: 2,
          max_wait_time_ms: 1000,
          retry_delay: 1,
        },
        type: "worker",
      });
    }
  });
});
