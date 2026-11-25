import { Schema } from "effect";

/** Public health response contract shared by every HTTP host. */
export const HealthResponse = Schema.Struct({
  ok: Schema.Literal(true),
});

/** Decoded health response value. */
export type HealthResponse = typeof HealthResponse.Type;

/** Canonical healthy response emitted by the Meal Planner API. */
export const healthResponse: HealthResponse = { ok: true };
