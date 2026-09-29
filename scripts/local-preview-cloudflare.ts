import {
  AlchemyProfile,
  AuthProviders,
  CredentialsStoreLive,
  getAuthProvider,
  ProfileLive,
} from "alchemy/Auth";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import { Cause, Effect, Layer, Redacted, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

// The pinned Alchemy version has no public Cloudflare auth-provider export.
// This is the same existing-profile seam used by alchemy-d1-preflight.ts.
import { CloudflareAuth } from "../node_modules/alchemy/lib/Cloudflare/Auth/AuthProvider.js";
import type {
  CloudflareAuthConfig,
  CloudflareResolvedCredentials,
} from "../node_modules/alchemy/lib/Cloudflare/Auth/AuthProvider.js";

const AccountId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/u));
const localPreviewScopes = ["account:read", "ai:read", "ai:write"];
const ExistingProfile = Schema.Struct({
  accountId: AccountId,
  method: Schema.Literal("oauth"),
  scopes: Schema.mutable(Schema.Array(Schema.String)),
});

/** Read or renew the AI-only login without deploying or creating cloud resources. */
export const localPreviewCloudflare = async (
  profile: string,
  expectedAccount: string,
  options: { readonly refreshLogin?: boolean } = {}
) => {
  const accountId = Schema.decodeUnknownSync(AccountId)(expectedAccount);
  const base = Layer.mergeAll(
    PlatformServices,
    Layer.provide(ProfileLive, PlatformServices),
    Layer.provide(CredentialsStoreLive, PlatformServices),
    FetchHttpClient.layer,
    Layer.succeed(AuthProviders, {})
  );
  const credentials = await Effect.runPromise(
    Effect.gen(function* readExistingProfile() {
      const profiles = yield* AlchemyProfile;
      const selected = yield* profiles.getProfile(profile);
      const existing = selected?.["Cloudflare"];
      const config = yield* Schema.decodeUnknownEffect(ExistingProfile)(
        existing === undefined && options.refreshLogin
          ? { accountId, method: "oauth", scopes: localPreviewScopes }
          : existing
      );
      if (
        config.accountId !== accountId ||
        config.scopes.length !== localPreviewScopes.length ||
        localPreviewScopes.some((scope) => !config.scopes.includes(scope))
      ) {
        return yield* Effect.fail(
          new Error("Use an AI-only OAuth profile for the selected account.")
        );
      }
      const provider = yield* getAuthProvider<
        CloudflareAuthConfig,
        CloudflareResolvedCredentials
      >("Cloudflare");
      if (options.refreshLogin) {
        yield* provider.login(profile, config);
        if (existing === undefined) {
          yield* profiles.setProfile(profile, {
            ...selected,
            Cloudflare: config,
          });
        }
      }
      return yield* provider.read(profile, config);
    }).pipe(
      Effect.provide(Layer.provideMerge(CloudflareAuth, base)),
      Effect.scoped,
      Effect.timeout(options.refreshLogin ? "10 minutes" : "30 seconds"),
      Effect.catchCause((cause) => {
        const categories = cause.reasons.map((reason) => {
          if (!Cause.isFailReason(reason)) {
            return reason._tag;
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
