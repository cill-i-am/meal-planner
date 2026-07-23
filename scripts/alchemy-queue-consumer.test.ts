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
  readonly deploy: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, unknown, R>;
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
  readonly toEffect: <A>(
    effect: Effect.Effect<A, unknown>,
    options: {
      readonly providers: ReturnType<typeof ConsumerProviderLive>;
      readonly stage: string;
      readonly state: Layer.Layer<State.State>;
    }
  ) => Effect.Effect<A, unknown>;
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
const deadLetterQueueId = "1c81214aa857418ab4d3c0cb67f456de";
const queueId = "680ad90563bd4be3a8c0ca04862b97fd";
const replacementConsumerId = "29ef6202fbd84bc5a3f03b121ba44e61";
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

const cloudflareErrorResponse = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  code: number,
  message: string,
  status = 400
): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(
    request,
    Response.json(
      {
        errors: [{ code, message }],
        messages: [],
        result: null,
        success: false,
      },
      { status }
    )
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
    deadLetterQueueId,
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
        deadLetterQueueId,
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

const runStableDeploy = async (
  client: HttpClient.HttpClient,
  persisted: State.CreatedResourceState,
  requested?: { readonly deadLetterQueueId?: string }
) => {
  const options = requested ?? { deadLetterQueueId };
  const [modules, testCore] = await Promise.all([
    loadQueueModules(),
    loadTestCore(),
  ]);
  const scratch = testCore.scratchStack(
    { providers: ConsumerProviderLive(), stage: "test" },
    "queue-consumer-stable-deploy"
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

  const exit = await testCore
    .toEffect(
      provideQueueServices(
        modules,
        client,
        scratch.deploy(
          Consumer(logicalId, {
            deadLetterQueue,
            queueId,
            scriptName,
            settings: desiredSettings,
            ...options,
          })
        )
      ),
      {
        providers: ConsumerProviderLive(),
        stage: "test",
        state: scratch.state,
      }
    )
    .pipe(Effect.exit, Effect.runPromise);
  const persistedAfter = await Effect.gen(function* readPersistedState() {
    const state = yield* yield* State.State;
    return yield* state.get({
      fqn: logicalId,
      stack: scratch.name,
      stage: "test",
    });
  }).pipe(Effect.provide(scratch.state), Effect.runPromise);

  return { exit, persistedAfter };
};

const physicalConsumer = (
  physicalDeadLetterQueue: string | null | undefined,
  settings: ConsumerSettings = desiredSettings,
  physicalConsumerId: string = consumerId
) => ({
  consumer_id: physicalConsumerId,
  ...(physicalDeadLetterQueue === undefined
    ? {}
    : { dead_letter_queue: physicalDeadLetterQueue }),
  queue_name: "meal-planner-pilot-gaia-117-import-batch",
  script: scriptName,
  settings: {
    batch_size: settings.batchSize,
    max_concurrency: settings.maxConcurrency,
    max_retries: settings.maxRetries,
    max_wait_time_ms: settings.maxWaitTimeMs,
    retry_delay: settings.retryDelay,
  },
  type: "worker",
});

const physicalQueue = (options: {
  readonly consumers: readonly ReturnType<typeof physicalConsumer>[];
  readonly consumersTotalCount?: number | undefined;
  readonly physicalQueueId: string;
  readonly producers?: readonly Record<string, unknown>[] | undefined;
  readonly producersTotalCount?: number | undefined;
  readonly queueName: string;
}) => ({
  consumers: options.consumers,
  consumers_total_count:
    options.consumersTotalCount ?? options.consumers.length,
  producers: options.producers ?? [],
  producers_total_count:
    options.producersTotalCount ?? options.producers?.length ?? 0,
  queue_id: options.physicalQueueId,
  queue_name: options.queueName,
  settings: {
    delivery_delay: 0,
    delivery_paused: false,
    message_retention_period: 345_600,
  },
});

type ReplacementFailure =
  | "create"
  | "create-defect"
  | "create-interrupt"
  | "delete"
  | "update";

interface ReplacementScenario {
  readonly deadLetterQueueBacklogBytes?: number | null;
  readonly deadLetterQueueBacklogCount?: number | null;
  readonly deadLetterQueueConsumers?: readonly ReturnType<
    typeof physicalConsumer
  >[];
  readonly deadLetterQueuePhysicalId?: string;
  readonly deadLetterQueueProducers?: readonly Record<string, unknown>[];
  readonly deadLetterQueueProducersTotalCount?: number;
  readonly failure?: ReplacementFailure;
  readonly replacementDeadLetterQueue?: string | null;
  readonly replacementId?: string;
  readonly sourceBacklogBytes?: number | null;
  readonly sourceBacklogCount?: number | null;
  readonly sourceConsumers?: readonly ReturnType<typeof physicalConsumer>[];
  readonly sourcePhysicalQueueId?: string;
  readonly sourceProducers?: readonly Record<string, unknown>[];
  readonly sourceProducersTotalCount?: number;
  readonly updateDeadLetterQueue?: string | null;
}

const unexpectedQueueRequest = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  path: string
) =>
  Effect.die(
    new TypeError(`Unexpected queue test request: ${request.method} ${path}`)
  );

const makeReplacementClient = (
  scenario?: ReplacementScenario
): {
  readonly client: HttpClient.HttpClient;
  readonly operations: string[];
} => {
  const options = scenario ?? {};
  let deleted = false;
  const operations: string[] = [];
  const replacementId = options.replacementId ?? replacementConsumerId;
  const consumerPath = `/queues/${queueId}/consumers/${consumerId}`;
  const replacementPath = `/queues/${queueId}/consumers/${replacementId}`;

  const respondToPut = (
    request: Parameters<typeof HttpClientResponse.fromWeb>[0],
    path: string
  ) => {
    if (!path.endsWith(consumerPath)) {
      return unexpectedQueueRequest(request, path);
    }
    return Effect.succeed(
      options.failure === "update"
        ? cloudflareErrorResponse(
            request,
            10_026,
            "Synthetic generic update failure"
          )
        : cloudflareResponse(
            request,
            physicalConsumer(options.updateDeadLetterQueue ?? null)
          )
    );
  };

  const respondToGet = (
    request: Parameters<typeof HttpClientResponse.fromWeb>[0],
    path: string
  ) => {
    if (path.endsWith(consumerPath)) {
      if (deleted) {
        return Effect.succeed(
          cloudflareErrorResponse(
            request,
            11_006,
            "Synthetic consumer not found",
            404
          )
        );
      }
      return Effect.succeed(
        cloudflareResponse(request, physicalConsumer(null))
      );
    }
    if (path.endsWith(`/queues/${queueId}`)) {
      return Effect.succeed(
        cloudflareResponse(
          request,
          physicalQueue({
            consumers: options.sourceConsumers ?? [physicalConsumer(null)],
            physicalQueueId: options.sourcePhysicalQueueId ?? queueId,
            producers: options.sourceProducers,
            producersTotalCount: options.sourceProducersTotalCount,
            queueName: "meal-planner-pilot-gaia-117-import-batch",
          })
        )
      );
    }
    if (path.endsWith(`/queues/${queueId}/metrics`)) {
      return Effect.succeed(
        cloudflareResponse(request, {
          backlog_bytes:
            options.sourceBacklogBytes === undefined
              ? 0
              : options.sourceBacklogBytes,
          backlog_count:
            options.sourceBacklogCount === undefined
              ? 0
              : options.sourceBacklogCount,
          oldest_message_timestamp_ms: 0,
        })
      );
    }
    if (path.endsWith(`/queues/${deadLetterQueueId}`)) {
      return Effect.succeed(
        cloudflareResponse(
          request,
          physicalQueue({
            consumers: options.deadLetterQueueConsumers ?? [],
            physicalQueueId:
              options.deadLetterQueuePhysicalId ?? deadLetterQueueId,
            producers: options.deadLetterQueueProducers,
            producersTotalCount: options.deadLetterQueueProducersTotalCount,
            queueName: deadLetterQueue,
          })
        )
      );
    }
    if (path.endsWith(`/queues/${deadLetterQueueId}/metrics`)) {
      return Effect.succeed(
        cloudflareResponse(request, {
          backlog_bytes:
            options.deadLetterQueueBacklogBytes === undefined
              ? 0
              : options.deadLetterQueueBacklogBytes,
          backlog_count:
            options.deadLetterQueueBacklogCount === undefined
              ? 0
              : options.deadLetterQueueBacklogCount,
          oldest_message_timestamp_ms: 0,
        })
      );
    }
    if (path.endsWith(replacementPath)) {
      return Effect.succeed(
        cloudflareResponse(
          request,
          physicalConsumer(
            options.replacementDeadLetterQueue === undefined
              ? deadLetterQueue
              : options.replacementDeadLetterQueue,
            desiredSettings,
            replacementId
          )
        )
      );
    }
    return unexpectedQueueRequest(request, path);
  };

  const respondToDelete = (
    request: Parameters<typeof HttpClientResponse.fromWeb>[0],
    path: string
  ) => {
    if (!path.endsWith(consumerPath)) {
      return unexpectedQueueRequest(request, path);
    }
    if (options.failure === "delete") {
      return Effect.succeed(
        cloudflareErrorResponse(
          request,
          10_026,
          "Synthetic generic delete failure"
        )
      );
    }
    deleted = true;
    return Effect.succeed(cloudflareResponse(request, {}));
  };

  const respondToPost = (
    request: Parameters<typeof HttpClientResponse.fromWeb>[0],
    path: string
  ) => {
    if (!path.endsWith(`/queues/${queueId}/consumers`)) {
      return unexpectedQueueRequest(request, path);
    }
    if (options.failure === "create") {
      return Effect.succeed(
        cloudflareErrorResponse(
          request,
          10_026,
          "Synthetic generic create failure"
        )
      );
    }
    if (options.failure === "create-defect") {
      return Effect.die(new Error("Synthetic create defect"));
    }
    if (options.failure === "create-interrupt") {
      return Effect.interrupt;
    }
    return Effect.succeed(
      cloudflareResponse(
        request,
        physicalConsumer(deadLetterQueue, desiredSettings, replacementId)
      )
    );
  };

  const client = HttpClient.make((request) => {
    const path = new URL(request.url).pathname;
    operations.push(`${request.method} ${path}`);
    switch (request.method) {
      case "DELETE": {
        return respondToDelete(request, path);
      }
      case "GET": {
        return respondToGet(request, path);
      }
      case "POST": {
        return respondToPost(request, path);
      }
      case "PUT": {
        return respondToPut(request, path);
      }
      default: {
        return unexpectedQueueRequest(request, path);
      }
    }
  });

  return { client, operations };
};

const expectPersistedUpdatingState = (
  persistedAfter: State.PersistedState | undefined,
  persisted: State.CreatedResourceState
) => {
  expect(persistedAfter).toMatchObject({
    attr: persisted.attr,
    old: {
      attr: persisted.attr,
      bindings: persisted.bindings,
      props: persisted.props,
    },
    status: "updating",
  });
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

  it("does not replace a consumer when the successful update reads back a different non-null DLQ", async () => {
    let updateAccepted = false;
    const methods: string[] = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        methods.push(request.method);
        if (request.method === "PUT") {
          updateAccepted = true;
          return cloudflareResponse(request, physicalConsumer(deadLetterQueue));
        }
        return cloudflareResponse(
          request,
          physicalConsumer(updateAccepted ? "other-dead-letter-queue" : null)
        );
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
    const result = await runStableDeploy(client, persisted);

    expect(result.exit._tag).toBe("Failure");
    expect(methods.filter((method) => method === "PUT")).toHaveLength(1);
    expect(new Set(methods)).toEqual(new Set(["GET", "PUT"]));
    expectPersistedUpdatingState(result.persistedAfter, persisted);
  });

  it("commits freshly observed attributes after the physical consumer converges", async () => {
    let updateAccepted = false;
    const methods: string[] = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        methods.push(request.method);
        if (request.method === "PUT") {
          updateAccepted = true;
        }
        return cloudflareResponse(
          request,
          physicalConsumer(updateAccepted ? deadLetterQueue : null)
        );
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
    const result = await runStableDeploy(client, persisted);

    expect(result.exit._tag).toBe("Success");
    expect(methods.filter((method) => method === "PUT")).toHaveLength(1);
    expect(new Set(methods)).toEqual(new Set(["GET", "PUT"]));
    expect(result.persistedAfter).toMatchObject({
      attr: {
        accountId,
        consumerId,
        deadLetterQueue,
        queueId,
        scriptName,
        settings: desiredSettings,
      },
      status: "updated",
    });
  });

  it("replaces the owned idle consumer only after a successful update still omits the requested DLQ", async () => {
    const { client, operations } = makeReplacementClient();
    const persisted = makePersistedConsumer({
      accountId,
      consumerId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
    });
    const result = await runStableDeploy(client, persisted);

    expect(result.exit._tag).toBe("Success");
    expect(operations).toEqual([
      `GET /client/v4/accounts/${accountId}/queues/${queueId}/consumers/${consumerId}`,
      `GET /client/v4/accounts/${accountId}/queues/${queueId}/consumers/${consumerId}`,
      `PUT /client/v4/accounts/${accountId}/queues/${queueId}/consumers/${consumerId}`,
      `GET /client/v4/accounts/${accountId}/queues/${queueId}/consumers/${consumerId}`,
      `GET /client/v4/accounts/${accountId}/queues/${queueId}`,
      `GET /client/v4/accounts/${accountId}/queues/${queueId}/metrics`,
      `GET /client/v4/accounts/${accountId}/queues/${deadLetterQueueId}`,
      `GET /client/v4/accounts/${accountId}/queues/${deadLetterQueueId}/metrics`,
      `DELETE /client/v4/accounts/${accountId}/queues/${queueId}/consumers/${consumerId}`,
      `GET /client/v4/accounts/${accountId}/queues/${queueId}/consumers/${consumerId}`,
      `POST /client/v4/accounts/${accountId}/queues/${queueId}/consumers`,
      `GET /client/v4/accounts/${accountId}/queues/${queueId}/consumers/${replacementConsumerId}`,
    ]);
    expect(result.persistedAfter).toMatchObject({
      attr: {
        accountId,
        consumerId: replacementConsumerId,
        deadLetterQueue,
        queueId,
        scriptName,
        settings: desiredSettings,
      },
      status: "updated",
    });
  });

  it.each([
    [
      "source Queue identity drift",
      { sourcePhysicalQueueId: "foreign-source-queue" },
    ],
    [
      "foreign Consumer ownership",
      {
        sourceConsumers: [
          physicalConsumer(null, desiredSettings, "foreign-consumer"),
        ],
      },
    ],
    [
      "an active source Queue producer",
      {
        sourceProducers: [{ service: "active-producer" }],
        sourceProducersTotalCount: 1,
      },
    ],
    ["an unknown source Queue backlog", { sourceBacklogCount: null }],
    ["a nonzero source Queue backlog", { sourceBacklogCount: 1 }],
    [
      "DLQ identity drift",
      { deadLetterQueuePhysicalId: "foreign-dead-letter-queue" },
    ],
    [
      "an active DLQ workload",
      {
        deadLetterQueueConsumers: [
          physicalConsumer(null, desiredSettings, "foreign-dlq-consumer"),
        ],
      },
    ],
    ["an unknown DLQ backlog", { deadLetterQueueBacklogBytes: null }],
    ["a nonzero DLQ backlog", { deadLetterQueueBacklogCount: 1 }],
  ] satisfies readonly (readonly [string, ReplacementScenario])[])(
    "fails closed before deletion when replacement safety sees %s",
    async (_label, scenario) => {
      const { client, operations } = makeReplacementClient(scenario);
      const persisted = makePersistedConsumer({
        accountId,
        consumerId,
        deadLetterQueue,
        queueId,
        scriptName,
        settings: desiredSettings,
      });
      const result = await runStableDeploy(client, persisted);

      expect(result.exit._tag).toBe("Failure");
      expect(
        operations.some((operation) => operation.startsWith("DELETE "))
      ).toBe(false);
      expect(
        operations.some((operation) => operation.startsWith("POST "))
      ).toBe(false);
      expectPersistedUpdatingState(result.persistedAfter, persisted);
    }
  );

  it("fails closed when the retained DLQ identity is unavailable to the Consumer resource", async () => {
    const { client, operations } = makeReplacementClient();
    const persisted = makePersistedConsumer({
      accountId,
      consumerId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
    });
    const result = await runStableDeploy(client, persisted, {});

    expect(result.exit._tag).toBe("Failure");
    expect(
      operations.some((operation) => operation.startsWith("DELETE "))
    ).toBe(false);
    expect(operations.some((operation) => operation.startsWith("POST "))).toBe(
      false
    );
    expectPersistedUpdatingState(result.persistedAfter, persisted);
  });

  it("does not trigger replacement for a generic Consumer update error", async () => {
    const { client, operations } = makeReplacementClient({
      failure: "update",
    });
    const persisted = makePersistedConsumer({
      accountId,
      consumerId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
    });
    const result = await runStableDeploy(client, persisted);

    expect(result.exit._tag).toBe("Failure");
    expect(
      operations.some((operation) => operation.startsWith("DELETE "))
    ).toBe(false);
    expect(operations.some((operation) => operation.startsWith("POST "))).toBe(
      false
    );
    expectPersistedUpdatingState(result.persistedAfter, persisted);
  });

  it.each([
    ["delete failure", "delete", true, false],
    ["create failure", "create", true, true],
    ["create defect", "create-defect", true, true],
    ["create interruption", "create-interrupt", true, true],
  ] satisfies readonly (readonly [
    string,
    ReplacementFailure,
    boolean,
    boolean,
  ])[])(
    "keeps the old stable state honest after %s",
    async (_label, failure, expectsDelete, expectsCreate) => {
      const { client, operations } = makeReplacementClient({ failure });
      const persisted = makePersistedConsumer({
        accountId,
        consumerId,
        deadLetterQueue,
        queueId,
        scriptName,
        settings: desiredSettings,
      });
      const result = await runStableDeploy(client, persisted);

      expect(result.exit._tag).toBe("Failure");
      expect(
        operations.some((operation) => operation.startsWith("DELETE "))
      ).toBe(expectsDelete);
      expect(
        operations.some((operation) => operation.startsWith("POST "))
      ).toBe(expectsCreate);
      expectPersistedUpdatingState(result.persistedAfter, persisted);
    }
  );

  it("does not commit the fresh Consumer ID until replacement readback exactly converges", async () => {
    const { client, operations } = makeReplacementClient({
      replacementDeadLetterQueue: null,
    });
    const persisted = makePersistedConsumer({
      accountId,
      consumerId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
    });
    const result = await runStableDeploy(client, persisted);

    expect(result.exit._tag).toBe("Failure");
    expect(
      operations.some((operation) => operation.startsWith("DELETE "))
    ).toBe(true);
    expect(operations.some((operation) => operation.startsWith("POST "))).toBe(
      true
    );
    expectPersistedUpdatingState(result.persistedAfter, persisted);
  });
});
