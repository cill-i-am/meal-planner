import type {
  AttributeValue,
  SpanLike,
  TracerLike,
} from "cloudflare-drizzle-tracing";

export class RecordingDrizzleTracer implements TracerLike {
  readonly spans: {
    name: string;
    attributes: Record<string, AttributeValue | undefined>;
    errors: string[];
    finished: boolean;
  }[] = [];

  enterSpan<T>(name: string, body: (span: SpanLike) => T): T {
    const record: (typeof this.spans)[number] = {
      attributes: {},
      errors: [],
      finished: false,
      name,
    };
    this.spans.push(record);
    const span: SpanLike = {
      isTraced: true,
      recordException: (exception) => {
        record.errors.push(exception.name);
      },
      setAttribute: (key, value) => {
        record.attributes[key] = value;
      },
      setAttributes: (attributes) => {
        Object.assign(record.attributes, attributes);
      },
      setStatus: (status) => {
        record.attributes["status"] = status.code;
      },
    };
    try {
      const result = body(span);
      if (result instanceof Promise) {
        return (async () => {
          try {
            return await result;
          } finally {
            record.finished = true;
          }
        })() as T;
      }
      record.finished = true;
      return result;
    } catch (error) {
      record.finished = true;
      throw error;
    }
  }
}
