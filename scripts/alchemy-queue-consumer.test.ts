import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { CloudflareEnvironment } from "alchemy/Cloudflare";
import {
  Consumer,
  ConsumerProviderLive,
  type Consumer as ConsumerResource,
  type ConsumerProps,
  type ConsumerSettings,
} from "alchemy/Cloudflare/Queues";
import { findProviderByType } from "alchemy/Provider";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
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
const desiredSettings: ConsumerSettings = {
  batchSize: 1,
  maxConcurrency: 1,
  maxRetries: 2,
  maxWaitTimeMs: 1_000,
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

const decodeRequestBody = (body: HttpBody.HttpBody): QueueRequestBody => {
  if (body._tag !== "Uint8Array") {
    throw new TypeError(`Expected a JSON request body, received ${body._tag}`);
  }
  return JSON.parse(new TextDecoder().decode(body.body)) as QueueRequestBody;
};

const cloudflareResponse = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  result: Record<string, unknown>
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

describe("Alchemy queue consumer reconciliation", () => {
  it("reads physical DLQ/settings drift and classifies it as an in-place update", async () => {
    const modules = await loadQueueModules();
    const client = HttpClient.make((request) =>
      Effect.succeed(
        cloudflareResponse(request, {
          consumer_id: consumerId,
          dead_letter_queue: null,
          queue_name: "meal-planner-pilot-gaia-117-import-batch",
          script_name: scriptName,
          settings: {
            batch_size: 10,
            max_concurrency: null,
            max_retries: 3,
            max_wait_time_ms: 5_000,
            retry_delay: null,
          },
          type: "worker",
        })
      )
    );
    const cachedOutput: ConsumerResource["Attributes"] = {
      accountId,
      consumerId,
      deadLetterQueue,
      queueId,
      scriptName,
      settings: desiredSettings,
    };
    const providerInput = {
      fqn: "ImportBatchQueueConsumer",
      id: "ImportBatchQueueConsumer",
      instanceId: "local-instance",
      olds: {
        deadLetterQueue,
        queueId,
        scriptName,
        settings: desiredSettings,
      },
      output: cachedOutput,
    };

    const result = await Effect.gen(function* () {
      const provider = yield* findProviderByType<ConsumerResource>(
        Consumer.Type
      );
      if (provider.read === undefined || provider.diff === undefined) {
        return yield* Effect.die("Expected Consumer provider read and diff");
      }
      const observed = yield* provider.read(providerInput);
      if (observed === undefined) {
        return yield* Effect.die("Expected physical Consumer readback");
      }
      const observedProps: ConsumerProps = {
        queueId: observed.queueId,
        scriptName: observed.scriptName,
        ...(observed.deadLetterQueue === undefined
          ? {}
          : { deadLetterQueue: observed.deadLetterQueue }),
        ...(observed.settings === undefined
          ? {}
          : { settings: observed.settings }),
      };
      const diff = yield* provider.diff({
        ...providerInput,
        newBindings: [],
        news: providerInput.olds,
        oldBindings: [],
        olds: observedProps,
        output: observed,
      });
      return { diff, observed };
    }).pipe(
      Effect.provide(ConsumerProviderLive()),
      (effect) => provideQueueServices(modules, client, effect),
      Effect.runPromise
    );

    expect(result.observed).toMatchObject({
      accountId,
      consumerId,
      deadLetterQueue: undefined,
      queueId,
      scriptName,
      settings: {
        batchSize: 10,
        maxConcurrency: undefined,
        maxRetries: 3,
        maxWaitTimeMs: 5_000,
        retryDelay: undefined,
      },
    });
    expect(result.diff).toEqual({ action: "update" });
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
          max_wait_time_ms: 1_000,
          retry_delay: 1,
        },
        type: "worker",
      });
    }
  });
});
