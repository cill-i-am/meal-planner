import { formatRecipeIngredient } from "@meal-planner/recipe-domain";
import type { RecipeDraftContent } from "@meal-planner/recipe-domain";

const timeLabels: Readonly<Record<string, string>> = {
  cook: "Cooking",
  inactive: "Waiting or resting",
  prep: "Preparation",
  total: "Total",
};

const durationText = (seconds: number) => {
  if (seconds % 60 === 0) {
    return `${seconds / 60} minutes`;
  }
  return `${seconds} seconds`;
};
const servingsText = (
  servings: NonNullable<RecipeDraftContent["servings"]>
) => {
  const amount =
    servings.max === null
      ? String(servings.quantity)
      : `${servings.quantity}–${servings.max}`;
  return `${amount} ${servings.unit ?? "(unit not provided)"}`;
};
const dietaryClaimText = (claim: RecipeDraftContent["dietary"][number]) => {
  if (claim.kind === "allergen") {
    return `Allergen: ${claim.name} — stated ${claim.value ? "present" : "absent"}`;
  }
  return `Diet: ${claim.name} — stated ${claim.value ? "yes" : "no"}`;
};
export const RecipeDetails = ({
  recipe,
}: {
  readonly recipe: RecipeDraftContent;
}) => (
  <div className="flex flex-col gap-5">
    {recipe.description ? <p>{recipe.description}</p> : null}
    {recipe.author ? <p>By {recipe.author.name}</p> : null}
    {recipe.servings === null ? (
      <p>Servings not provided</p>
    ) : (
      <div>
        <p>Yield: {servingsText(recipe.servings)}</p>
        {servingsText(recipe.servings) === recipe.servings.original ? null : (
          <p className="text-muted-foreground text-sm">
            Source: {recipe.servings.original}
          </p>
        )}
      </div>
    )}
    <dl className="flex flex-wrap gap-4">
      {Object.entries(recipe.times).map(([key, duration]) => (
        <div key={key}>
          <dt>{timeLabels[key]}</dt>
          <dd>
            {duration === null
              ? "Not provided"
              : durationText(duration.seconds)}
          </dd>
        </div>
      ))}
    </dl>
    <section aria-label="Ingredients">
      <h3>Ingredients</h3>
      {recipe.ingredients === null ? (
        <p>Ingredients not provided</p>
      ) : (
        recipe.ingredients.map((item, index, items) => (
          <div key={index}>
            {item.group !== null &&
            (index === 0 || items[index - 1]?.group !== item.group) ? (
              <h4>{item.group}</h4>
            ) : null}
            <p>
              {formatRecipeIngredient(item)}
              {item.optional === true ? " (optional)" : ""}
            </p>
            {formatRecipeIngredient(item) === item.original ? null : (
              <p className="text-muted-foreground text-sm">
                Source: {item.original}
              </p>
            )}
            {item.quantity === null ? (
              <p className="text-muted-foreground text-sm">
                Quantity not provided
              </p>
            ) : null}
            {item.note ? (
              <p className="text-muted-foreground text-sm">{item.note}</p>
            ) : null}
          </div>
        ))
      )}
    </section>
    <section aria-label="Method">
      <h3>Method</h3>
      {recipe.instructions === null ? (
        <p>Method not provided</p>
      ) : (
        recipe.instructions.map((item, index, items) => (
          <div key={item.step}>
            {item.group !== null &&
            (index === 0 || items[index - 1]?.group !== item.group) ? (
              <h4>{item.group}</h4>
            ) : null}
            <p>
              {item.step}. {item.text}
            </p>
            {item.duration !== null ||
            item.temperature !== null ||
            item.equipment.length > 0 ? (
              <p className="text-muted-foreground text-sm">
                {[
                  item.duration === null
                    ? null
                    : durationText(item.duration.seconds),
                  item.temperature === null
                    ? null
                    : `${item.temperature.value}°${item.temperature.unit}`,
                  ...item.equipment,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ))
      )}
    </section>
    {recipe.equipment.length > 0 ? (
      <section>
        <h3>Equipment</h3>
        <p>{recipe.equipment.join(", ")}</p>
      </section>
    ) : null}
    {recipe.notes.length > 0 ? (
      <section>
        <h3>Notes</h3>
        {recipe.notes.map((note, index) => (
          <p key={index}>{note}</p>
        ))}
      </section>
    ) : null}
    {recipe.nutrition ? (
      <section>
        <h3>Nutrition</h3>
        <p>{recipe.nutrition.original}</p>
        <p>
          Per{" "}
          {recipe.nutrition.basis.type === "100g"
            ? "100 g"
            : recipe.nutrition.basis.type}
        </p>
        {recipe.nutrition.nutrients.map((nutrient) => (
          <p key={nutrient.name}>
            {nutrient.name}: {nutrient.amount.value} {nutrient.amount.unit}
          </p>
        ))}
      </section>
    ) : null}
    {recipe.dietary.length > 0 ? (
      <section>
        <h3>Source dietary claims</h3>
        {recipe.dietary.map((claim) => (
          <div key={`${claim.kind}:${claim.name}`}>
            <p>{dietaryClaimText(claim)}</p>
            <p className="text-muted-foreground text-sm">
              Source: {claim.original}
            </p>
          </div>
        ))}
      </section>
    ) : null}
    {recipe.media.length > 0 ? (
      <section>
        <h3>Recipe media</h3>
        {recipe.media.map((item) => (
          <p key={item.url}>
            <a href={item.url} rel="noreferrer" target="_blank">
              {item.caption ?? item.alt ?? `Source ${item.type}`}
            </a>
          </p>
        ))}
      </section>
    ) : null}
  </div>
);
