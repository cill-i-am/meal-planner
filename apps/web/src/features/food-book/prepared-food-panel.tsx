import {
  ConfirmPreparedCarryOver,
  PlanningContentId,
  PlanningDate,
  PreparedPortionWrite,
  QuantityUnit,
} from "@meal-planner/household-api";
import type {
  PlanningContentCommand,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { useForm, useStore } from "@tanstack/react-form";
import { Schema } from "effect";
import { useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";

const RecordFields = Schema.Struct({
  amount: Schema.String,
  label: Schema.String,
  reason: Schema.String,
  sourceOptionId: Schema.String,
  storage: PreparedPortionWrite.fields.storage,
  unit: QuantityUnit,
});
const CarryOverFields = Schema.Struct({
  amount: Schema.String,
  confirmed: Schema.Boolean,
  reason: Schema.String,
  selectedId: Schema.String,
  weekStart: Schema.String,
});
const SourceFields = Schema.Struct({
  reason: Schema.String,
  selectedId: Schema.String,
  sourceOptionId: Schema.String,
});

export const PreparedFoodPanel = ({
  snapshot,
  pending,
  onCommand,
}: {
  readonly snapshot: PlanningContentSnapshot;
  readonly pending: boolean;
  readonly onCommand: (command: PlanningContentCommand) => void;
}) => {
  const [recordError, setRecordError] = useState<string | null>(null);
  const [carryOverError, setCarryOverError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const record = useForm({
    defaultValues: Schema.decodeUnknownSync(RecordFields)({
      amount: "",
      label: "",
      reason: "",
      sourceOptionId: "",
      storage: "fridge",
      unit: "portion",
    }),
    onSubmit: ({ value }) => {
      if (pending) {
        return;
      }
      try {
        const fields = Schema.decodeUnknownSync(RecordFields)(value);
        const amount = Number(fields.amount);
        const sourceOption = snapshot.options.find(
          (option) => option.optionId === fields.sourceOptionId
        );
        if (fields.sourceOptionId !== "" && !sourceOption) {
          throw new Error("Unknown source option");
        }
        if (fields.amount.trim() === "" || !Number.isFinite(amount)) {
          throw new Error("Invalid amount");
        }
        const prepared = Schema.decodeUnknownSync(PreparedPortionWrite)({
          confirmedForWeekStart: null,
          id: Schema.decodeUnknownSync(PlanningContentId)(crypto.randomUUID()),
          label: fields.label.trim(),
          quantity: {
            _tag: "Known",
            amount,
            sourceText: null,
            unit: fields.unit,
          },
          reason: fields.reason.trim(),
          remainingAmount: amount,
          sourceCookEventId: null,
          sourceOptionRef: sourceOption
            ? {
                kind: sourceOption.kind,
                optionId: sourceOption.optionId,
                optionVersion: sourceOption.optionVersion,
              }
            : null,
          state: "available",
          storage: fields.storage,
          version: 1,
        });
        setRecordError(null);
        onCommand({ _tag: "PutPreparedPortion", value: prepared });
      } catch {
        setRecordError(
          "Give the prepared food a name, a positive amount, a correction reason and a valid saved food when linked."
        );
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(RecordFields) },
  });
  const carryOver = useForm({
    defaultValues: Schema.decodeUnknownSync(CarryOverFields)({
      amount: "",
      confirmed: false,
      reason: "",
      selectedId: "",
      weekStart: "",
    }),
    onSubmit: ({ value }) => {
      if (pending) {
        return;
      }
      const selected = snapshot.preparedPortions.find(
        (portion) =>
          portion.id === value.selectedId &&
          (portion.state === "available" || portion.state === "reserved")
      );
      if (!selected || !value.confirmed) {
        setCarryOverError("Choose prepared food and confirm it still exists.");
        return;
      }
      try {
        const fields = Schema.decodeUnknownSync(CarryOverFields)(value);
        const remainingAmount = Number(fields.amount);
        if (fields.amount.trim() === "" || !Number.isFinite(remainingAmount)) {
          throw new Error("Invalid amount");
        }
        const confirmation = Schema.decodeUnknownSync(ConfirmPreparedCarryOver)(
          {
            confirmation: "I confirm this prepared food still exists",
            confirmedForWeekStart: Schema.decodeUnknownSync(PlanningDate)(
              fields.weekStart
            ),
            expectedPortionVersion: selected.version,
            id: selected.id,
            reason: fields.reason.trim(),
            remainingAmount,
          }
        );
        setCarryOverError(null);
        onCommand({ _tag: "ConfirmPreparedCarryOver", value: confirmation });
      } catch {
        setCarryOverError(
          "Choose a real week start, a nonnegative remaining amount and a correction note."
        );
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(CarryOverFields) },
  });
  const source = useForm({
    defaultValues: Schema.decodeUnknownSync(SourceFields)({
      reason: "",
      selectedId: "",
      sourceOptionId: "",
    }),
    onSubmit: ({ value }) => {
      if (pending) {
        return;
      }
      const fields = Schema.decodeUnknownSync(SourceFields)(value);
      const portion = snapshot.preparedPortions.find(
        (item) =>
          item.id === fields.selectedId &&
          item.sourceCookEventId === null &&
          item.state === "available"
      );
      const option = snapshot.options.find(
        (item) => item.optionId === fields.sourceOptionId
      );
      if (!portion || !option) {
        setSourceError("Choose prepared food and the saved food it came from.");
        return;
      }
      try {
        const correction = Schema.decodeUnknownSync(PreparedPortionWrite)({
          confirmedForWeekStart: portion.confirmedForWeekStart,
          id: portion.id,
          label: portion.label,
          quantity: portion.quantity,
          reason: fields.reason.trim(),
          remainingAmount: portion.remainingAmount,
          sourceCookEventId: portion.sourceCookEventId,
          sourceOptionRef: {
            kind: option.kind,
            optionId: option.optionId,
            optionVersion: option.optionVersion,
          },
          state: portion.state === "reserved" ? "available" : portion.state,
          storage: portion.storage,
          version: portion.version + 1,
        });
        setSourceError(null);
        onCommand({ _tag: "PutPreparedPortion", value: correction });
      } catch {
        setSourceError(
          "Explain the correction before linking this prepared food."
        );
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(SourceFields) },
  });
  const selectedId = useStore(
    carryOver.store,
    (state) => state.values.selectedId
  );
  const selected = snapshot.preparedPortions.find(
    (portion) => portion.id === selectedId
  );

  return (
    <section className="border-border border-t pt-9">
      <div>
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          Prepared food
        </p>
        <h2 className="font-display mt-2 text-4xl">What’s already made.</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
          Record confirmed portions you have. Confirm older portions again
          before a later week relies on them.
        </p>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="border-border rounded-3xl border p-6">
          <h3 className="font-display text-3xl">Available portions.</h3>
          {snapshot.preparedPortions.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-sm">
              No prepared food is recorded.
            </p>
          ) : (
            <ul className="divide-border mt-4 divide-y">
              {snapshot.preparedPortions.map((portion) => (
                <li
                  key={portion.id}
                  className="flex flex-wrap justify-between gap-2 py-3"
                >
                  <div>
                    <p className="font-medium">{portion.label}</p>
                    <p className="text-muted-foreground text-xs">
                      {portion.remainingAmount} {portion.quantity.unit} ·{" "}
                      {portion.storage}
                      {portion.confirmedForWeekStart
                        ? ` · confirmed for ${portion.confirmedForWeekStart}`
                        : " · next week needs confirmation"}{" "}
                      ·{" "}
                      {portion.sourceOptionRef
                        ? `linked to ${snapshot.options.find((option) => option.optionId === portion.sourceOptionRef?.optionId)?.label ?? "an earlier food version"}`
                        : "source not linked"}
                    </p>
                  </div>
                  <Badge variant="secondary">{portion.state}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void record.handleSubmit();
          }}
          className="border-border flex flex-col gap-5 rounded-3xl border p-6"
        >
          <h3 className="font-display text-3xl">Record a leftover.</h3>
          <FieldGroup>
            <record.Field name="label">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="stock-label">What is it?</FieldLabel>
                  <Input
                    id="stock-label"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    required
                    maxLength={160}
                  />
                </Field>
              )}
            </record.Field>
            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <record.Field name="amount">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="stock-amount">Amount now</FieldLabel>
                    <Input
                      id="stock-amount"
                      type="number"
                      min="0"
                      step="any"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      required
                    />
                  </Field>
                )}
              </record.Field>
              <record.Field name="unit">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="stock-unit">Unit</FieldLabel>
                    <select
                      id="stock-unit"
                      className="border-input bg-control h-11 rounded-xl border px-3"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(
                          Schema.decodeUnknownSync(QuantityUnit)(
                            event.target.value
                          )
                        )
                      }
                    >
                      {QuantityUnit.literals.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </record.Field>
            </div>
            <record.Field name="storage">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="stock-storage">Stored in</FieldLabel>
                  <select
                    id="stock-storage"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) =>
                      field.handleChange(
                        Schema.decodeUnknownSync(
                          PreparedPortionWrite.fields.storage
                        )(event.target.value)
                      )
                    }
                  >
                    <option value="fridge">Fridge</option>
                    <option value="freezer">Freezer</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              )}
            </record.Field>
            <record.Field name="sourceOptionId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="stock-source">
                    Saved food made
                  </FieldLabel>
                  <select
                    id="stock-source"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    <option value="">Not linked yet</option>
                    {snapshot.options.map((option) => (
                      <option key={option.optionId} value={option.optionId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <FieldDescription>
                    Choose the exact saved food to use these portions in a plan.
                    People with confirmed food constraints also need a current
                    compatible suitability review for that food.
                  </FieldDescription>
                </Field>
              )}
            </record.Field>
            <record.Field name="reason">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="stock-reason">
                    What was recorded?
                  </FieldLabel>
                  <Input
                    id="stock-reason"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    required
                    maxLength={160}
                    placeholder="For example, cooked extra today"
                  />
                </Field>
              )}
            </record.Field>
          </FieldGroup>
          {recordError && (
            <Alert variant="destructive">
              <AlertTitle>Check prepared food</AlertTitle>
              <AlertDescription>{recordError}</AlertDescription>
            </Alert>
          )}
          <record.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <Button type="submit" disabled={pending || submitting}>
                Record prepared food
              </Button>
            )}
          </record.Subscribe>
        </form>
      </div>
      {snapshot.preparedPortions.some(
        (portion) =>
          portion.sourceCookEventId === null && portion.state === "available"
      ) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void source.handleSubmit();
          }}
          className="border-border mt-6 flex flex-col gap-5 rounded-3xl border p-6"
        >
          <div>
            <h3 className="font-display text-3xl">Link prepared food.</h3>
            <p className="text-muted-foreground mt-2 text-sm">
              Reserved portions can be relinked after their reservations are
              resolved.
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              An exact saved food is needed before these portions can cover a
              meal. People with confirmed food constraints also need a current
              compatible suitability review.
            </p>
          </div>
          <FieldGroup>
            <source.Field name="selectedId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="source-portion">
                    Prepared food
                  </FieldLabel>
                  <select
                    id="source-portion"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      const portion = snapshot.preparedPortions.find(
                        (item) => item.id === event.target.value
                      );
                      source.setFieldValue(
                        "sourceOptionId",
                        portion?.sourceOptionRef?.optionId ?? ""
                      );
                    }}
                  >
                    <option value="">Choose portions</option>
                    {snapshot.preparedPortions
                      .filter(
                        (portion) =>
                          portion.sourceCookEventId === null &&
                          portion.state === "available"
                      )
                      .map((portion) => (
                        <option key={portion.id} value={portion.id}>
                          {portion.label}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            </source.Field>
            <source.Field name="sourceOptionId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="source-option">
                    Saved food made
                  </FieldLabel>
                  <select
                    id="source-option"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    <option value="">Choose saved food</option>
                    {snapshot.options.map((option) => (
                      <option key={option.optionId} value={option.optionId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </source.Field>
            <source.Field name="reason">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="source-reason">
                    Correction note
                  </FieldLabel>
                  <Input
                    id="source-reason"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    maxLength={160}
                    required
                  />
                </Field>
              )}
            </source.Field>
          </FieldGroup>
          {sourceError && (
            <Alert variant="destructive">
              <AlertTitle>Check the food source</AlertTitle>
              <AlertDescription>{sourceError}</AlertDescription>
            </Alert>
          )}
          <source.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <Button
                type="submit"
                disabled={
                  pending || submitting || snapshot.options.length === 0
                }
              >
                Link saved food
              </Button>
            )}
          </source.Subscribe>
        </form>
      )}
      {snapshot.preparedPortions.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void carryOver.handleSubmit();
          }}
          className="bg-accent mt-6 flex flex-col gap-5 rounded-3xl p-6 md:p-8"
        >
          <div>
            <p className="text-xs tracking-widest uppercase">
              For another week
            </p>
            <h3 className="font-display mt-2 text-3xl">
              Still there? Confirm it.
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <carryOver.Field name="selectedId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="carry-portion">Prepared food</FieldLabel>
                  <select
                    id="carry-portion"
                    className="border-input bg-background h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      carryOver.setFieldValue("confirmed", false);
                    }}
                  >
                    <option value="">Choose portions</option>
                    {snapshot.preparedPortions
                      .filter(
                        (portion) =>
                          portion.state === "available" ||
                          portion.state === "reserved"
                      )
                      .map((portion) => (
                        <option key={portion.id} value={portion.id}>
                          {portion.label}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            </carryOver.Field>
            <carryOver.Field name="weekStart">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="carry-week">
                    Planning week starts
                  </FieldLabel>
                  <Input
                    id="carry-week"
                    type="date"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      carryOver.setFieldValue("confirmed", false);
                    }}
                    onBlur={field.handleBlur}
                    required
                  />
                </Field>
              )}
            </carryOver.Field>
            <carryOver.Field name="amount">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="carry-amount">
                    Amount remaining{" "}
                    {selected ? `(${selected.quantity.unit})` : ""}
                  </FieldLabel>
                  <Input
                    id="carry-amount"
                    type="number"
                    min="0"
                    step="any"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      carryOver.setFieldValue("confirmed", false);
                    }}
                    onBlur={field.handleBlur}
                    required
                  />
                </Field>
              )}
            </carryOver.Field>
          </div>
          <carryOver.Field name="reason">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="carry-reason">Correction note</FieldLabel>
                <Input
                  id="carry-reason"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    carryOver.setFieldValue("confirmed", false);
                  }}
                  onBlur={field.handleBlur}
                  required
                  maxLength={160}
                />
              </Field>
            )}
          </carryOver.Field>
          <carryOver.Field name="confirmed">
            {(field) => (
              <label className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={field.state.value}
                  onCheckedChange={(checked) =>
                    field.handleChange(checked === true)
                  }
                />
                I confirm this prepared food still exists.
              </label>
            )}
          </carryOver.Field>
          <FieldDescription>
            We do not calculate a safe eating deadline. Your family decides
            whether it is still usable.
          </FieldDescription>
          {carryOverError && (
            <Alert variant="destructive">
              <AlertTitle>Check carry-over</AlertTitle>
              <AlertDescription>{carryOverError}</AlertDescription>
            </Alert>
          )}
          <carryOver.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <Button
                type="submit"
                disabled={pending || submitting || !selected}
              >
                Confirm for this week
              </Button>
            )}
          </carryOver.Subscribe>
        </form>
      )}
    </section>
  );
};
