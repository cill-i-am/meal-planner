import { Schema } from "effect";
import { HttpApiSchema } from "effect/http-api";

export const FamilyUnauthorized = Schema.TaggedStruct("FamilyUnauthorized", {
  message: Schema.String,
}).pipe(HttpApiSchema.status(401));
export const FamilyForbidden = Schema.TaggedStruct("FamilyForbidden", {
  message: Schema.String,
}).pipe(HttpApiSchema.status(403));
export const FamilyNotFound = Schema.TaggedStruct("FamilyNotFound", {
  message: Schema.String,
}).pipe(HttpApiSchema.status(404));
export const FamilyInvalidInput = Schema.TaggedStruct("FamilyInvalidInput", {
  message: Schema.String,
}).pipe(HttpApiSchema.status(400));
export const FamilyConflict = Schema.TaggedStruct("FamilyConflict", {
  message: Schema.String,
  reason: Schema.Literals([
    "stale_version",
    "mutation_collision",
    "creation_incomplete",
  ]),
}).pipe(HttpApiSchema.status(409));
export const FamilyUnavailable = Schema.TaggedStruct("FamilyUnavailable", {
  message: Schema.String,
}).pipe(HttpApiSchema.status(503));
export const FamilyRateLimited = Schema.TaggedStruct("FamilyRateLimited", {
  message: Schema.String,
}).pipe(HttpApiSchema.status(429));
