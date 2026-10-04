import {
  HouseholdPersonId,
  HouseholdPersonMutationId,
  MutatePersonProfilePayload,
} from "@meal-planner/household-api";
import type {
  PersonProfile,
  ProfileCommand,
  ProfileVersionPage,
} from "@meal-planner/household-api";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { Schema } from "effect";

import { apiEffectQuery } from "../api-client/index.js";
import type { HouseholdPeopleEffectOperations } from "../household-people/index.js";
import {
  isAmbiguousProfileError,
  profileOperationFailure,
} from "./operations.js";
import type { HouseholdProfileOperations } from "./operations.js";

const PendingProfileChange = Schema.Struct({
  authenticationRequired: Schema.optional(Schema.Boolean),
  payload: MutatePersonProfilePayload,
  personId: HouseholdPersonId,
});
type PendingProfileChange = typeof PendingProfileChange.Type;

const ownsPendingChange = (
  current: PendingProfileChange | null | undefined,
  submitted: PendingProfileChange
) =>
  current?.personId === submitted.personId &&
  current.payload.mutationId === submitted.payload.mutationId;

const householdProfileKey = (organizationId: string) => [
  "household-profile",
  organizationId,
];
export const profileKey = (organizationId: string, personId: string) => [
  ...householdProfileKey(organizationId),
  personId,
];

export const invalidateHouseholdProfiles = (
  client: QueryClient,
  organizationId: string
) =>
  client.invalidateQueries({ queryKey: householdProfileKey(organizationId) });

export const usePersonProfile = (
  operations: HouseholdProfileOperations,
  organizationId: string,
  personId: HouseholdPersonId
) =>
  useQuery(
    apiEffectQuery.queryOptions({
      queryFn: () => operations.get(personId),
      queryKey: profileKey(organizationId, personId),
      retry: false,
    })
  );

export const useProfileHistory = (
  operations: HouseholdProfileOperations,
  organizationId: string,
  personId: HouseholdPersonId
) => {
  const options = {
    getNextPageParam: (page: ProfileVersionPage) =>
      page.nextBeforeVersion ?? undefined,
    initialPageParam: null as number | null,
    queryKey: [...profileKey(organizationId, personId), "history"],
    retry: false,
  };
  const { queryFn } = apiEffectQuery.infiniteQueryOptions({
    ...options,
    queryFn: ({ pageParam }) =>
      operations.versions(personId, pageParam ?? undefined),
  });
  return useInfiniteQuery({ ...options, queryFn });
};

/** One submitted command owns its identity until the result is known. */
export const useHouseholdProfileState = ({
  accountId,
  operations,
  organizationId,
  peopleOperations,
}: {
  readonly accountId: string;
  readonly operations: HouseholdProfileOperations;
  readonly organizationId: string;
  readonly peopleOperations: Pick<HouseholdPeopleEffectOperations, "list">;
}) => {
  const client = useQueryClient();
  const pendingKey = [
    "household-profile-unresolved",
    accountId,
    organizationId,
  ];
  const storageKey = `meal-planner.household-profile.unresolved.v1:${JSON.stringify([accountId, organizationId])}`;
  const readPending = (): PendingProfileChange | null => {
    const raw = globalThis.sessionStorage.getItem(storageKey);
    return raw === null
      ? null
      : Schema.decodeUnknownSync(PendingProfileChange)(JSON.parse(raw));
  };
  const updatePending = (
    update: (
      current: PendingProfileChange | null
    ) => PendingProfileChange | null
  ) => {
    const next = update(readPending());
    if (next === null) {
      globalThis.sessionStorage.removeItem(storageKey);
    } else {
      globalThis.sessionStorage.setItem(storageKey, JSON.stringify(next));
    }
    client.setQueryData(pendingKey, next);
  };
  const pending = useQuery<PendingProfileChange | null>({
    enabled: false,
    gcTime: Infinity,
    initialData: readPending,
    queryFn: readPending,
    queryKey: pendingKey,
  });
  const roster = useQuery(
    apiEffectQuery.queryOptions({
      queryFn: () => peopleOperations.list(true),
      queryKey: ["household-people", organizationId],
      retry: false,
    })
  );
  const mutation = useMutation(
    apiEffectQuery.mutationOptions({
      mutationFn: (change: PendingProfileChange) =>
        operations.mutate(change.personId, change.payload),
      onError: (error, submitted) => {
        updatePending((current) => {
          if (!ownsPendingChange(current, submitted)) {
            return current;
          }
          if (
            profileOperationFailure(error)?.code === "authentication_required"
          ) {
            return { ...submitted, authenticationRequired: true };
          }
          return isAmbiguousProfileError(error) ? current : null;
        });
      },
      onSuccess: async (result, submitted) => {
        client.setQueryData<PersonProfile>(
          profileKey(organizationId, result.personId),
          (existing) =>
            existing !== undefined && existing.version > result.version
              ? existing
              : result
        );
        updatePending((current) =>
          ownsPendingChange(current, submitted) ? null : current
        );
        await client.invalidateQueries({
          queryKey: profileKey(organizationId, result.personId),
        });
      },
      retry: false,
    })
  );
  const send = (
    personId: HouseholdPersonId,
    profile: PersonProfile,
    command: ProfileCommand
  ) => {
    if (readPending() !== null || mutation.isPending) {
      return;
    }
    const change: PendingProfileChange = {
      payload: Schema.decodeUnknownSync(MutatePersonProfilePayload, {
        onExcessProperty: "error",
      })({
        command,
        expectedProfileVersion: profile.version,
        mutationId: Schema.decodeUnknownSync(HouseholdPersonMutationId)(
          crypto.randomUUID()
        ),
      }),
      personId,
    };
    updatePending(() => change);
    mutation.mutate(change);
  };
  const retryPending = () => {
    if (pending.data !== null) {
      mutation.mutate(pending.data);
    }
  };
  return {
    clearError: mutation.reset,
    error: mutation.error,
    isSaving: mutation.isPending,
    pending: pending.data,
    retryPending,
    roster,
    send,
  };
};
