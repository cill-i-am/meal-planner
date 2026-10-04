import {
  AuthError,
  AuthProviders,
  CredentialsStoreLive,
  getAuthProvider,
  ProfileStore,
  ProfileStoreLive,
} from "alchemy/Auth";
import * as CliKit from "alchemy/Cli/CliKit";
import * as Interaction from "alchemy/Interaction";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import { Cause, Effect, Layer, Redacted, Schema } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import type {
  CloudflareAuthConfig,
  CloudflareResolvedCredentials,
} from "../node_modules/alchemy/lib/Cloudflare/Auth/AuthConfig.js";
// The pinned Alchemy version has no public Cloudflare auth-provider export.
import { CloudflareAuth } from "../node_modules/alchemy/lib/Cloudflare/Auth/AuthProvider.js";

const AccountId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/u));
const localPreviewScopes = [
  "memberships.read",
  "account-settings.read",
  "ai.read",
  "ai.write",
  "aig.run",
];
const LimitedOAuth = Schema.Struct({
  access: Schema.String,
  accountId: AccountId,
  clientId: Schema.optional(Schema.String),
  expires: Schema.Number,
  method: Schema.Literal("oauth"),
  refresh: Schema.String,
  scopes: Schema.mutable(Schema.Array(Schema.String)),
});

/** Read or renew the AI-only login without deploying or creating cloud resources. */
export const localPreviewCloudflare = async (
  profile: string,
  expectedAccount: string,
  options: { readonly refreshLogin?: boolean } = {}
) => {
  const accountId = Schema.decodeUnknownSync(AccountId)(expectedAccount);
  const interaction = options.refreshLogin
    ? Layer.provide(CliKit.CliKitInteraction, CliKit.layer())
    : Interaction.layerNonInteractive();
  const base = Layer.mergeAll(
    PlatformServices,
    Layer.provide(ProfileStoreLive, PlatformServices),
    Layer.provide(CredentialsStoreLive, PlatformServices),
    FetchHttpClient.layer,
    interaction,
    Layer.succeed(AuthProviders, {})
  );
  const credentials = await Effect.runPromise(
    Effect.gen(function* readExistingProfile() {
      const profiles = yield* ProfileStore;
      const selected = yield* profiles.getProfile(profile);
      const existing = selected?.providers["Cloudflare"];
      if (existing === undefined && !options.refreshLogin) {
        return yield* Effect.fail(
          new Error(
            `Cloudflare is not configured in Alchemy profile '${profile}'. Start once with --login to add its limited OAuth login.`
          )
        );
      }
      const provider = yield* getAuthProvider<
        CloudflareAuthConfig,
        CloudflareResolvedCredentials
      >("Cloudflare");
      const config =
        existing === undefined
          ? ({
              access: "",
              accountId,
              expires: 0,
              method: "oauth",
              refresh: "",
              scopes: [...localPreviewScopes],
            } satisfies CloudflareAuthConfig)
          : yield* provider.decodeConfig(profile, existing);
      if (config.method !== "oauth") {
        return yield* Effect.fail(
          new Error("Use an AI-only OAuth profile for the selected account.")
        );
      }
      const limited = yield* Schema.decodeUnknownEffect(LimitedOAuth)(config);
      if (
        limited.accountId !== accountId ||
        limited.scopes.length !== localPreviewScopes.length ||
        localPreviewScopes.some((scope) => !limited.scopes.includes(scope))
      ) {
        return yield* Effect.fail(
          new Error("Use an AI-only OAuth profile for the selected account.")
        );
      }
      const persist = (next: CloudflareAuthConfig) =>
        profiles.setProviderConfig(profile, "Cloudflare", next).pipe(
          Effect.mapError(
            () =>
              new AuthError({
                message: "Could not save refreshed Cloudflare credentials.",
              })
          )
        );
      let current: CloudflareAuthConfig = limited;
      if (options.refreshLogin) {
        if (selected === undefined) {
          yield* profiles.ensureProfile(profile);
        }
        const refreshed = yield* provider.login(profile, limited, persist);
        if (refreshed !== undefined) {
          current = refreshed;
          yield* persist(refreshed);
        }
      }
      return yield* provider.read(profile, current, persist);
    }).pipe(
      Effect.provide(Layer.provideMerge(CloudflareAuth, base)),
      Effect.scoped,
      Effect.timeout(options.refreshLogin ? "10 minutes" : "30 seconds"),
      Effect.catchCause((cause) => {
        const categories = cause.reasons.map((reason) => {
          if (!Cause.isFailReason(reason)) {
            return reason._tag;
          }
          if (
            reason.error instanceof Error &&
            (reason.error.message.startsWith(
              "Cloudflare is not configured in Alchemy profile"
            ) ||
              reason.error.message ===
                "Use an AI-only OAuth profile for the selected account.")
          ) {
            return reason.error.message;
          }
          const parsed = Schema.decodeUnknownOption(
            Schema.Struct({ _tag: Schema.String })
          )(reason.error);
          return parsed._tag === "Some" ? parsed.value._tag : "Error";
        });
        return Effect.fail(new Error(categories.join(", ")));
      })
    )
  ).catch((error: Error) => {
    throw new Error(
      `Could not read the selected Cloudflare login (${error.message}). Sign in to that Alchemy profile and retry.`
    );
  });
  if (credentials.accountId !== accountId) {
    throw new Error("The Cloudflare profile resolves to a different account.");
  }
  if (credentials.type !== "oauth") {
    throw new Error("Local AI preview requires its AI-only OAuth profile.");
  }
  const token = credentials.accessToken;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}`,
    {
      headers: { Authorization: `Bearer ${Redacted.value(token)}` },
      signal: AbortSignal.timeout(30_000),
    }
  ).catch(() => {
    throw new Error("Cloudflare account verification could not connect.");
  });
  if (!response.ok) {
    throw new Error(
      `Cloudflare account verification failed (HTTP ${response.status}).`
    );
  }
  const verified = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ id: AccountId, name: Schema.String }),
      success: Schema.Literal(true),
    })
  )(await response.json());
  if (verified.result.id !== accountId) {
    throw new Error("Cloudflare returned a different account.");
  }
  return { accountId, accountName: verified.result.name, token };
};
