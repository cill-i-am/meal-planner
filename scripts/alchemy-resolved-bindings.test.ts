import { Resource } from "alchemy";
import type { Resource as AlchemyResource } from "alchemy";
import * as Provider from "alchemy/Provider";
import * as State from "alchemy/State";
import { scratchStack, toEffect } from "alchemy/Test/Core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

type NamespaceResource = AlchemyResource<
  "Test.Namespace",
  Record<string, never>,
  { namespaceId: string }
>;

type HostResource = AlchemyResource<
  "Test.Host",
  Record<string, never>,
  { hostId: string },
  { durableObjects: { namespaceId: string } }
>;

const NamespaceResource = Resource<NamespaceResource>("Test.Namespace");
const HostResource = Resource<HostResource>("Test.Host");

const namespaceId = "resolved-namespace-id";

const providers = Layer.mergeAll(
  Provider.succeed(NamespaceResource, {
    delete: () => Effect.void,
    list: () => Effect.succeed([]),
    reconcile: () => Effect.succeed({ namespaceId }),
  }),
  Provider.succeed(HostResource, {
    delete: () => Effect.void,
    list: () => Effect.succeed([]),
    reconcile: () => Effect.succeed({ hostId: "stable-host-id" }),
  })
);

const stack = Effect.gen(function* resolvedBindingStack() {
  const namespace = yield* NamespaceResource("Namespace", {});
  const host = yield* HostResource("Host", {});

  yield* host.bind("Namespace", {
    durableObjects: { namespaceId: namespace.namespaceId },
  });

  return { host, namespace };
});

describe("installed Alchemy resolved binding persistence", () => {
  it("commits resolved bindings so an unchanged follow-up plan is a noop", async () => {
    const scratch = scratchStack(
      { providers, stage: "test" },
      "resolved-binding-persistence"
    );

    await toEffect(scratch.deploy(stack), {
      providers,
      stage: "test",
      state: scratch.state,
    }).pipe(Effect.runPromise);

    const persisted = await Effect.gen(function* readPersistedState() {
      const state = yield* yield* State.State;
      return yield* state.get({
        fqn: "Host",
        stack: scratch.name,
        stage: "test",
      });
    }).pipe(Effect.provide(scratch.state), Effect.runPromise);
    const plan = await toEffect(scratch.plan(stack), {
      providers,
      stage: "test",
      state: scratch.state,
    }).pipe(Effect.runPromise);

    if (!persisted || !("bindings" in persisted)) {
      throw new Error("Expected terminal Host state with persisted bindings");
    }

    const persistedNamespaceId = (
      persisted.bindings?.[0]?.data as
        | { durableObjects?: { namespaceId?: unknown } }
        | undefined
    )?.durableObjects?.namespaceId;

    expect(typeof persistedNamespaceId).toBe("string");
    expect(persistedNamespaceId).toBe(namespaceId);
    expect(plan.resources["Host"]?.action).toBe("noop");
  });
});
