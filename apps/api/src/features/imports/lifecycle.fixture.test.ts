import { ProductionMediaLimits } from "@meal-planner/recipe-imports/media/model";
import {
  MediaProbeOutput,
  validateMediaProbe,
} from "@meal-planner/recipe-imports/media/validation";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";

import {
  LifecycleFixtureByteCount,
  LifecycleFixtureDurationSeconds,
  lifecycleFixtureProbe,
} from "../../test/import-media-lifecycle/lifecycle.fixture.js";

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
