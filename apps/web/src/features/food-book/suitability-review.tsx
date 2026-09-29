import {
  PlanningContentId,
  SuitabilityReviewWrite,
} from "@meal-planner/household-api";
import type {
  HouseholdPerson,
  MealOption,
  PlanningContentCommand,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useMemo, useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import { Textarea } from "../../components/ui/textarea.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.js";
import type { DisplayedIdentity } from "../auth/index.js";
import {
  describeProfileFact,
  makeBrowserHouseholdProfileOperations,
} from "../household-profiles/index.js";

const ReviewFields = Schema.Struct({
  confirmedProfileVersion: Schema.NullOr(Schema.Number),
  personId: Schema.String,
  reason: Schema.String,
  status: SuitabilityReviewWrite.fields.status,
});

export const SuitabilityReviewPanel = ({
  scope,
  option,
  snapshot,
  people,
  pending,
  onCommand,
}: {
  readonly scope: DisplayedIdentity;
  readonly option: MealOption;
  readonly snapshot: PlanningContentSnapshot;
  readonly people: readonly HouseholdPerson[];
  readonly pending: boolean;
  readonly onCommand: (command: PlanningContentCommand) => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const operations = useMemo(
    () => makeBrowserHouseholdProfileOperations(scope),
    [scope]
  );
  const form = useForm({
    defaultValues: Schema.decodeUnknownSync(ReviewFields)({
      confirmedProfileVersion: null,
      personId: people[0]?.id ?? "",
      reason: "",
      status: "unknown",
    }),
    onSubmit: ({ value }) => {
      if (pending) {
        return;
      }
      const person = people.find((item) => item.id === value.personId);
      const profileData = queryClient.getQueryData<
        Awaited<ReturnType<typeof operations.get>>
      >([
        "food-book-profile-review",
        scope.userId,
        scope.organizationId,
        value.personId,
      ]);
      if (
        !person ||
        !profileData ||
        value.confirmedProfileVersion !== profileData.version
      ) {
        setError(
          "Choose a person, load their current profile and confirm this review."
        );
        return;
      }
      try {
        const fields = Schema.decodeUnknownSync(ReviewFields)(value);
        const currentReview = snapshot.suitabilityReviews.find(
          (review) =>
            review.personId === person.id &&
            review.profileVersion === profileData.version &&
            review.optionRef.optionId === option.optionId &&
            review.optionRef.optionVersion === option.optionVersion
        );
        const review = Schema.decodeUnknownSync(SuitabilityReviewWrite)({
          confirmation: "I reviewed this food for this person",
          id:
            currentReview?.id ??
            Schema.decodeUnknownSync(PlanningContentId)(crypto.randomUUID()),
          optionRef: {
            kind: option.kind,
            optionId: option.optionId,
            optionVersion: option.optionVersion,
          },
          personId: person.id,
          profileVersion: profileData.version,
          reason: fields.reason.trim(),
          status: fields.status,
          version: (currentReview?.version ?? 0) + 1,
        });
        setError(null);
        onCommand({ _tag: "PutSuitabilityReview", value: review });
      } catch {
        setError("This review needs a valid reason and current profile.");
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(ReviewFields) },
  });
  const personId = useStore(form.store, (state) => state.values.personId);
  const person = people.find((item) => item.id === personId);
  const profile = useQuery({
    enabled: person !== undefined,
    queryFn: () => {
      if (!person) {
        throw new Error("Choose a person.");
      }
      return operations.get(person.id);
    },
    queryKey: [
      "food-book-profile-review",
      scope.userId,
      scope.organizationId,
      personId,
    ],
    retry: false,
  });
  const confirmedFacts =
    profile.data?.facts.filter((fact) => fact.standing._tag === "confirmed") ??
    [];
  const currentReview = snapshot.suitabilityReviews.find(
    (review) =>
      review.personId === person?.id &&
      review.profileVersion === profile.data?.version &&
      review.optionRef.optionId === option.optionId &&
      review.optionRef.optionVersion === option.optionVersion
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-6"
    >
      <div>
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          Person review
        </p>
        <h2 className="font-display mt-2 text-4xl">
          Does this fit their plate?
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Review {option.label} against the current confirmed profile for one
          person. A new meal version needs a new review.
        </p>
      </div>
      <FieldGroup>
        <form.Field name="personId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="suitability-person">Person</FieldLabel>
              <select
                id="suitability-person"
                className="border-input bg-control h-11 rounded-xl border px-3"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  form.setFieldValue("status", "unknown");
                  form.setFieldValue("confirmedProfileVersion", null);
                }}
              >
                <option value="">Choose a person</option>
                {people.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </form.Field>
      </FieldGroup>
      {profile.isPending && person && (
        <p role="status" className="text-sm">
          Loading confirmed food profile…
        </p>
      )}
      {profile.isError && (
        <Alert variant="destructive">
          <AlertTitle>Profile unavailable</AlertTitle>
          <AlertDescription>
            We can’t review suitability without the current profile.{" "}
            <Button
              type="button"
              variant="link"
              onClick={() => profile.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {profile.data && (
        <div className="bg-accent rounded-2xl p-5">
          <p className="text-xs tracking-widest uppercase">
            Current confirmed profile · version {profile.data.version}
          </p>
          {confirmedFacts.length === 0 ? (
            <p className="mt-3 text-sm">
              No confirmed food facts are recorded for this person. Keep the
              status unknown unless you can confirm it with them.
            </p>
          ) : (
            <ul className="mt-3 list-inside list-disc text-sm leading-6">
              {confirmedFacts.map((fact) => (
                <li key={fact.id}>{describeProfileFact(fact.value)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {currentReview && (
        <p className="text-muted-foreground text-sm">
          Last review: {currentReview.status} · {currentReview.reason}
        </p>
      )}
      <FieldGroup>
        <form.Field name="status">
          {(field) => (
            <Field>
              <FieldLabel>Review result</FieldLabel>
              <ToggleGroup
                value={[field.state.value]}
                onValueChange={(values) => {
                  const [status] = values;
                  if (
                    status === "unknown" ||
                    status === "compatible" ||
                    status === "incompatible"
                  ) {
                    field.handleChange(status);
                    form.setFieldValue("confirmedProfileVersion", null);
                  }
                }}
                aria-label="Suitability result"
                variant="segment"
              >
                <ToggleGroupItem value="unknown">Unsure</ToggleGroupItem>
                <ToggleGroupItem value="compatible">Fits</ToggleGroupItem>
                <ToggleGroupItem value="incompatible">
                  Doesn’t fit
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                Only choose “Fits” after checking the person’s current
                constraints and this exact meal version.
              </FieldDescription>
            </Field>
          )}
        </form.Field>
        <form.Field name="reason">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="suitability-reason">Why?</FieldLabel>
              <Textarea
                id="suitability-reason"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  form.setFieldValue("confirmedProfileVersion", null);
                }}
                onBlur={field.handleBlur}
                maxLength={160}
                required
              />
            </Field>
          )}
        </form.Field>
      </FieldGroup>
      <form.Field name="confirmedProfileVersion">
        {(field) => (
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={
                profile.data !== undefined &&
                field.state.value === profile.data.version
              }
              onCheckedChange={(checked) =>
                field.handleChange(
                  checked === true ? (profile.data?.version ?? null) : null
                )
              }
              disabled={!profile.data}
            />
            I reviewed this food for this person.
          </label>
        )}
      </form.Field>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Review needed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button
            type="submit"
            disabled={pending || submitting || !profile.data}
          >
            Save person review
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
};
