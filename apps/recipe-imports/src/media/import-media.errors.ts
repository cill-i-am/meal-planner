import { Schema } from "effect";

import type {
  RetryableAcquisitionFailure,
  TerminalMediaFailure,
  UnavailableFailure,
  UnsupportedCarouselFailure,
} from "./import-media.model.js";
import {
  AcquisitionFailureReason,
  AcquisitionStage,
} from "./import-media.model.js";

export type RetryableAcquisitionError = RetryableAcquisitionFailure;
export const RetryableAcquisitionError =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RetryableAcquisitionError>()(
    "RetryableAcquisitionFailure",
    {
      reason: Schema.optionalKey(AcquisitionFailureReason),
      stage: AcquisitionStage,
    }
  );

export type UnavailableError = UnavailableFailure;
export const UnavailableError =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<UnavailableError>()("Unavailable", {
    code: Schema.Literal("private_or_unavailable"),
  });

export type UnsupportedCarouselError = UnsupportedCarouselFailure;
export const UnsupportedCarouselError =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<UnsupportedCarouselError>()("UnsupportedCarousel", {
    code: Schema.Literal("unsupported_carousel"),
  });

export type TerminalMediaError = TerminalMediaFailure;
export const TerminalMediaError =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<TerminalMediaError>()("TerminalMedia", {
    code: Schema.Literals([
      "invalid_media",
      "limit_exceeded",
      "unsupported_streams",
    ]),
    stage: AcquisitionStage,
  });
