import {
  CreateSetupFamilyRequest,
  HouseholdOrganizationId,
} from "@meal-planner/household-api";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { useState } from "react";

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
import { PendingButton } from "../../components/ui/pending-button.js";
import { familyCreationMutationOptions } from "./family-creation.js";
import { setupEffectQuery } from "./onboarding-people.js";
import { useSetup } from "./setup-context.js";
import { SetupError, SetupFrame } from "./setup-ui.js";

const validator = Schema.toStandardSchemaV1(CreateSetupFamilyRequest);
const parse = Schema.decodeUnknownSync(CreateSetupFamilyRequest);
const submitLabel = (created: boolean, resumed: boolean) => {
  if (created) {
    return "Continue to review";
  }
  return resumed ? "Check and continue" : "Create family";
};

export const FamilyNamePage = () => {
  const setup = useSetup();
  const navigate = useNavigate();
  const { checkpoint } = setup.progress;
  const mutation = useMutation(familyCreationMutationOptions(setup.user.id));
  const [openingReview, setOpeningReview] = useState(false);
  const [openReviewFailed, setOpenReviewFailed] = useState(false);
  const openReview = async () => {
    setOpeningReview(true);
    setOpenReviewFailed(false);
    try {
      await setup.refresh();
      await navigate({ to: "/setup/review" });
    } catch (error) {
      setOpenReviewFailed(true);
      throw error;
    } finally {
      setOpeningReview(false);
    }
  };
  const persisted =
    checkpoint.stage === "family-create" ? checkpoint : undefined;
  const exit = useMutation(
    setupEffectQuery.mutationOptions({
      mutationFn: (name: string) =>
        setup.logout({
          checkpoint: persisted ?? { name, stage: "family-name" },
          status: "paused",
        }),
      mutationKey: ["setup-family-logout"],
    })
  );
  const existingFamily = useMutation(
    setupEffectQuery.mutationOptions({
      mutationFn: (id: string) => {
        const organizationId = Schema.decodeUnknownSync(
          HouseholdOrganizationId
        )(id);
        return setup.save({
          checkpoint: { organizationId, stage: "family-review" },
          status: "active",
        });
      },
      mutationKey: ["setup-existing-family"],
      onSuccess: () => navigate({ to: "/setup/review" }),
    })
  );
  const pending =
    mutation.isPending ||
    openingReview ||
    exit.isPending ||
    existingFamily.isPending;
  const form = useAppForm({
    defaultValues: {
      name:
        checkpoint.stage === "family-name" ||
        checkpoint.stage === "family-create"
          ? checkpoint.name
          : "",
    },
    onSubmit: async ({ value }) => {
      if (!mutation.isSuccess) {
        try {
          await mutation.mutateAsync(parse(value));
        } catch {
          // The typed mutation error is displayed below.
          return;
        }
      }
      try {
        await openReview();
      } catch {
        // Creation succeeded; review navigation can be retried without creating again.
      }
    },
    validators: { onChange: validator, onSubmit: validator },
  });
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
                  {persisted ? "Let’s check your family" : "Name your family"}
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
                      disabled={pending || persisted !== undefined}
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
              {persisted && !mutation.isPending && !mutation.isSuccess && (
                <SetupError>
                  We saved your request but still need to confirm the result.
                  Check again to finish the same family setup.
                </SetupError>
              )}
              {mutation.error && (
                <SetupError>
                  {mutation.error.match({
                    OrElse: () =>
                      "We couldn’t confirm your family request. Try again to resume it.",
                    SetupFamilyConflict: () =>
                      "Another family request is saved. Reload to continue it.",
                    SetupFamilyForbidden: () =>
                      "This account can’t create or open this family. You can choose a family you’ve already joined.",
                    SetupFamilyInvalidRequest: () =>
                      "Enter a valid family name and try again.",
                    SetupFamilyRateLimited: () =>
                      "Too many attempts. Wait a moment and try again.",
                    SetupFamilyUnauthorized: () =>
                      "Your session ended or your account changed. Log in again to continue.",
                    SetupFamilyUnavailable: () =>
                      "We couldn’t confirm your family request. Try again to resume it.",
                  })}
                </SetupError>
              )}
              {openReviewFailed && (
                <SetupError>
                  Your family was created, but we couldn’t open the review. Try
                  again to continue.
                </SetupError>
              )}
              {existingFamily.error && (
                <SetupError>
                  We couldn’t open that family. Try again.
                </SetupError>
              )}
              {!persisted && setup.families.length > 0 && (
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
              <PendingButton
                type="submit"
                disabled={pending}
                pending={mutation.isPending || openingReview}
                pendingLabel={
                  mutation.isPending ? "Saving your family…" : "Opening review…"
                }
              >
                {submitLabel(mutation.isSuccess, persisted !== undefined)}
              </PendingButton>
            </CardContent>
          </CardBody>
        </form.Frame>
      </form.AppForm>
    </SetupFrame>
  );
};
