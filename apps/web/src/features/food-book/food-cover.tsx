import type { MealOption } from "@meal-planner/household-api";

import { cn } from "../../lib/utils.js";

const coverPaths = {
  fish: "/images/journey/fish.avif",
  "pesto-pasta": "/images/journey/pesto-pasta.avif",
  pizza: "/images/journey/pizza.avif",
  "rice-bowls": "/images/journey/rice-bowls.avif",
  tacos: "/images/journey/tacos.avif",
} as const;

export const FoodCover = ({
  cover,
  label,
  className,
}: {
  readonly cover: MealOption["cover"];
  readonly label: string;
  readonly className?: string;
}) =>
  cover === null ? (
    <div
      aria-hidden="true"
      className={cn(
        "bg-accent font-display text-foreground grid size-20 shrink-0 place-items-center rounded-full text-3xl",
        className
      )}
    >
      {label.slice(0, 1).toUpperCase()}
    </div>
  ) : (
    <img
      alt=""
      aria-hidden="true"
      src={coverPaths[cover]}
      className={cn(
        "size-20 shrink-0 rounded-full object-cover ring-1 ring-black",
        className
      )}
    />
  );
