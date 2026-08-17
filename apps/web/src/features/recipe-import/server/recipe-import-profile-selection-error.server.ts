import "@tanstack/react-start/server-only";
import { Data } from "effect";

export class RecipeImportProfileSelectionError extends Data.TaggedError(
  "RecipeImportProfileSelectionError"
) {
  override readonly message = "Recipe import profile is unavailable.";
}
