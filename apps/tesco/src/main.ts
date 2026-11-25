import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { AppLive } from "./server/layers.js";

NodeRuntime.runMain(Layer.launch(AppLive));
