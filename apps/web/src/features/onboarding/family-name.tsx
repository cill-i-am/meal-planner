import type { SetupCheckpoint } from "@meal-planner/household-api";
import {
  FamilyName,
  HouseholdOrganizationId,
  BootstrapHouseholdCreatorPayload,
} from "@meal-planner/household-api";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";

import { useAppForm } from "../../components/forms/form.js";
import { Avatar, AvatarFallback } from "../../components/ui/avatar.js";
import { Button } from "../../components/ui/button.js";
import {
  CardBody,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../components/ui/card.js";
import { FieldGroup } from "../../components/ui/field.js";
import { completeFamilyCreation } from "./family-creation.js";
import { useSetup } from "./setup-context.js";
import { SetupError, SetupFrame } from "./setup-ui.js";

type FamilyCreation = Extract<SetupCheckpoint, { stage: "family-create" }>;

const FamilyForm = Schema.Struct({ name: FamilyName });
const validator = Schema.toStandardSchemaV1(FamilyForm);
const parse = Schema.decodeUnknownSync(FamilyForm);

export const FamilyNamePage = () => {
  const setup = useSetup();
  const navigate = useNavigate();
  const { checkpoint } = setup.progress;
  const mutation = useMutation({
    mutationFn: async (command: FamilyCreation) => {
      await setup.save({ checkpoint: command, status: "active" });
      const next = await completeFamilyCreation(
        command,
        setup.auth,
        setup.peopleForFamily
      );
      await setup.selectFamily(next.organizationId);
      await setup.save({ checkpoint: next, status: "active" });
      await navigate({ to: "/setup/review" });
    },
  });
  const persisted =
    checkpoint.stage === "family-create" ? checkpoint : undefined;
  const retained = persisted ?? mutation.variables;
  const needsRecovery =
    retained !== undefined && (mutation.isIdle || mutation.isError);
  const exit = useMutation({
    mutationFn: async (name: string) => {
      await setup.logout({
        checkpoint: retained ?? { name, stage: "family-name" },
        status: "paused",
      });
    },
  });
  const existingFamily = useMutation({
    mutationFn: async (id: string) => {
      const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
        id
      );
      await setup.selectFamily(organizationId);
      await setup.save({
        checkpoint: { organizationId, stage: "family-review" },
        status: "active",
      });
      await navigate({ to: "/setup/review" });
    },
  });
  const pending =
    mutation.isPending || exit.isPending || existingFamily.isPending;
  const form = useAppForm({
    defaultValues: {
      name:
        checkpoint.stage === "family-name" ||
        checkpoint.stage === "family-create"
          ? checkpoint.name
          : "",
    },
    onSubmit: async ({ value }) => {
      const input = parse(value);
      const command = retained ?? {
        creator: Schema.decodeUnknownSync(BootstrapHouseholdCreatorPayload)({
          displayName: setup.user.name,
          mutationId: crypto.randomUUID(),
        }),
        name: input.name,
        slug: `family-${crypto.randomUUID()}`,
        stage: "family-create" as const,
      };
      await mutation.mutateAsync(command).catch(() => {
        // The mutation owns and displays the failure.
      });
    },
    validators: { onChange: validator, onSubmit: validator },
  });
  const submitLabel = needsRecovery ? "Check and continue" : "Create family";
  return (
    <SetupFrame
      step="family"
      action={
        <Button
          variant="link"
          disabled={pending}
          onClick={() => exit.mutate(form.state.values.name)}
        >
          {exit.isPending ? "Logging out…" : "Log out"}
        </Button>
      }
    >
      <form.AppForm>
        <form.Frame
          className="max-w-140 [--card-spacing:--spacing(4)] md:[--card-spacing:--spacing(10)]"
          pending={pending}
        >
          <CardBody>
            <CardHeader>
              <CardTitle>
                <h1
                  id="auth-title"
                  tabIndex={-1}
                  className="text-task-mobile/8 md:text-task-desktop/9 font-semibold tracking-tight focus:outline-none"
                >
                  {needsRecovery
                    ? "Let’s check your family"
                    : "Name your family"}
                </h1>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <form.AppField name="name">
                  {(field) => (
                    <field.TextField
                      id="family-name"
                      label="Family name"
                      autoComplete="off"
                      disabled={pending || retained !== undefined}
                    />
                  )}
                </form.AppField>
              </FieldGroup>
              <div className="flex items-center gap-3">
                <Avatar size="lg" aria-hidden="true">
                  <AvatarFallback tone="lilac">
                    {[...setup.user.name][0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span>{setup.user.name}</span>
                  <span className="text-muted-foreground text-sm">You</span>
                </div>
              </div>
              {needsRecovery && (
                <SetupError>
                  We saved your request but still need to confirm the result.
                  Check again to finish the same family setup.
                </SetupError>
              )}
              {existingFamily.error && (
                <SetupError>
                  We couldn’t open that family. Try again.
                </SetupError>
              )}
              {!retained && setup.families.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-sm">
                    Or continue with a family you’ve already joined:
                  </p>
                  {setup.families.map((family) => (
                    <Button
                      key={family.id}
                      variant="outline"
                      disabled={pending}
                      onClick={() => existingFamily.mutate(family.id)}
                    >
                      {family.name}
                    </Button>
                  ))}
                </div>
              )}
              {exit.error && (
                <SetupError>
                  We couldn’t save your place or log you out. Try again.
                </SetupError>
              )}
              <Button type="submit" disabled={pending}>
                {mutation.isPending ? "Saving your family…" : submitLabel}
              </Button>
            </CardContent>
          </CardBody>
        </form.Frame>
      </form.AppForm>
    </SetupFrame>
  );
};
