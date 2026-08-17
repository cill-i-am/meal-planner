import "@tanstack/react-start/server-only";
import { Data } from "effect";

export class RecipeImportRuntimeConfigurationError extends Data.TaggedError(
  "RecipeImportRuntimeConfigurationError"
) {
  override readonly message = "Recipe import runtime configuration is invalid.";
}
