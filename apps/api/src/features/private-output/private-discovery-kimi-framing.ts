import { PRIVATE_DISCOVERY_KIMI_STREAM_LIMITS as limits } from "./private-discovery-kimi-stream-contract.js";
import type {
  KimiStreamMetrics,
  RejectKimiStream,
} from "./private-discovery-kimi-stream-contract.js";

/** One bounded SSE frame; no previous wire, events or reasoning are retained. */
export class KimiDiscoveryFraming {
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #encoder = new TextEncoder();
  #line = "";
  #data = "";
  #hasData = false;
  #eventName = "";
  #pendingCr = false;
  #metrics: KimiStreamMetrics;
  #reject: RejectKimiStream;
  #emit: (event: string) => void;
  constructor(
    metrics: KimiStreamMetrics,
    reject: RejectKimiStream,
    emit: (event: string) => void
  ) {
    this.#metrics = metrics;
    this.#reject = reject;
    this.#emit = emit;
  }

  clear(): void {
    this.#line = "";
    this.#data = "";
    this.#hasData = false;
    this.#eventName = "";
    this.#pendingCr = false;
    this.#metrics.pendingLineBytes = 0;
    this.#metrics.pendingEventBytes = 0;
  }

  #countEvent(bytes: number): void {
    const size = this.#metrics.pendingEventBytes + bytes;
    if (size > limits.eventBytes) {
      this.#reject(
        "event_limit",
        "response_body_limit",
        size,
        limits.eventBytes
      );
    }
    this.#metrics.pendingEventBytes = size;
    this.#metrics.peakEventBytes = Math.max(this.#metrics.peakEventBytes, size);
  }

  #append(text: string): void {
    const bytes = this.#encoder.encode(text).byteLength;
    const size = this.#metrics.pendingLineBytes + bytes;
    if (size > limits.lineBytes) {
      this.#reject("line_limit", "response_body_limit", size, limits.lineBytes);
    }
    this.#countEvent(bytes);
    this.#metrics.pendingLineBytes = size;
    this.#metrics.peakLineBytes = Math.max(this.#metrics.peakLineBytes, size);
    this.#line += text;
  }

  #endLine(endingBytes: number): void {
    this.#countEvent(endingBytes);
    const line = this.#line;
    this.#line = "";
    this.#metrics.pendingLineBytes = 0;
    if (line === "") {
      if (this.#hasData) {
        this.#metrics.dataEvents += 1;
        if (this.#metrics.dataEvents > limits.dataEvents) {
          this.#reject(
            "event_count_limit",
            "response_body_limit",
            this.#metrics.dataEvents,
            limits.dataEvents
          );
        }
        if (this.#eventName !== "" && this.#eventName !== "message") {
          this.#reject("event_name");
        }
        this.#emit(this.#data);
      }
      this.#data = "";
      this.#hasData = false;
      this.#eventName = "";
      this.#metrics.pendingEventBytes = 0;
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "data") {
      this.#data = this.#hasData ? `${this.#data}\n${value}` : value;
      this.#hasData = true;
    } else if (field === "event") {
      this.#eventName = value;
    }
  }

  #consume(decoded: string): void {
    const text = this.#pendingCr ? `\r${decoded}` : decoded;
    this.#pendingCr = false;
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character !== "\r" && character !== "\n") {
        continue;
      }
      this.#append(text.slice(start, index));
      if (character === "\r" && index === text.length - 1) {
        this.#pendingCr = true;
        return;
      }
      const endingBytes =
        character === "\r" && text[index + 1] === "\n" ? 2 : 1;
      this.#endLine(endingBytes);
      index += endingBytes - 1;
      start = index + 1;
    }
    this.#append(text.slice(start));
  }

  #decode(bytes?: Uint8Array): string {
    try {
      return this.#decoder.decode(bytes, { stream: bytes !== undefined });
    } catch {
      return this.#reject("invalid_utf8", "response_body_read");
    }
  }

  push(bytes: Uint8Array): void {
    this.#metrics.wireBytes += bytes.byteLength;
    if (this.#metrics.wireBytes > limits.wireBytes) {
      this.#reject(
        "wire_limit",
        "response_body_limit",
        this.#metrics.wireBytes,
        limits.wireBytes
      );
    }
    // The incoming transport chunk belongs to the reader; only decoded working slices are bounded here.
    for (
      let offset = 0;
      offset < bytes.byteLength;
      offset += limits.decodeSliceBytes
    ) {
      this.#consume(
        this.#decode(bytes.subarray(offset, offset + limits.decodeSliceBytes))
      );
    }
  }

  finish(): void {
    this.#consume(this.#decode());
    if (this.#pendingCr) {
      this.#pendingCr = false;
      this.#endLine(1);
    }
    if (this.#hasData || (this.#line !== "" && !this.#line.startsWith(":"))) {
      this.#reject("incomplete_frame", "incomplete_completion");
    }
    this.clear();
  }
}
