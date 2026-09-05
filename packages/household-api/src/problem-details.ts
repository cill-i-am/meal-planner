import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

export const ProblemDetails = <
  const Status extends number,
  const Code extends string,
>(
  status: Status,
  code: Code
) =>
  Schema.Struct({
    code: Schema.Literal(code),
    message: Schema.String,
    status: Schema.Literal(status),
  }).pipe(
    HttpApiSchema.status(status),
    HttpApiSchema.asJson({ contentType: "application/problem+json" })
  );
