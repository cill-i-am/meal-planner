import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import type { OAuthOptions } from "@better-auth/oauth-provider";
import { UserId } from "@meal-planner/household-api";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { stripAccessTokenAuthorizationScheme } from "better-auth/oauth2";
import { Option, Schema } from "effect";

export const OAuthLifecycleRequest = Schema.Struct({
  parameters: Schema.Record(Schema.String, Schema.String),
  path: Schema.String,
});

/** Native endpoint paths whose complete handler shares one account dispatch claim. */
export const oauthLifecyclePaths = new Set([
  "/oauth2/authorize",
  "/oauth2/consent",
  "/oauth2/continue",
  "/oauth2/delete-consent",
  "/oauth2/revoke",
  "/oauth2/token",
  "/oauth2/update-consent",
]);

const TokenOwner = Schema.NullOr(
  Schema.Struct({ userId: Schema.NullOr(UserId) })
);
const parseTokenOwner = Schema.decodeUnknownSync(TokenOwner);
const AuthorizationCodeOwner = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.Struct({ client_id: Schema.String }),
    type: Schema.Literal("authorization_code"),
    userId: UserId,
  })
);
const invalidGrant = () =>
  new APIError("BAD_REQUEST", {
    error: "invalid_grant",
    error_description: "The OAuth grant is no longer available.",
  });
type OAuthContext = Parameters<typeof getOAuthProviderApi>[0];

const findTokenAccount = async (
  ctx: OAuthContext,
  model: "oauthAccessToken" | "oauthRefreshToken",
  field: "authorizationCodeId" | "token",
  value: string
) => {
  const row = await ctx.context.adapter.findOne({
    model,
    where: [{ field, value }],
  });
  {
    const checkedResult:
      | Awaited<Promise<UserId | null>>
      | Promise<UserId | null> = parseTokenOwner(row)?.userId ?? null;
    return checkedResult;
  }
};

const findAuthorizationCodeAccount = async (
  ctx: OAuthContext,
  options: OAuthOptions<string[]>,
  code: string
) => {
  const identifier = await getOAuthProviderApi(ctx, options).hashToken(
    code,
    "authorization_code"
  );
  const verification =
    await ctx.context.internalAdapter.findVerificationValue(identifier);
  if (verification !== null) {
    const owner = Schema.decodeUnknownOption(AuthorizationCodeOwner)(
      verification.value
    );
    if (Option.isNone(owner)) {
      throw invalidGrant();
    }
    {
      const checkedResult:
        | Awaited<Promise<UserId | null>>
        | Promise<UserId | null> = owner.value.userId;
      return checkedResult;
    }
  }

  const [accessAccount, refreshAccount] = await Promise.all([
    findTokenAccount(
      ctx,
      "oauthAccessToken",
      "authorizationCodeId",
      identifier
    ),
    findTokenAccount(
      ctx,
      "oauthRefreshToken",
      "authorizationCodeId",
      identifier
    ),
  ]);
  if (
    accessAccount !== null &&
    refreshAccount !== null &&
    accessAccount !== refreshAccount
  ) {
    throw invalidGrant();
  }
  {
    const checkedResult:
      | Awaited<Promise<UserId | null>>
      | Promise<UserId | null> = accessAccount ?? refreshAccount;
    return checkedResult;
  }
};

/** Resolve only serialization identity; the native endpoint validates all OAuth authority. */
export const resolveOAuthLifecycleAccount = async (
  ctx: OAuthContext,
  options: OAuthOptions<string[]>,
  body: typeof OAuthLifecycleRequest.Type
) => {
  if (!oauthLifecyclePaths.has(body.path)) {
    const checkedResult:
      | Awaited<Promise<UserId | null>>
      | Promise<UserId | null> = null;
    return checkedResult;
  }
  const provider = getOAuthProviderApi(ctx, options);
  if (body.path === "/oauth2/token") {
    let account: UserId | null = null;
    if (
      body.parameters["grant_type"] === "authorization_code" &&
      body.parameters["code"]
    ) {
      account = await findAuthorizationCodeAccount(
        ctx,
        options,
        body.parameters["code"]
      );
    } else if (
      body.parameters["grant_type"] === "refresh_token" &&
      body.parameters["refresh_token"]
    ) {
      account = await findTokenAccount(
        ctx,
        "oauthRefreshToken",
        "token",
        await provider.hashToken(
          body.parameters["refresh_token"],
          "refresh_token"
        )
      );
    }

    if (account === null) {
      throw invalidGrant();
    }
    {
      const checkedResult:
        | Awaited<Promise<UserId | null>>
        | Promise<UserId | null> = account;
      return checkedResult;
    }
  }
  if (body.path === "/oauth2/revoke") {
    const token = stripAccessTokenAuthorizationScheme(
      body.parameters["token"] ?? ""
    );
    const hint = body.parameters["token_type_hint"];
    if (token.length === 0) {
      const checkedResult:
        | Awaited<Promise<UserId | null>>
        | Promise<UserId | null> = null;
      return checkedResult;
    }
    if (hint !== "refresh_token") {
      const account = await findTokenAccount(
        ctx,
        "oauthAccessToken",
        "token",
        await provider.hashToken(token, "access_token")
      );
      if (account !== null) {
        const checkedResult:
          | Awaited<Promise<UserId | null>>
          | Promise<UserId | null> = account;
        return checkedResult;
      }
    }
    if (hint !== "access_token") {
      const account = await findTokenAccount(
        ctx,
        "oauthRefreshToken",
        "token",
        await provider.hashToken(token, "refresh_token")
      );
      if (account !== null) {
        const checkedResult:
          | Awaited<Promise<UserId | null>>
          | Promise<UserId | null> = account;
        return checkedResult;
      }
    }

    {
      const checkedResult:
        | Awaited<Promise<UserId | null>>
        | Promise<UserId | null> = null;
      return checkedResult;
    }
  }
  const session = await getSessionFromCtx(ctx);
  {
    const checkedResult:
      | Awaited<Promise<UserId | null>>
      | Promise<UserId | null> =
      session === null
        ? null
        : Schema.decodeUnknownSync(UserId)(session.user.id);
    return checkedResult;
  }
};
