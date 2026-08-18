import type { Effect, Schema } from "effect";
import { Context, Data } from "effect";

import type { TescoAuthSessionError } from "../auth/auth.errors.js";
import type { ReadOnlyGraphQlOperation } from "./graphql-read-operation.js";

/** GraphQL reads whose fixed documents make one post-refresh replay safe. */
export type TescoReplayableReadOperation = "search" | "category_products";

/** One source-controlled, AST-proven Tesco GraphQL read. */
export interface AuthenticatedGraphQlRead {
  readonly operation: TescoReplayableReadOperation;
  readonly read: ReadOnlyGraphQlOperation;
  readonly variables: Readonly<Record<string, Schema.Json>>;
}

/** An authenticated Tesco request failed before receiving a response. */
export const TescoAuthenticatedRequestUnavailable = Data.TaggedError(
  "TescoAuthenticatedRequestUnavailable"
)<{
  readonly operation: TescoReplayableReadOperation;
}>;
export type TescoAuthenticatedRequestUnavailable = InstanceType<
  typeof TescoAuthenticatedRequestUnavailable
>;

/** Tesco rejected an authenticated request or GraphQL operation. */
export const TescoAuthenticatedRequestRejected = Data.TaggedError(
  "TescoAuthenticatedRequestRejected"
)<{
  readonly operation: TescoReplayableReadOperation;
}>;
export type TescoAuthenticatedRequestRejected = InstanceType<
  typeof TescoAuthenticatedRequestRejected
>;

/** Tesco returned an unreadable authenticated response. */
export const TescoAuthenticatedResponseInvalid = Data.TaggedError(
  "TescoAuthenticatedResponseInvalid"
)<{
  readonly operation: TescoReplayableReadOperation;
}>;
export type TescoAuthenticatedResponseInvalid = InstanceType<
  typeof TescoAuthenticatedResponseInvalid
>;

/** Expected failures from the authenticated Tesco GraphQL transport. */
export type TescoAuthenticatedGraphQlTransportError =
  | TescoAuthSessionError
  | TescoAuthenticatedRequestUnavailable
  | TescoAuthenticatedRequestRejected
  | TescoAuthenticatedResponseInvalid;

/** Authenticated Tesco GraphQL transport capability. */
export interface TescoAuthenticatedGraphQlTransport {
  readonly execute: (
    operation: AuthenticatedGraphQlRead
  ) => Effect.Effect<Schema.Json, TescoAuthenticatedGraphQlTransportError>;
}

/** Service tag for authenticated Tesco GraphQL transport policy. */
export const TescoAuthenticatedGraphQlTransport =
  Context.Service<TescoAuthenticatedGraphQlTransport>(
    "meal-planner/TescoAuthenticatedGraphQlTransport"
  );
