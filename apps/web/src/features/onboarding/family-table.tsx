import type { ReviewedRoster } from "@meal-planner/agent-conversations-api";
import { CheckIcon } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import type { Ref } from "react";

import { Avatar, AvatarFallback } from "../../components/ui/avatar.js";
import { cn } from "../../lib/utils.js";

interface Place {
  readonly id: string;
  readonly name: string;
  readonly label: string;
}

const tones = ["blue", "peach", "lilac", "rose"] as const;

const FamilyPlace = ({
  place,
  index,
  ref,
}: {
  readonly place: Place;
  readonly index: number;
  readonly ref?: Ref<HTMLLIElement>;
}) => {
  const reducedMotion = useReducedMotion();
  return (
    <m.li
      ref={ref}
      layout={reducedMotion ? false : "position"}
      initial={
        reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.82, y: 12 }
      }
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{
        opacity: 0,
        transition: { duration: 0.15 },
        y: reducedMotion ? 0 : -6,
      }}
      transition={{ bounce: 0, duration: 0.35, type: "spring" }}
      className="relative flex min-w-0 flex-col items-center gap-2 text-center"
      data-family-place={place.id}
    >
      <Avatar size="xl" aria-hidden="true">
        <AvatarFallback tone={tones[index % tones.length] ?? "blue"}>
          {[...place.name][0]}
        </AvatarFallback>
      </Avatar>
      <div className="flex max-w-32 flex-col gap-0.5">
        <AnimatePresence initial={false} mode="wait">
          <m.span
            key={place.name}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="text-sm font-medium wrap-anywhere sm:text-base"
          >
            {place.name}
          </m.span>
        </AnimatePresence>
        <span className="text-muted-foreground text-xs">{place.label}</span>
      </div>
    </m.li>
  );
};

/** The same table stays present from the account's first place to the confirmed roster. */
export const FamilyTable = ({
  creatorName,
  roster,
  stage = "draft",
}: {
  readonly creatorName: string;
  readonly roster: ReviewedRoster | null;
  readonly stage?: "draft" | "saving" | "saved" | "unknown";
}) => {
  const reducedMotion = useReducedMotion();
  const places: readonly Place[] = [
    { id: "creator", label: "You", name: roster?.creatorName ?? creatorName },
    ...(roster?.people.map((person) => ({
      id: person.draftId,
      label: person.kind === "adult" ? "Adult" : "Child",
      name: person.displayName,
    })) ?? []),
  ];
  const tablePlaces = places.slice(0, 6);
  const additionalPlaces = places.slice(6);
  const slotCount = tablePlaces.length <= 4 ? 4 : 6;
  const emptyPlaces = Array.from(
    { length: slotCount - tablePlaces.length },
    (_, index) => `empty-${index}`
  );
  let status = `${places.length} ${places.length === 1 ? "person" : "people"} · Draft`;
  if (stage === "saving") {
    status = "Saving your family…";
  }
  if (stage === "saved") {
    status = "Everyone’s here";
  }
  if (stage === "unknown") {
    status = "Save needs checking";
  }
  return (
    <section
      aria-label="Your family table"
      className="flex min-w-0 flex-col gap-6"
    >
      <p className="sr-only" role="status">
        {places.map((place) => `${place.name}, ${place.label}`).join("; ")}.{" "}
        {status}
      </p>
      <div className="relative mx-auto h-80 w-full max-w-2xl sm:h-100 lg:h-112">
        <m.div
          layout={reducedMotion ? false : "position"}
          className="shadow-surface rounded-table border-background from-person-lilac/55 to-person-blue/70 after:rounded-table after:border-background/80 absolute inset-x-0 top-[23%] flex h-[55%] items-center justify-center border bg-linear-145 p-6 after:pointer-events-none after:absolute after:inset-3 after:border"
          transition={{ bounce: 0, duration: 0.4, type: "spring" }}
        >
          <div className="relative flex max-w-[65%] flex-col items-center gap-2 text-center">
            <h2 className="font-display text-2xl leading-tight wrap-anywhere sm:text-3xl lg:text-4xl">
              {roster?.familyName ?? "Your family"}
            </h2>
            <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs">
              {stage === "saved" && (
                <CheckIcon className="size-3.5" aria-hidden="true" />
              )}
              {status}
            </p>
          </div>
        </m.div>
        <ul
          aria-label="Family members"
          className={cn(
            "relative grid h-full content-between gap-x-3",
            slotCount === 4 ? "grid-cols-2" : "grid-cols-3"
          )}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {tablePlaces.map((place, index) => (
              <FamilyPlace key={place.id} place={place} index={index} />
            ))}
            {emptyPlaces.map((id) => (
              <m.li
                key={id}
                aria-hidden="true"
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col items-center gap-2"
              >
                <div className="border-input/35 size-20 rounded-full border border-dashed" />
                <span className="h-9" />
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
      {additionalPlaces.length > 0 && (
        <ul
          aria-label="More family members"
          className="flex flex-wrap justify-center gap-x-6 gap-y-4"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {additionalPlaces.map((place, index) => (
              <FamilyPlace key={place.id} place={place} index={index + 6} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
};
