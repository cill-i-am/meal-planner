import { Schema, Effect } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import type { MealPlannerAuthService } from "../auth/auth.alchemy.js";

const Account = Schema.Struct({
  email: Schema.String,
  emailVerified: Schema.Boolean,
  id: Schema.String,
  name: Schema.String,
});

export const ProductAccountApi = HttpApi.make("productAccountApi").add(
  HttpApiGroup.make("account").add(
    HttpApiEndpoint.get("read", "/v1/account", { success: Account })
  )
);

/** Session tokens and other login material never enter the product response. */
export const readProductAccount = (
  auth: MealPlannerAuthService,
  request: Request
) =>
  auth.api.getSession({ headers: request.headers }).pipe(
    Effect.flatMap((session) =>
      session === null
        ? Effect.succeed(
            Response.json({ error: "unauthorized" }, { status: 401 })
          )
        : Schema.decodeUnknownEffect(Account)({
            email: session.user.email,
            emailVerified: session.user.emailVerified,
            id: session.user.id,
            name: session.user.name,
          }).pipe(Effect.map((account) => Response.json(account)))
    ),
    Effect.orElseSucceed(() =>
      Response.json({ error: "account_unavailable" }, { status: 503 })
    )
  );
