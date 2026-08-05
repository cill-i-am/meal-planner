import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { TescoAuthSession } from "../auth/auth-session.port.js";
import { TescoCredentialsRejected } from "../auth/auth.errors.js";
import type { TescoAuthorization } from "../auth/auth.model.js";
import type { TescoCatalogueConfig } from "../tesco.config.js";
import {
  TescoAuthenticatedGraphQlTransport,
  TescoAuthenticatedRequestRejected,
  TescoAuthenticatedRequestUnavailable,
  TescoAuthenticatedResponseInvalid,
} from "./authenticated-graphql-transport.port.js";
import type {
  AuthenticatedGraphQlRead,
  TescoAuthenticatedGraphQlTransportError,
} from "./authenticated-graphql-transport.port.js";
import { TescoGraphQlErrorResponse } from "./xapi.protocol.js";

type AttemptResult =
  | { readonly _tag: "Unauthorized" }
  | { readonly _tag: "Success"; readonly json: Schema.Json };

const mangoHeaders = (
  config: TescoCatalogueConfig,
  authorization: TescoAuthorization
): Record<string, string> => {
  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-language": config.locale,
    "apollographql-client-name": "meal-planner-api",
    "apollographql-client-version": "0.1.0",
    authorization: Redacted.value(authorization),
    "content-type": "application/json",
    language: config.locale,
    region: config.region,
    "x-apikey": Redacted.value(config.mangoApiKey),
  };

  if (config.transactionPurpose !== null) {
    headers["transaction-purpose"] = config.transactionPurpose;
  }
  if (config.releaseBranch !== null) {
    headers["release-branch"] = config.releaseBranch;
  }

  return headers;
};

const isUnavailableStatus = (status: number): boolean =>
  status === 429 || status >= 500;

/** Live Tesco GraphQL transport with operation-specific replay policy. */
export const makeTescoAuthenticatedGraphQlTransportLive = (
  config: TescoCatalogueConfig
) =>
  Layer.effect(
    TescoAuthenticatedGraphQlTransport,
    Effect.gen(function* makeAuthenticatedGraphQlTransport() {
      const authSession = yield* TescoAuthSession;
      const client = yield* HttpClient.HttpClient;

      const executeOnce = Effect.fn("TescoGraphQlTransport.executeOnce")(
        function* executeOnce(
          operation: AuthenticatedGraphQlRead,
          authorization: TescoAuthorization
        ): Effect.fn.Return<
          AttemptResult,
          | TescoAuthenticatedRequestUnavailable
          | TescoAuthenticatedRequestRejected
          | TescoAuthenticatedResponseInvalid
        > {
          const httpRequest = HttpClientRequest.post(config.mangoUrl, {
            body: HttpBody.jsonUnsafe({
              operationName: operation.read.operationName,
              query: operation.read.document,
              variables: operation.variables,
            }),
            headers: mangoHeaders(config, authorization),
          });
          const response = yield* client.execute(httpRequest).pipe(
            Effect.mapError(
              () =>
                new TescoAuthenticatedRequestUnavailable({
                  operation: operation.operation,
                })
            )
          );

          if (response.status === 401) {
            return { _tag: "Unauthorized" };
          }
          if (isUnavailableStatus(response.status)) {
            return yield* new TescoAuthenticatedRequestUnavailable({
              operation: operation.operation,
            });
          }
          if (response.status < 200 || response.status >= 300) {
            return yield* new TescoAuthenticatedRequestRejected({
              operation: operation.operation,
            });
          }

          const unknownJson = yield* response.json.pipe(
            Effect.mapError(
              () =>
                new TescoAuthenticatedResponseInvalid({
                  operation: operation.operation,
                })
            )
          );
          const json = yield* Schema.decodeUnknownEffect(Schema.Json)(
            unknownJson
          ).pipe(
            Effect.mapError(
              () =>
                new TescoAuthenticatedResponseInvalid({
                  operation: operation.operation,
                })
            )
          );

          if (
            Option.isSome(
              Schema.decodeUnknownOption(TescoGraphQlErrorResponse)(json)
            )
          ) {
            return yield* new TescoAuthenticatedRequestRejected({
              operation: operation.operation,
            });
          }

          return { _tag: "Success", json };
        }
      );

      const execute = Effect.fn("TescoGraphQlTransport.execute")(
        function* execute(
          operation: AuthenticatedGraphQlRead
        ): Effect.fn.Return<
          Schema.Json,
          TescoAuthenticatedGraphQlTransportError
        > {
          const authorization = yield* authSession.authorization;
          const firstAttempt = yield* executeOnce(operation, authorization);
          if (firstAttempt._tag === "Success") {
            return firstAttempt.json;
          }

          const refreshedAuthorization =
            yield* authSession.refreshAfterUnauthorized(authorization);
          const replay = yield* executeOnce(operation, refreshedAuthorization);
          if (replay._tag === "Unauthorized") {
            return yield* new TescoCredentialsRejected();
          }
          return replay.json;
        }
      );

      return TescoAuthenticatedGraphQlTransport.of({ execute });
    })
  );
