import { Schema } from "effect";

import { RecipeContentFields, RecipeDraftContent } from "./content.js";
import { PlanningTags } from "./planning-tags.js";

export const RecipeEditableField = Schema.Literals([
  "name",
  "author",
  "description",
  "language",
  "ingredients",
  "instructions",
  "categories",
  "cuisines",
  "sourceTags",
  "equipment",
  "notes",
  "times",
  "servings",
  "nutrition",
  "dietary",
  "media",
]);
export type RecipeEditableField = typeof RecipeEditableField.Type;
export const RecipeReviewEditableField = Schema.Literals([
  ...RecipeEditableField.literals,
  "tags",
]);
export type RecipeReviewEditableField = typeof RecipeReviewEditableField.Type;
export const RecipeReviewAnswer = Schema.Union([
  Schema.Struct({
    field: Schema.Literal("name"),
    value: RecipeDraftContent.fields.name,
  }),
  Schema.Struct({
    field: Schema.Literal("author"),
    value: RecipeContentFields.author,
  }),
  Schema.Struct({
    field: Schema.Literal("description"),
    value: RecipeContentFields.description,
  }),
  Schema.Struct({
    field: Schema.Literal("language"),
    value: RecipeContentFields.language,
  }),
  Schema.Struct({
    field: Schema.Literal("ingredients"),
    value: RecipeDraftContent.fields.ingredients,
  }),
  Schema.Struct({
    field: Schema.Literal("instructions"),
    value: RecipeDraftContent.fields.instructions,
  }),
  Schema.Struct({
    field: Schema.Literal("categories"),
    value: RecipeContentFields.categories,
  }),
  Schema.Struct({
    field: Schema.Literal("cuisines"),
    value: RecipeContentFields.cuisines,
  }),
  Schema.Struct({
    field: Schema.Literal("sourceTags"),
    value: RecipeContentFields.sourceTags,
  }),
  Schema.Struct({
    field: Schema.Literal("equipment"),
    value: RecipeContentFields.equipment,
  }),
  Schema.Struct({
    field: Schema.Literal("notes"),
    value: RecipeContentFields.notes,
  }),
  Schema.Struct({
    field: Schema.Literal("times"),
    value: RecipeContentFields.times,
  }),
  Schema.Struct({
    field: Schema.Literal("servings"),
    value: RecipeContentFields.servings,
  }),
  Schema.Struct({
    field: Schema.Literal("nutrition"),
    value: RecipeContentFields.nutrition,
  }),
  Schema.Struct({
    field: Schema.Literal("dietary"),
    value: RecipeContentFields.dietary,
  }),
  Schema.Struct({
    field: Schema.Literal("media"),
    value: RecipeContentFields.media,
  }),
  Schema.Struct({ field: Schema.Literal("tags"), value: PlanningTags }),
]);
export type RecipeReviewAnswer = typeof RecipeReviewAnswer.Type;
