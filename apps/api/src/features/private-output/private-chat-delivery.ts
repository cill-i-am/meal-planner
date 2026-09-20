/** Authorize each physical HTTP delivery after its asynchronous read. */
export const fencePrivateChatResponse = (
  response: Response,
  authorized: () => boolean,
  signal: AbortSignal,
  onComplete?: () => void
): Response => {
  if (!authorized() || signal.aborted) {
    void response.body?.cancel();
    onComplete?.();
    return new Response(null, { status: 403 });
  }
  if (response.body === null) {
    onComplete?.();
    return response;
  }
  const reader = response.body.getReader();
  let finished = false;
  const cancelReader = async () => {
    try {
      await reader.cancel();
    } catch {
      // An upstream read may already have failed when revocation cancels it.
    }
  };
  const abort = () => {
    void cancelReader();
  };
  const cleanup = () => {
    signal.removeEventListener("abort", abort);
    onComplete?.();
  };
  signal.addEventListener("abort", abort, { once: true });
  const body = new ReadableStream<Uint8Array>(
    {
      async cancel() {
        finished = true;
        cleanup();
        await reader.cancel();
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (finished) {
            return;
          }
          if (!authorized() || signal.aborted || next.done) {
            finished = true;
            cleanup();
            controller.close();
            await reader.cancel();
            return;
          }
          // No await or forwarding queue intervenes between authority and delivery.
          controller.enqueue(next.value);
        } catch {
          if (!finished) {
            finished = true;
            cleanup();
            controller.error(new Error("Private output is unavailable"));
          }
        }
      },
    },
    { highWaterMark: 0 }
  );
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};
