import {
  DepartHouseholdAdultPayload,
  InviteHouseholdAdultPayload,
} from "@meal-planner/household-api";
import type {
  DepartHouseholdAdultPayload as DepartHouseholdAdultPayloadType,
  InviteHouseholdAdultPayload as InviteHouseholdAdultPayloadType,
} from "@meal-planner/household-api";
import { Option, Schema } from "effect";

const RetainedHouseholdPeopleIntents = Schema.Struct({
  departure: Schema.NullOr(DepartHouseholdAdultPayload),
  invitation: Schema.NullOr(InviteHouseholdAdultPayload),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

export interface RetainedHouseholdPeopleIntents {
  readonly departure: DepartHouseholdAdultPayloadType | null;
  readonly invitation: InviteHouseholdAdultPayloadType | null;
}

const emptyIntents: RetainedHouseholdPeopleIntents = {
  departure: null,
  invitation: null,
};
const cache = new Map<
  string,
  {
    readonly raw: string | null;
    readonly value: RetainedHouseholdPeopleIntents;
  }
>();
const listeners = new Map<string, Set<() => void>>();

const keyFor = (organizationId: string) =>
  `meal-planner.household-people.intents.v1:${organizationId}`;

const readRaw = (key: string) => {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const decode = (raw: string | null): RetainedHouseholdPeopleIntents => {
  if (raw === null) {
    return emptyIntents;
  }
  try {
    return (
      Option.getOrUndefined(
        Schema.decodeUnknownOption(RetainedHouseholdPeopleIntents)(
          JSON.parse(raw)
        )
      ) ?? emptyIntents
    );
  } catch {
    return emptyIntents;
  }
};

export const retainedHouseholdPeopleIntents = (
  organizationId: string
): RetainedHouseholdPeopleIntents => {
  const key = keyFor(organizationId);
  const raw = readRaw(key);
  const cached = cache.get(key);
  if (cached?.raw === raw) {
    return cached.value;
  }
  const value = decode(raw);
  cache.set(key, { raw, value });
  return value;
};

const store = (
  organizationId: string,
  value: RetainedHouseholdPeopleIntents
) => {
  const key = keyFor(organizationId);
  const raw =
    value.departure === null && value.invitation === null
      ? null
      : JSON.stringify(value);
  if (raw === null) {
    globalThis.sessionStorage.removeItem(key);
  } else {
    globalThis.sessionStorage.setItem(key, raw);
  }
  cache.set(key, { raw, value: raw === null ? emptyIntents : value });
  for (const listener of listeners.get(key) ?? []) {
    listener();
  }
};

export const subscribeToRetainedHouseholdPeopleIntents = (
  organizationId: string,
  listener: () => void
) => {
  const key = keyFor(organizationId);
  const current = listeners.get(key) ?? new Set<() => void>();
  current.add(listener);
  listeners.set(key, current);
  return () => {
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(key);
    }
  };
};

export const retainInvitationIntent = (
  organizationId: string,
  invitation: InviteHouseholdAdultPayloadType
) =>
  store(organizationId, {
    ...retainedHouseholdPeopleIntents(organizationId),
    invitation,
  });

export const clearInvitationIntent = (organizationId: string) =>
  store(organizationId, {
    ...retainedHouseholdPeopleIntents(organizationId),
    invitation: null,
  });

export const retainDepartureIntent = (
  organizationId: string,
  departure: DepartHouseholdAdultPayloadType
) =>
  store(organizationId, {
    ...retainedHouseholdPeopleIntents(organizationId),
    departure,
  });

export const clearDepartureIntent = (organizationId: string) =>
  store(organizationId, {
    ...retainedHouseholdPeopleIntents(organizationId),
    departure: null,
  });
