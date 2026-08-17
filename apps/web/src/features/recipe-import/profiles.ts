import { Schema } from "effect";

export const RecipeImportProfileAlias = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isLengthBetween(1, 32),
    Schema.isPattern(/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u)
  ),
  Schema.brand("RecipeImportProfileAlias")
);
export type RecipeImportProfileAlias = typeof RecipeImportProfileAlias.Type;

const RecipeImportProfileLabel = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isLengthBetween(1, 48))
);

export const RecipeImportPublicProfile = Schema.Struct({
  alias: RecipeImportProfileAlias,
  label: RecipeImportProfileLabel,
});
export type RecipeImportPublicProfile = typeof RecipeImportPublicProfile.Type;

export const RecipeImportPublicProfileConfiguration = Schema.Struct({
  defaultAlias: RecipeImportProfileAlias,
  profiles: Schema.Array(RecipeImportPublicProfile).pipe(
    Schema.check(Schema.isMinLength(1))
  ),
});
export type RecipeImportPublicProfileConfiguration =
  typeof RecipeImportPublicProfileConfiguration.Type;

const decodeProfileAlias = (candidate: unknown) => {
  try {
    return Schema.decodeUnknownSync(RecipeImportProfileAlias)(candidate);
  } catch {
    return null;
  }
};

export const resolveRecipeImportProfileAlias = (
  configuration: RecipeImportPublicProfileConfiguration,
  candidate: unknown
): RecipeImportProfileAlias => {
  const alias = decodeProfileAlias(candidate);
  return alias !== null &&
    configuration.profiles.some((profile) => profile.alias === alias)
    ? alias
    : configuration.defaultAlias;
};
