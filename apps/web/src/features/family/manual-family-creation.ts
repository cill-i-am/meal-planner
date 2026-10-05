import type { ReviewedRoster } from "@meal-planner/agent-conversations-api";
import {
  FamilyForbidden,
  FamilyInvalidInput,
  FamilyRateLimited,
  FamilyUnauthorized,
} from "@meal-planner/families";
import {
  CreateHouseholdPersonPayload,
  RenameHouseholdPersonPayload,
} from "@meal-planner/household-api";
import type {
  HouseholdOrganizationId,
  HouseholdPerson,
  HouseholdPersonId,
} from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useRef, useState } from "react";

import {
  apiEffectQuery,
  queryFailure,
  useApiRuntime,
} from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import {
  HouseholdPeopleOperationError,
  makeHouseholdPeopleEffectOperations,
} from "../household-people/index.js";
import { usePendingRequest } from "../request-recovery/index.js";
import { useCreateFamily } from "./family-creation.js";
import { familyKeys } from "./family-operations.js";
import { familyRosterQueryOptions } from "./people-queries.js";

type ManualStep =
  | {
      readonly _tag: "RenameCreator";
      readonly familyId: HouseholdOrganizationId;
      readonly personId: HouseholdPersonId;
      readonly payload: typeof RenameHouseholdPersonPayload.Type;
    }
  | {
      readonly _tag: "CreatePerson";
      readonly familyId: HouseholdOrganizationId;
      readonly payload: typeof CreateHouseholdPersonPayload.Type;
    };

interface Progress {
  readonly reviewed: ReviewedRoster;
  readonly creatorMutationId: string;
  readonly familyId?: HouseholdOrganizationId;
  readonly creatorSaved: boolean;
  readonly nextPerson: number;
}

export const useManualFamilyCreation = () => {
  const account = useAccount();
  const runtime = useApiRuntime();
  const queryClient = useQueryClient();
  const createFamily = useCreateFamily();
  const pendingStep = usePendingRequest<ManualStep>(
    `${account.user.id}:manual-family-roster`
  );
  const progress = useRef<Progress | null>(null);
  const running = useRef(false);
  const [familyId, setFamilyId] = useState<HouseholdOrganizationId>();
  const [state, setState] = useState<
    "idle" | "pending" | "unknown" | "committed" | "rejected"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedPeople, setSavedPeople] = useState(0);
  const mutation = useMutation({
    ...apiEffectQuery.mutationOptions({
      mutationFn: (step: ManualStep) => {
        const people = makeHouseholdPeopleEffectOperations(
          { organizationId: step.familyId, userId: account.user.id },
          runtime
        );
        return step._tag === "CreatePerson"
          ? people.create(step.payload)
          : people.rename(step.personId, step.payload);
      },
      mutationKey: ["families", account.user.id, "manual-roster"],
    }),
    onSuccess: (_person, step) => {
      void (async () => {
        try {
          await queryClient.invalidateQueries({
            queryKey: familyKeys.people(account.user.id, step.familyId),
          });
        } catch {
          // A confirmed save stays successful when refreshing the roster fails.
        }
      })();
    },
  });

  // eslint-disable-next-line complexity -- Sequential confirmed steps and typed recovery outcomes share one saved cursor.
  const submit = async (reviewed: ReviewedRoster) => {
    if (running.current) {
      return null;
    }
    running.current = true;
    setState("pending");
    setErrorMessage(null);
    let retainedStep = pendingStep.pending;
    const runStep = async (step: ManualStep): Promise<HouseholdPerson> => {
      const exact = retainedStep ?? step;
      const id = exact.payload.mutationId;
      pendingStep.retain(id, exact);
      const person = await mutation.mutateAsync(exact);
      pendingStep.release(id);
      retainedStep = undefined;
      return person;
    };
    try {
      let { current } = progress;
      if (!current) {
        current = {
          creatorMutationId: crypto.randomUUID(),
          creatorSaved: false,
          nextPerson: 0,
          reviewed,
        };
        progress.current = current;
      }
      if (!current.familyId) {
        const family = await createFamily.submit(current.reviewed.familyName);
        current = { ...current, familyId: family.id };
        progress.current = current;
        setFamilyId(family.id);
      }
      const selectedFamilyId = current.familyId;
      if (!selectedFamilyId) {
        throw new Error("A saved family is required.");
      }
      if (!current.creatorSaved) {
        const roster = await queryClient.fetchQuery(
          familyRosterQueryOptions(runtime, account.user.id, selectedFamilyId)
        );
        const creator = roster.people.find(
          (person) => person.id === roster.currentPersonId
        );
        if (!creator) {
          throw new Error(
            "The family was saved, but your person could not be loaded."
          );
        }
        if (creator.displayName !== current.reviewed.creatorName) {
          await runStep({
            _tag: "RenameCreator",
            familyId: selectedFamilyId,
            payload: Schema.decodeUnknownSync(RenameHouseholdPersonPayload)({
              displayName: current.reviewed.creatorName,
              expectedVersion: creator.version,
              mutationId: current.creatorMutationId,
            }),
            personId: creator.id,
          });
        } else if (retainedStep?._tag === "RenameCreator") {
          pendingStep.release(retainedStep.payload.mutationId);
          retainedStep = undefined;
        }
        current = { ...current, creatorSaved: true };
        progress.current = current;
      }
      for (
        let index = current.nextPerson;
        index < current.reviewed.people.length;
        index += 1
      ) {
        const person = current.reviewed.people[index];
        if (!person) {
          break;
        }
        // eslint-disable-next-line no-await-in-loop -- Each confirmed person advances the saved cursor before the next command.
        await runStep({
          _tag: "CreatePerson",
          familyId: selectedFamilyId,
          payload: Schema.decodeUnknownSync(CreateHouseholdPersonPayload)({
            displayName: person.displayName,
            kind: person.kind,
            mutationId: person.draftId,
          }),
        });
        current = { ...current, nextPerson: index + 1 };
        progress.current = current;
        setSavedPeople(index + 1);
      }
      setState("committed");
      return selectedFamilyId;
    } catch (error) {
      const failure = queryFailure(error);
      if (Schema.is(FamilyInvalidInput)(failure)) {
        progress.current = null;
        setState("idle");
        setErrorMessage("Check your family name and try again.");
      } else if (Schema.is(FamilyForbidden)(failure)) {
        progress.current = null;
        setState("idle");
        setErrorMessage(
          "This account can’t create a family. Choose one you’ve already joined or sign in with another account."
        );
      } else if (
        failure instanceof HouseholdPeopleOperationError &&
        [
          "invalid_request",
          "organizer_required",
          "mutation_collision",
        ].includes(failure.code)
      ) {
        setState("rejected");
        setErrorMessage(
          "Your family is saved, but this person could not be added. Open the saved family to review its people."
        );
      } else {
        setState("unknown");
        if (Schema.is(FamilyRateLimited)(failure)) {
          setErrorMessage(
            "Too many attempts. Wait a moment, then check the same request again."
          );
        } else if (
          Schema.is(FamilyUnauthorized)(failure) ||
          (failure instanceof HouseholdPeopleOperationError &&
            failure.code === "unauthorized")
        ) {
          setErrorMessage(
            "Your session ended. Log in again, then check the same request."
          );
        }
      }
      return null;
    } finally {
      running.current = false;
    }
  };

  return {
    errorMessage,
    familyId,
    retry: () =>
      progress.current
        ? submit(progress.current.reviewed)
        : Promise.resolve(null),
    savedPeople,
    state,
    submit,
  };
};
