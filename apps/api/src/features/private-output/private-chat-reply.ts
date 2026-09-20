import { Schema } from "effect";

/** The accepted application reply. Tool arguments and model reasoning are never chat history. */
export const PrivateChatReply = Schema.Struct({
  createdAt: Schema.Number,
  messageId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  text: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4000))
  ),
  type: Schema.Literal("PrivateDiscoveryReply"),
});
export type PrivateChatReply = typeof PrivateChatReply.Type;
