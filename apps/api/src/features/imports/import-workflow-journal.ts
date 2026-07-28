import { Schema } from "effect";

export const PostAcquisitionJournalCheckpoint = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("ResolvedWithoutFinalization"),
    lastSuccessfulStep: Schema.Literal("resolve-acquire-store-verify-v2"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("FinalizedWithoutSpeech"),
    lastSuccessfulStep: Schema.Literal("record-acquisition-v2"),
  }),
]);
export type PostAcquisitionJournalCheckpoint =
  typeof PostAcquisitionJournalCheckpoint.Type;

export const postAcquisitionRestartOptions = (
  checkpoint: PostAcquisitionJournalCheckpoint
): {
  readonly from: {
    readonly name: "record-acquisition-v2" | "resolve-acquire-store-verify-v2";
    readonly type: "do";
  };
} =>
  checkpoint._tag === "ResolvedWithoutFinalization"
    ? {
        from: {
          name: "resolve-acquire-store-verify-v2",
          type: "do",
        },
      }
    : {
        from: {
          name: "record-acquisition-v2",
          type: "do",
        },
      };
