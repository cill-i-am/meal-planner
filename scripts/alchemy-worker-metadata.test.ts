import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

interface WorkerMetadataHashModule {
  readonly resolveWorkerMetadataHash: (input: {
    readonly accountId: string;
    readonly bindings: readonly {
      readonly data: {
        readonly bindings?: readonly Record<string, unknown>[];
        readonly cache?: Record<string, unknown>;
        readonly containers?: readonly {
          readonly className: string;
          readonly dev?: unknown;
        }[];
        readonly [key: string]: unknown;
      };
      readonly sid: string;
    }[];
    readonly props: Record<string, unknown>;
    readonly stack: {
      readonly name: string;
      readonly stage: string;
    };
  }) => Effect.Effect<string>;
}

const loadWorkerMetadataHash = async () => {
  const cloudflareEntry = import.meta.resolve("alchemy/Cloudflare");
  const providerUrl = new URL("Workers/WorkerProvider.js", cloudflareEntry);
  const provider = (await import(providerUrl.href)) as WorkerMetadataHashModule;

  return provider.resolveWorkerMetadataHash;
};

const accountId = "local-account";
const props = {
  compatibility: {
    date: "2026-07-25",
    flags: ["nodejs_compat"],
  },
  script: "export default {}",
  subdomain: false,
};
const stack = { name: "MealPlanner", stage: "pilot-gaia-117" };

const hash = async (
  bindings: Parameters<
    WorkerMetadataHashModule["resolveWorkerMetadataHash"]
  >[0]["bindings"]
) => {
  const resolveWorkerMetadataHash = await loadWorkerMetadataHash();
  return Effect.runPromise(
    resolveWorkerMetadataHash({ accountId, bindings, props, stack })
  );
};

describe("installed Alchemy Worker metadata hashing", () => {
  it("ignores resource-provider outputs that are not sent to the Worker API", async () => {
    const first = await hash([
      {
        data: {
          bindings: [
            {
              databaseId: "physical-database",
              name: "ProviderAccountingDatabase",
              type: "d1",
            },
          ],
          databaseId: "first-plan-only-output",
          name: "ProviderAccountingDatabase",
        },
        sid: "ProviderAccountingDatabase",
      },
      {
        data: {
          className: "TikTokMediaContainer",
          containers: [
            {
              className: "TikTokMediaContainer",
              dev: { image: "first-local-image" },
            },
          ],
        },
        sid: "TikTokMediaContainer",
      },
    ]);
    const second = await hash([
      {
        data: {
          bindings: [
            {
              databaseId: "physical-database",
              name: "ProviderAccountingDatabase",
              type: "d1",
            },
          ],
          databaseId: "second-plan-only-output",
          name: "DifferentProviderLabel",
        },
        sid: "DifferentResourceSid",
      },
      {
        data: {
          className: "DifferentProviderClassLabel",
          containers: [
            {
              className: "TikTokMediaContainer",
              dev: { image: "second-local-image" },
            },
          ],
        },
        sid: "DifferentContainerSid",
      },
    ]);

    expect(second).toBe(first);
  });

  it("changes when the effective live binding metadata changes", async () => {
    const baseline = await hash([
      {
        data: {
          bindings: [
            {
              databaseId: "physical-database",
              name: "ProviderAccountingDatabase",
              type: "d1",
            },
          ],
          containers: [
            {
              className: "TikTokMediaContainer",
              dev: { image: "local-image" },
            },
          ],
        },
        sid: "CombinedBinding",
      },
    ]);
    const changedWireBinding = await hash([
      {
        data: {
          bindings: [
            {
              databaseId: "replacement-database",
              name: "ProviderAccountingDatabase",
              type: "d1",
            },
          ],
          containers: [
            {
              className: "TikTokMediaContainer",
              dev: { image: "local-image" },
            },
          ],
        },
        sid: "CombinedBinding",
      },
    ]);
    const changedContainerClass = await hash([
      {
        data: {
          bindings: [
            {
              databaseId: "physical-database",
              name: "ProviderAccountingDatabase",
              type: "d1",
            },
          ],
          containers: [
            {
              className: "ReplacementContainer",
              dev: { image: "local-image" },
            },
          ],
        },
        sid: "CombinedBinding",
      },
    ]);

    expect(changedWireBinding).not.toBe(baseline);
    expect(changedContainerClass).not.toBe(baseline);
  });
});
