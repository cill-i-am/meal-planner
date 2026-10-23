import { Effect, Schema } from "effect";
import { expect, it } from "vitest";

import {
  MediaProbeOutput,
  validateMediaProbe,
} from "../../features/imports/import-media-validation.js";
import { ProductionMediaLimits } from "../../features/imports/import-media.model.js";
import {
  LifecycleFixtureByteCount,
  LifecycleFixtureDurationSeconds,
  lifecycleFixtureProbe,
} from "./fixture.js";

it("the lifecycle fixture source probe passes the real preparation validation contract", async () => {
  const probe = Schema.decodeUnknownSync(MediaProbeOutput)(
    lifecycleFixtureProbe(["-show_format", "-show_streams", "source.mp4"])
  );
  const source = await Effect.runPromise(
    validateMediaProbe(probe, {
      actualBytes: LifecycleFixtureByteCount,
      maximumBytes: ProductionMediaLimits.maximumMediaBytes,
      maximumDurationSeconds: ProductionMediaLimits.maximumDurationSeconds,
    })
  );
  expect(source).toEqual({
    audioStreams: [{ codec: "aac", index: 1 }],
    bytes: LifecycleFixtureByteCount,
    durationSeconds: LifecycleFixtureDurationSeconds,
    videoStreams: [{ codec: "h264", index: 0 }],
  });
});
