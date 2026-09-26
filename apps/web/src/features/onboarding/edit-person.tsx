import type { SetupCheckpoint } from "@meal-planner/household-api";
import { RenameHouseholdPersonPayload } from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";

import { useAppForm } from "../../components/forms/form.js";
import { Button } from "../../components/ui/button.js";
import {
  CardBody,
  CardContent,
  CardHeader,
  CardFooter,
} from "../../components/ui/card.js";
import { FieldGroup } from "../../components/ui/field.js";
import { householdPeopleFailureCode } from "../household-people/operations.js";
import { PersonNameInput } from "./people-input.js";
import { useSetup } from "./setup-context.js";
import { SetupError, SetupFrame } from "./setup-ui.js";

const validator = Schema.toStandardSchemaV1(
  Schema.Struct({ name: PersonNameInput })
);
const checkpointForLogout = (
  checkpoint: SetupCheckpoint,
  retained: Extract<SetupCheckpoint, { stage: "person-rename" }> | undefined,
  name: string
): SetupCheckpoint | undefined => {
  if (checkpoint.stage === "person-edit") {
    return retained ?? { ...checkpoint, name };
  }
  if (checkpoint.stage === "person-rename") {
    return retained ?? checkpoint;
  }
  return undefined;
};

const renameRequestFrom = (
  checkpoint: SetupCheckpoint,
  retained: Extract<SetupCheckpoint, { stage: "person-rename" }> | undefined,
  name: string
): Extract<SetupCheckpoint, { stage: "person-rename" }> | undefined => {
  if (
    checkpoint.stage !== "person-edit" &&
    checkpoint.stage !== "person-rename"
  ) {
    return undefined;
  }
  const command =
    retained?.command ??
    Schema.decodeUnknownSync(RenameHouseholdPersonPayload)({
      displayName: name.trim(),
      expectedVersion:
        checkpoint.stage === "person-edit"
          ? checkpoint.version
          : checkpoint.command.expectedVersion,
      mutationId: crypto.randomUUID(),
    });
  return (
    retained ?? {
      command,
      organizationId: checkpoint.organizationId,
      personId: checkpoint.personId,
      stage: "person-rename",
    }
  );
};

const renameErrorMessage = (stale: boolean) =>
  stale
    ? "Someone updated this person. Return to your family to review their latest details."
    : "We couldn’t confirm the change. Try again.";

export const EditPersonPage = () => {
  const setup = useSetup();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { checkpoint } = setup.progress;
  const mutation = useMutation({
    mutationFn: async (
      pending: Extract<SetupCheckpoint, { stage: "person-rename" }>
    ) => {
      const { command } = pending;
      await setup.save({
        checkpoint: {
          command,
          organizationId: pending.organizationId,
          personId: pending.personId,
          stage: "person-rename",
        },
        status: "active",
      });
      await setup.selectFamily(pending.organizationId);
      const people = setup.peopleForFamily(pending.organizationId);
      if (!people.rename) {
        throw new Error("Name editing is unavailable.");
      }
      await people.rename(pending.personId, command);
      await setup.save({
        checkpoint: {
          organizationId: pending.organizationId,
          stage: "family-review",
        },
        status: "active",
      });
      await queryClient.invalidateQueries({
        queryKey: ["setup-roster", pending.organizationId],
      });
      await navigate({ to: "/setup/review" });
    },
  });
  const retained =
    checkpoint.stage === "person-rename" ? checkpoint : mutation.variables;
  const exit = useMutation({
    mutationFn: async (name: string) => {
      const next = checkpointForLogout(checkpoint, retained, name);
      if (!next) {
        return;
      }
      await setup.logout({
        checkpoint: next,
        status: "paused",
      });
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (!("organizationId" in checkpoint)) {
        return;
      }
      await setup.save({
        checkpoint: {
          organizationId: checkpoint.organizationId,
          stage: "family-review",
        },
        status: "active",
      });
      await navigate({ to: "/setup/review" });
    },
  });
  const form = useAppForm({
    defaultValues: {
      name:
        checkpoint.stage === "person-edit"
          ? checkpoint.name
          : (retained?.command.displayName ?? ""),
    },
    onSubmit: async ({ value }) => {
      const request = renameRequestFrom(checkpoint, retained, value.name);
      if (!request) {
        return;
      }
      await mutation.mutateAsync(request).catch(() => {
        /* Mutation owns the error and original request. */
      });
    },
    validators: { onChange: validator, onSubmit: validator },
  });
  const busy = mutation.isPending || exit.isPending || cancel.isPending;
  const submitLabel = retained ? "Check and continue" : "Save name";
  const stale = householdPeopleFailureCode(mutation.error) === "stale_version";
  return (
    <SetupFrame
      step="people"
      action={
        <Button
          variant="link"
          disabled={busy}
          onClick={() => exit.mutate(form.state.values.name)}
        >
          {exit.isPending ? "Logging out…" : "Log out"}
        </Button>
      }
    >
      <form.AppForm>
        <form.Frame className="max-w-140" size="sm" pending={busy}>
          <CardBody>
            <CardHeader>
              <form.Heading
                errorTitle="Edit their name"
                rejected={Boolean(mutation.error)}
              >
                Edit their name
              </form.Heading>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <form.AppField name="name">
                  {(field) => (
                    <field.TextField
                      id="edit-person-name"
                      label="Name"
                      maxLength={80}
                      autoComplete="off"
                      disabled={busy || Boolean(retained)}
                    />
                  )}
                </form.AppField>
              </FieldGroup>
              {retained && !stale && (
                <p className="text-muted-foreground text-sm">
                  We’ve kept your original change. Retry to confirm it was
                  saved.
                </p>
              )}
              {mutation.error && (
                <SetupError>{renameErrorMessage(stale)}</SetupError>
              )}
              {(exit.error || cancel.error) && (
                <SetupError>
                  {exit.error
                    ? "We couldn’t save your place or log you out. Try again."
                    : "We couldn’t save your place. Try again."}
                </SetupError>
              )}
              {!stale && (
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : submitLabel}
                </Button>
              )}
            </CardContent>
          </CardBody>
          {(!retained || stale) && (
            <CardFooter>
              <Button
                variant="link"
                disabled={busy}
                onClick={() => cancel.mutate()}
              >
                {stale ? "Review your family" : "Cancel"}
              </Button>
            </CardFooter>
          )}
        </form.Frame>
      </form.AppForm>
    </SetupFrame>
  );
};
