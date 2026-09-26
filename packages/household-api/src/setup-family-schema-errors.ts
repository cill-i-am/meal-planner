import { HttpApiMiddleware } from "effect/unstable/httpapi";

import { SetupFamilyInvalidRequest } from "./onboarding.js";

export class SetupFamilySchemaErrors extends HttpApiMiddleware.Service<SetupFamilySchemaErrors>()(
  "SetupFamilySchemaErrors",
  { error: SetupFamilyInvalidRequest }
) {}
