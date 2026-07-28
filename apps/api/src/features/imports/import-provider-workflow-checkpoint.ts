import { Schema } from "effect";

import { AcquisitionCheckpointRejected } from "./import-acquisition-checkpoint.js";

export const ProviderTaskCheckpoint = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    code: Schema.String,
    stage: Schema.Literals(["recipe", "speech", "visual"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Succeeded"),
    stage: Schema.Literals(["recipe", "speech", "visual"]),
  }),
]);

export const SpeechProviderTaskCheckpoint = Schema.Union([
  AcquisitionCheckpointRejected,
  ProviderTaskCheckpoint,
]);
