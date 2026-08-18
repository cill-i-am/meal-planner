export const recipeImportQueryKeys = {
  action: (
    householdId: string,
    intentId: string | undefined,
    actionId: string | undefined
  ) => [householdId, "recipe-import-action", intentId, actionId] as const,
  actions: (householdId: string, intentId: string | undefined) =>
    [householdId, "recipe-import-action", intentId] as const,
  intent: (householdId: string, intentId: string | undefined) =>
    [householdId, "recipe-import-intent", intentId] as const,
  recipe: (householdId: string, recipeId: string | undefined) =>
    [householdId, "recipe", recipeId] as const,
};
