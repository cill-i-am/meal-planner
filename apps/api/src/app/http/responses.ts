import type { Schema } from "effect";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { BadRequestError, statusForError, toErrorBody } from "../errors.js";
import type { ApiError } from "../errors.js";

export const json = (body: unknown, status = 200) =>
  HttpServerResponse.json(body, { status }).pipe(Effect.orDie);

export const routeJson = <A, R>(
  effect: Effect.Effect<A, ApiError, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.flatMap((body) => json(body)),
    Effect.catch((error) => json(toErrorBody(error), statusForError(error)))
  );

const badBody =
  (name: string) =>
  (cause: unknown): BadRequestError =>
    new BadRequestError(`Invalid ${name} request body: ${String(cause)}`);

export const decodeBody = <A, I, RD, RE>(
  schema: Schema.Codec<A, I, RD, RE>,
  name: string
): Effect.Effect<
  A,
  BadRequestError,
  HttpServerRequest.HttpServerRequest | RD
> =>
  HttpServerRequest.schemaBodyJson(schema).pipe(Effect.mapError(badBody(name)));
