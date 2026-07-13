import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { AppLive } from "./app/layers.js";

NodeRuntime.runMain(Layer.launch(AppLive));
