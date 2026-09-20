import { Data } from "effect";

export class PrivateChatStorageFailure extends Data.TaggedError(
  "PrivateChatStorageFailure"
)<{
  readonly reason:
    | "invalid_message"
    | "invalid_event"
    | "invalid_cursor"
    | "binding_conflict"
    | "run_not_admitted"
    | "run_not_accepted"
    | "stale_snapshot"
    | "stream_closed"
    | "stream_unavailable"
    | "replay_limit";
}> {}
