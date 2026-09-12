export const continuePrivateAssistantTurn = async (
  sessionReference: string,
  turnId: string,
  generation: string,
  signal: AbortSignal
): Promise<"accepted" | "authentication_required" | "unavailable"> => {
  const response = await fetch(
    `/v1/private-interviews/${encodeURIComponent(sessionReference)}/turns/${encodeURIComponent(turnId)}`,
    {
      credentials: "same-origin",
      headers: { "x-private-output-generation": generation },
      method: "POST",
      signal,
    }
  );
  if (response.status === 401) {
    return "authentication_required";
  }
  return response.status === 204 ? "accepted" : "unavailable";
};
