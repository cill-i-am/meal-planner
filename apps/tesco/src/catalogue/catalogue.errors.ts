import { Data } from "effect";

/** Bounded Tesco catalogue operations safe to attach to telemetry. */
export type TescoCatalogueOperation =
  | "search"
  | "category_products"
  | "suggestions";

/** The Tesco catalogue cannot authenticate the current read. */
export const TescoCatalogueAuthenticationUnavailable = Data.TaggedError(
  "TescoCatalogueAuthenticationUnavailable"
)<{
  readonly operation: TescoCatalogueOperation;
}>;
export type TescoCatalogueAuthenticationUnavailable = InstanceType<
  typeof TescoCatalogueAuthenticationUnavailable
>;

/** The Tesco catalogue dependency is temporarily unavailable. */
export const TescoCatalogueUnavailable = Data.TaggedError(
  "TescoCatalogueUnavailable"
)<{
  readonly operation: TescoCatalogueOperation;
}>;
export type TescoCatalogueUnavailable = InstanceType<
  typeof TescoCatalogueUnavailable
>;

/** Tesco rejected a syntactically valid catalogue request. */
export const TescoCatalogueRequestRejected = Data.TaggedError(
  "TescoCatalogueRequestRejected"
)<{
  readonly operation: TescoCatalogueOperation;
}>;
export type TescoCatalogueRequestRejected = InstanceType<
  typeof TescoCatalogueRequestRejected
>;

/** Tesco returned a catalogue response that could not be trusted. */
export const TescoCatalogueResponseInvalid = Data.TaggedError(
  "TescoCatalogueResponseInvalid"
)<{
  readonly operation: TescoCatalogueOperation;
}>;
export type TescoCatalogueResponseInvalid = InstanceType<
  typeof TescoCatalogueResponseInvalid
>;

/** Expected failures exposed by the Tesco catalogue feature. */
export type TescoCatalogueError =
  | TescoCatalogueAuthenticationUnavailable
  | TescoCatalogueUnavailable
  | TescoCatalogueRequestRejected
  | TescoCatalogueResponseInvalid;
