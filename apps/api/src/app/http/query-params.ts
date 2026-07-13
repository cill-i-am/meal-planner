import { Effect, Schema } from "effect";

import { BadRequestError } from "../errors.js";

export const urlFromRequest = (requestUrl: string): URL =>
  new URL(requestUrl, "http://localhost");

const invalidParam =
  (name: string) =>
  (cause: unknown): BadRequestError =>
    new BadRequestError(`Invalid query parameter "${name}": ${String(cause)}`);

const decodeParam = <A, I, RD, RE>(
  schema: Schema.Codec<A, I, RD, RE>,
  name: string,
  value: string
): Effect.Effect<A, BadRequestError, RD> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(invalidParam(name))
  );

export const requiredParam = <A, I, RD, RE>(
  url: URL,
  name: string,
  schema: Schema.Codec<A, I, RD, RE>
): Effect.Effect<A, BadRequestError, RD> => {
  const value = url.searchParams.get(name);
  if (value === null) {
    return Effect.fail(
      new BadRequestError(`Missing required query parameter: ${name}`)
    );
  }
  return decodeParam(schema, name, value);
};

export const optionalParam = <A, I, RD, RE>(
  url: URL,
  name: string,
  schema: Schema.Codec<A, I, RD, RE>
): Effect.Effect<A | undefined, BadRequestError, RD> => {
  const value = url.searchParams.get(name);
  if (value === null) {
    return Effect.succeed(undefined);
  }
  return decodeParam(schema, name, value);
};
