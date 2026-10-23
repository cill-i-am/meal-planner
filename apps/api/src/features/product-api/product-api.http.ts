import { Effect } from "effect";

import type { MealPlannerAuthService } from "../auth/auth.alchemy.js";
import {
  DelegatedAccess,
  delegatedAccessChallenge,
  protectedResourceMetadata,
} from "../auth/delegated-access.js";
import { readProductAccount } from "./product-account.js";
import { productOpenApi } from "./product-api.contract.js";
import type { ProductScope } from "./product-api.contract.js";
import { matchProductOperation } from "./product-api.transport.js";
import { handleProductMcp } from "./product-mcp.js";

export interface ProductHttpOptions {
  readonly auth: MealPlannerAuthService;
  readonly baseURL: string;
  readonly dispatch: (request: Request) => Effect.Effect<Response>;
  readonly rateLimit: (key: string) => Effect.Effect<boolean>;
}

const publicDiscovery = (request: Request, options: ProductHttpOptions) => {
  const url = new URL(request.url);
  const metadataResource = ["mcp", "v1"].find(
    (resource) =>
      url.pathname === `/.well-known/oauth-protected-resource/${resource}`
  );
  if (metadataResource !== undefined) {
    if (!options.auth.delegatedAccessEnabled) {
      return Response.json(
        { error: "public_origin_not_configured" },
        { status: 503 }
      );
    }
    if (request.method !== "GET") {
      return new Response(null, { headers: { allow: "GET" }, status: 405 });
    }
    return Response.json(
      protectedResourceMetadata(
        options.baseURL,
        `${options.baseURL}/${metadataResource}`
      ),
      {
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      }
    );
  }
  if (url.pathname === "/v1/openapi.json") {
    if (request.method !== "GET") {
      return new Response(null, { headers: { allow: "GET" }, status: 405 });
    }
    return Response.json(productOpenApi(options.baseURL), {
      headers: { "cache-control": "public, max-age=300" },
    });
  }
  return null;
};

/** OAuth admission is shared by HTTP and MCP; handlers retain domain authority. */
export const handleProductHttp = (
  request: Request,
  options: ProductHttpOptions
) =>
  Effect.gen(function* serveProductHttp() {
    const discovery = publicDiscovery(request, options);
    if (discovery !== null) {
      return discovery;
    }
    const url = new URL(request.url);
    const mcp = url.pathname === "/mcp";
    const dispatch = (applicationRequest: Request) =>
      new URL(applicationRequest.url).pathname === "/v1/account" &&
      applicationRequest.method === "GET"
        ? readProductAccount(options.auth, applicationRequest)
        : options.dispatch(applicationRequest);
    if (
      url.pathname === "/v1/account" &&
      request.method === "GET" &&
      !request.headers.has("authorization")
    ) {
      const response = yield* dispatch(request);
      response.headers.set("cache-control", "no-store");
      return response;
    }
    if (
      !mcp &&
      (!url.pathname.startsWith("/v1/") ||
        !request.headers.has("authorization"))
    ) {
      return null;
    }
    if (!options.auth.delegatedAccessEnabled) {
      return Response.json(
        { error: "public_origin_not_configured" },
        { status: 503 }
      );
    }
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== options.baseURL) {
      return Response.json({ error: "origin_not_allowed" }, { status: 403 });
    }
    const operation = mcp
      ? undefined
      : matchProductOperation(request.method, url.pathname);
    if (!mcp && operation === undefined) {
      return Response.json(
        { error: "operation_not_available" },
        { status: 404 }
      );
    }
    const resource = `${options.baseURL}/${mcp ? "mcp" : "v1"}`;
    const scopes: readonly ProductScope[] = operation?.scopes ?? [];
    const run = (
      applicationRequest: Request,
      requiredScopes: readonly ProductScope[],
      effect: Effect.Effect<Response>
    ) =>
      options.auth
        .withDelegatedAccess(
          applicationRequest,
          resource,
          requiredScopes,
          Effect.gen(function* admitAccountRequest() {
            const grant = yield* DelegatedAccess;
            if (grant === undefined) {
              return new Response(null, { status: 401 });
            }
            if (!(yield* options.rateLimit(grant.user.id))) {
              return Response.json(
                { error: "rate_limited" },
                { headers: { "retry-after": "60" }, status: 429 }
              );
            }
            return yield* effect;
          })
        )
        .pipe(
          Effect.catchTag("DelegatedAccessFailure", (failure) =>
            Effect.succeed(
              Response.json(
                { error: failure.reason },
                {
                  headers: {
                    "cache-control": "no-store",
                    "www-authenticate": delegatedAccessChallenge(failure),
                  },
                  status: failure.statusCode,
                }
              )
            )
          )
        );
    return yield* run(
      request,
      scopes,
      Effect.gen(function* serveAuthorizedProductRequest() {
        const grant = yield* DelegatedAccess;
        if (grant === undefined) {
          return new Response(null, { status: 401 });
        }
        const response = mcp
          ? yield* handleProductMcp(request, {
              call: (applicationRequest, requiredScopes) =>
                run(
                  applicationRequest,
                  requiredScopes,
                  dispatch(applicationRequest)
                ),
              permits: (requiredScopes) =>
                requiredScopes.every((scope) => grant.scopes.includes(scope)),
            }).pipe(
              Effect.scoped,
              Effect.orElseSucceed(() =>
                Response.json({ error: "mcp_unavailable" }, { status: 503 })
              )
            )
          : yield* dispatch(request);
        response.headers.set("cache-control", "no-store");
        return response;
      })
    );
  });
