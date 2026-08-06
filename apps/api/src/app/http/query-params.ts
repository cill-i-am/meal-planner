import { Effect, Schema } from "effect";

import { InvalidRequest } from "./http-failure.js";

export const urlFromRequest = (requestUrl: string): URL =>
  new URL(requestUrl, "http://localhost");

const invalidParam = (): InvalidRequest =>
  new InvalidRequest({ location: "query" });

const decodeParam = <A, I, RD, RE>(
  schema: Schema.Codec<A, I, RD, RE>,
  value: string
): Effect.Effect<A, InvalidRequest, RD> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(invalidParam));

export const requiredParam = <A, I, RD, RE>(
  url: URL,
  name: string,
  schema: Schema.Codec<A, I, RD, RE>
): Effect.Effect<A, InvalidRequest, RD> => {
  const value = url.searchParams.get(name);
  if (value === null) {
    return Effect.fail(new InvalidRequest({ location: "query" }));
  }
  return decodeParam(schema, value);
};

export const optionalParam = <A, I, RD, RE>(
  url: URL,
  name: string,
  schema: Schema.Codec<A, I, RD, RE>
): Effect.Effect<A | undefined, InvalidRequest, RD> => {
  const value = url.searchParams.get(name);
  if (value === null) {
    return Effect.succeed(undefined);
  }
  return decodeParam(schema, value);
};
