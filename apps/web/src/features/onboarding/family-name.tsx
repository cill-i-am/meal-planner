import { FamilyName, CreateFamily } from "@meal-planner/families";
import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { useState } from "react";

import { useAppForm } from "../../components/forms/form.js";
import { OperationError } from "../../components/operation-error.js";
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
import {
  familyCreationMutationOptions,
  peopleEffectQuery,
  useFamily,
} from "../family/index.js";
import { useRetainedRequest } from "../request-recovery/index.js";
import { SetupFrame } from "./setup-ui.js";

const FamilyInput = Schema.Struct({ name: FamilyName });
const validator = Schema.toStandardSchemaV1(FamilyInput);
const parse = Schema.decodeUnknownSync(FamilyInput);
const submitLabel = (created: boolean, resumed: boolean) => {
  if (created) {
    return "Continue to review";
  }
  return resumed ? "Check and continue" : "Create family";
};

const FamilyNavigationErrors = ({
  reviewFailed,
  selectionFailed,
  logoutFailed,
}: {
  readonly reviewFailed: boolean;
  readonly selectionFailed: boolean;
  readonly logoutFailed: boolean;
}) => (
  <>
    {reviewFailed && (
      <OperationError>
        Your family was created, but we couldn’t open the review. Try again to
        continue.
      </OperationError>
    )}
    {selectionFailed && (
      <OperationError>We couldn’t open that family. Try again.</OperationError>
    )}
    {logoutFailed && (
      <OperationError>We couldn’t log you out. Try again.</OperationError>
    )}
  </>
);

export const FamilyNamePage = () => {
  const setup = useFamily();
  const navigate = useNavigate();
  const retained = useRetainedRequest(
    `${setup.user.id}:family-create`,
    CreateFamily
  );
  const mutation = useMutation({
    ...familyCreationMutationOptions(setup.user.id),
    onError: (error, command) => {
      const rejected = error.match({
        FamilyForbidden: () => true,
        FamilyInvalidInput: () => true,
        OrElse: () => false,
      });
      if (rejected) {
        retained.release(command.mutationId);
      }
    },
  });
  const [openingReview, setOpeningReview] = useState(false);
  const [openReviewFailed, setOpenReviewFailed] = useState(false);
  const openReview = async (familyId: HouseholdOrganizationId) => {
    setOpeningReview(true);
    setOpenReviewFailed(false);
    try {
      await setup.refresh();
      await navigate({ search: { familyId }, to: "/setup/review" });
    } catch (error) {
      setOpenReviewFailed(true);
      throw error;
    } finally {
      setOpeningReview(false);
    }
  };
  const persisted = retained.pending;
  const exit = useMutation(
    peopleEffectQuery.mutationOptions({
      mutationFn: () => setup.logout("/setup"),
      mutationKey: ["setup-logout"],
    })
  );
  const existingFamily = useMutation(
    peopleEffectQuery.mutationOptions({
      mutationFn: (id: string) =>
        setup.selectFamily(
          Schema.decodeUnknownSync(HouseholdOrganizationId)(id)
        ),
      mutationKey: ["setup-select-family"],
      onSuccess: (_result, id) =>
        navigate({
          search: {
            familyId: Schema.decodeUnknownSync(HouseholdOrganizationId)(id),
          },
          to: "/setup/review",
        }),
    })
  );
  const pending =
    mutation.isPending ||
    openingReview ||
    exit.isPending ||
    existingFamily.isPending;
  const form = useAppForm({
    defaultValues: {
      name: persisted?.name ?? "",
    },
    onSubmit: async ({ value }) => {
      setOpeningReview(true);
      setOpenReviewFailed(false);
      const command =
        persisted ??
        Schema.decodeUnknownSync(CreateFamily)({
          ...parse(value),
          mutationId: crypto.randomUUID(),
        });
      let created = Boolean(mutation.data);
      try {
        retained.retain(command.mutationId, command);
        const family = mutation.data ?? (await mutation.mutateAsync(command));
        created = true;
        await Effect.runPromise(setup.selectFamily(family.id));
        await openReview(family.id);
        retained.release(command.mutationId);
      } catch {
        if (created) {
          setOpenReviewFailed(true);
        }
      } finally {
        setOpeningReview(false);
      }
    },
    validators: { onChange: validator, onSubmit: validator },
  });
  return (
    <SetupFrame
      step="family"
      action={
        <Button variant="link" disabled={pending} onClick={() => exit.mutate()}>
          {exit.isPending ? "Logging out…" : "Log out"}
        </Button>
      }
    >
      <form.AppForm>
        <form.Frame
          key={persisted?.mutationId ?? "new-family"}
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
                  {persisted && !mutation.isPending
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
                <OperationError>
                  We kept your submitted request but still need to confirm the
                  result. Check again to finish the same family setup.
                </OperationError>
              )}
              {retained.error && (
                <OperationError>{retained.error}</OperationError>
              )}
              {mutation.error && (
                <OperationError>
                  {mutation.error.match({
                    FamilyConflict: () =>
                      "Another family request is saved. Reload to continue it.",
                    FamilyForbidden: () =>
                      "This account can’t create or open this family. You can choose a family you’ve already joined.",
                    FamilyInvalidInput: () =>
                      "Enter a valid family name and try again.",
                    FamilyRateLimited: () =>
                      "Too many attempts. Wait a moment and try again.",
                    FamilyUnauthorized: () =>
                      "Your session ended or your account changed. Log in again to continue.",
                    FamilyUnavailable: () =>
                      "We couldn’t confirm your family request. Try again to resume it.",
                    OrElse: () =>
                      "We couldn’t confirm your family request. Try again to resume it.",
                  })}
                </OperationError>
              )}
              <FamilyNavigationErrors
                reviewFailed={openReviewFailed}
                selectionFailed={Boolean(existingFamily.error)}
                logoutFailed={Boolean(exit.error)}
              />
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
