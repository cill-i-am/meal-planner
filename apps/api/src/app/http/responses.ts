import type { Schema } from "effect";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { InvalidRequest, toHttpFailureResponse } from "./http-failure.js";
import type { HttpFailure } from "./http-failure.js";

export const json = (body: unknown, status = 200) =>
  HttpServerResponse.json(body, { status }).pipe(Effect.orDie);

export const routeJson = <A, R>(
  effect: Effect.Effect<A, HttpFailure, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.flatMap((body) => json(body)),
    Effect.catch((error) => {
      const response = toHttpFailureResponse(error);
      return json(response.body, response.status);
    })
  );

const invalidBody = (): InvalidRequest =>
  new InvalidRequest({ location: "body" });

export const decodeBody = <A, I, RD, RE>(
  schema: Schema.Codec<A, I, RD, RE>
): Effect.Effect<A, InvalidRequest, HttpServerRequest.HttpServerRequest | RD> =>
  HttpServerRequest.schemaBodyJson(schema).pipe(Effect.mapError(invalidBody));
