import { Schema } from "effect";

import { ConversationAccess } from "./conversation.contract.js";

export const conversationScopeKey = (access: typeof ConversationAccess.Type) =>
  access.scope._tag === "AccountPrivateSetup"
    ? access.accountKey
    : access.scope.familyId;

/** Native object name is derived from one immutable authority scope. */
export const conversationObjectName = async (
  untrusted: typeof ConversationAccess.Type
) => {
  const access = Schema.decodeUnknownSync(ConversationAccess, {
    onExcessProperty: "error",
  })(untrusted);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        "agent-conversation",
        1,
        access.scope._tag,
        conversationScopeKey(access),
      ])
    )
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};
