export class RequestBodyTooLargeError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
    this.limitBytes = limitBytes;
  }
}

/**
 * Parse JSON while enforcing the limit on the bytes actually received.
 * Content-Length is optional for chunked uploads, so a header-only guard is
 * not a memory limit and allowed an arbitrarily large body to reach json().
 */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Request body is empty.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const textChunks: string[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(maxBytes);
      }
      textChunks.push(decoder.decode(value, { stream: true }));
    }
    textChunks.push(decoder.decode());
    return JSON.parse(textChunks.join(""));
  } finally {
    reader.releaseLock();
  }
}
