import type { MealOption } from "@meal-planner/household-api";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";

import { Button } from "../../components/ui/button.js";
import { useInteractionSound } from "../../hooks/use-interaction-sound.js";
import { FoodCover } from "./food-cover.js";

export const FocusedCookView = ({
  cover,
  ingredients,
  method,
  name,
  onClose,
}: {
  readonly cover: MealOption["cover"];
  readonly ingredients: readonly string[];
  readonly method: readonly string[];
  readonly name: string;
  readonly onClose: () => void;
}) => {
  const [step, setStep] = useState(0);
  const reducedMotion = useReducedMotion();
  const playInteractionSound = useInteractionSound();
  const changeStep = async (next: number) => {
    if (next >= method.length) {
      onClose();
    } else {
      setStep(Math.max(0, next));
    }
    await playInteractionSound();
  };
  const instruction = method[step];
  if (!instruction) {
    return null;
  }
  return (
    <section
      aria-label={`Cook ${name}`}
      className="flex min-h-[70dvh] flex-col gap-6 pb-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          Cook together · {name}
        </p>
        <Button variant="ghost" onClick={onClose}>
          Full recipe
        </Button>
      </div>
      <div className="bg-accent grid flex-1 overflow-hidden rounded-3xl lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        <div className="bg-primary/5 flex min-h-52 items-center justify-center p-8 lg:min-h-[35rem]">
          <FoodCover
            cover={cover}
            label={name}
            className="size-44 rounded-3xl md:size-64 lg:size-80"
          />
        </div>
        <div className="flex flex-col justify-between gap-10 p-7 md:p-10">
          <div>
            <p className="text-sm font-medium tabular-nums">
              Step {step + 1} of {method.length}
            </p>
            <div
              aria-live="polite"
              aria-atomic="true"
              className="mt-8 min-h-48"
            >
              <AnimatePresence initial={false} mode="wait">
                <m.p
                  key={step}
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
                  transition={{ duration: reducedMotion ? 0 : 0.14 }}
                  className="font-display max-w-2xl text-4xl leading-tight md:text-5xl"
                >
                  {instruction}
                </m.p>
              </AnimatePresence>
            </div>
          </div>
          <div>
            <p className="text-muted-foreground text-sm">
              {ingredients.length
                ? `${ingredients.length} source ingredient lines in the full recipe`
                : "No confirmed ingredient lines in the source recipe"}
            </p>
            <div className="mt-5 flex flex-wrap justify-between gap-3">
              <Button
                variant="outline"
                disabled={step === 0}
                onClick={async () => {
                  await changeStep(step - 1);
                }}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Previous
              </Button>
              <Button
                onClick={async () => {
                  await changeStep(step + 1);
                }}
              >
                {step === method.length - 1
                  ? "Finish walkthrough"
                  : "Next step"}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
