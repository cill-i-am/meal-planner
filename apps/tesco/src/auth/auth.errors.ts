import { Data } from "effect";

export class TescoCredentialsRejected extends Data.TaggedError(
  "TescoCredentialsRejected"
) {}
