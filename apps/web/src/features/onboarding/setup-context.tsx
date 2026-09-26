import {
  EmailAddress,
  HouseholdOrganizationId,
  makeSetupProgressApiClientLayer,
  SetupProgressApiClient,
  SetupProgress,
  SetupProgressVersion,
  UserId,
} from "@meal-planner/household-api";
import type { HouseholdPersonMutationId } from "@meal-planner/household-api";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useRouter } from "@tanstack/react-router";
import { Data, Effect, Layer, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { ReactNode } from "react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  makeAuthClient,
  useAuthClient,
  requireAuthSuccess,
} from "../auth/auth-client.js";
import {
  makeBrowserHouseholdPeopleEffectOperations,
  makeBrowserHouseholdPeopleOperations,
} from "../household-people/browser-operations.js";
import type {
  HouseholdPeopleEffectOperations,
  HouseholdPeopleOperations,
} from "../household-people/operations.js";
import { initialSetup, parseSetupProgress } from "./setup-state.js";
import { SetupStatus } from "./setup-ui.js";

type AuthClient = ReturnType<typeof useAuthClient>;
type SetupProgressSaveError = Effect.Error<
  ReturnType<SetupProgressApiClient["setupProgress"]["save"]>
>;
class SetupExternalFailure extends Data.TaggedError("SetupExternalFailure")<{
  readonly operation:
    | "activateFamily"
    | "logout"
    | "navigate"
    | "refreshSession";
  readonly cause: unknown;
}> {}
const external = <A,>(
  operation: SetupExternalFailure["operation"],
  run: () => Promise<A>
): Effect.Effect<A, SetupExternalFailure> =>
  Effect.tryPromise({
    catch: (cause) => new SetupExternalFailure({ cause, operation }),
    try: run,
  });
export interface SetupContextValue {
  readonly auth: AuthClient;
  readonly user: {
    readonly id: typeof UserId.Type;
    readonly name: string;
    readonly email: typeof EmailAddress.Type;
  };
  readonly progress: SetupProgress;
  readonly families: readonly {
    readonly id: typeof HouseholdOrganizationId.Type;
    readonly name: string;
    readonly slug: string;
  }[];
  readonly peopleEffectForFamily: (
    id: typeof HouseholdOrganizationId.Type
  ) => HouseholdPeopleEffectOperations;
  readonly peopleForFamily: (
    id: typeof HouseholdOrganizationId.Type
  ) => HouseholdPeopleOperations;
  readonly isFamilyOrganizer: (
    id: typeof HouseholdOrganizationId.Type
  ) => boolean;
  readonly save: (
    progress: SetupProgress,
    sourceCommandId?: typeof HouseholdPersonMutationId.Type
  ) => Effect.Effect<void, SetupProgressSaveError | SetupExternalFailure>;
  readonly refresh: () => Promise<void>;
  readonly selectFamily: (
    id: typeof HouseholdOrganizationId.Type
  ) => Effect.Effect<void, SetupExternalFailure>;
  readonly logout: (
    progress?: SetupProgress
  ) => Effect.Effect<void, SetupProgressSaveError | SetupExternalFailure>;
}
const SetupContext = createContext<SetupContextValue | null>(null);
export const useSetup = () => {
  const context = use(SetupContext);
  if (context === null) {
    throw new Error("Setup requires its account provider.");
  }
  return context;
};

const SetupLoginRedirect = () => {
  const router = useRouter();
  const [redirect] = useState(() => router.state.location.href);
  return <Navigate to="/login" search={{ redirect }} replace />;
};

const SetupFamilyActivation = ({
  activeFamilyId,
  children,
  familyId,
  selectFamily,
}: {
  readonly activeFamilyId: string | null | undefined;
  readonly children: ReactNode;
  readonly familyId: typeof HouseholdOrganizationId.Type;
  readonly selectFamily: (
    id: typeof HouseholdOrganizationId.Type
  ) => Effect.Effect<void, SetupExternalFailure>;
}) => {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (activeFamilyId === familyId) {
      return;
    }
    let current = true;
    const activate = async () => {
      try {
        await Effect.runPromise(selectFamily(familyId));
      } catch {
        if (current) {
          setFailed(true);
        }
      }
    };
    void activate();
    return () => {
      current = false;
    };
  }, [activeFamilyId, familyId, selectFamily, attempt]);
  if (activeFamilyId === familyId) {
    return children;
  }
  if (failed) {
    return (
      <SetupStatus
        title="Your family couldn’t be opened"
        retry={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
          return Promise.resolve();
        }}
      />
    );
  }
  return <SetupStatus title="Opening your family…" />;
};

const setupResourceStatus = (
  session: ReturnType<AuthClient["useSession"]>,
  organizations: ReturnType<AuthClient["useListOrganizations"]>,
  active: ReturnType<AuthClient["useActiveOrganization"]>
): ReactNode | null => {
  if (session.isPending) {
    return <SetupStatus title="Loading your setup…" />;
  }
  if (session.error) {
    return (
      <SetupStatus
        title="Your account didn’t load"
        retry={() => session.refetch()}
      />
    );
  }
  if (session.data === null) {
    return <SetupLoginRedirect />;
  }
  if (organizations.isPending || active.isPending) {
    return <SetupStatus title="Loading your family…" />;
  }
  if (organizations.error || active.error) {
    return (
      <SetupStatus
        title="Your family didn’t load"
        retry={async () => {
          await Promise.all([organizations.refetch(), active.refetch()]);
        }}
      />
    );
  }
  return null;
};

export const SetupProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const auth = useAuthClient();
  const session = auth.useSession();
  const organizations = auth.useListOrganizations();
  const active = auth.useActiveOrganization();
  const queryClient = useQueryClient();
  const router = useRouter();
  const lastSaved = useRef<{ userId: string | undefined; version: number }>({
    userId: undefined,
    version: 0,
  });
  const userId = session.data?.user.id;
  const email = session.data?.user.email;
  const parsedUserId = useMemo(
    () =>
      userId === undefined
        ? undefined
        : Schema.decodeUnknownSync(UserId)(userId),
    [userId]
  );
  const parsedEmail = useMemo(
    () =>
      email === undefined
        ? undefined
        : Schema.decodeUnknownSync(EmailAddress)(email),
    [email]
  );
  const scopedAuth = useMemo(
    () => makeAuthClient(fetch, parsedUserId),
    [parsedUserId]
  );
  const sessionVersion = Schema.decodeUnknownSync(SetupProgressVersion)(
    session.data?.user.setupProgressVersion ?? 0
  );
  useEffect(() => {
    if (lastSaved.current.userId === parsedUserId) {
      lastSaved.current.version = Math.max(
        lastSaved.current.version,
        sessionVersion
      );
    } else {
      lastSaved.current = { userId: parsedUserId, version: sessionVersion };
    }
  }, [parsedUserId, sessionVersion]);
  const selectFamily = useCallback(
    (id: typeof HouseholdOrganizationId.Type) =>
      Effect.gen(function* activateFamily() {
        const current = yield* external("activateFamily", () =>
          requireAuthSuccess(scopedAuth.getSession())
        );
        if (current.session.activeOrganizationId !== id) {
          yield* external("activateFamily", () =>
            requireAuthSuccess(
              scopedAuth.organization.setActive({ organizationId: id })
            )
          );
        }
        yield* external("activateFamily", () =>
          Promise.all([active.refetch(), organizations.refetch()])
        );
      }),
    [scopedAuth, active.refetch, organizations.refetch]
  );
  const resourceStatus = setupResourceStatus(session, organizations, active);
  if (resourceStatus) {
    return resourceStatus;
  }
  if (session.data === null) {
    throw new Error("A loaded setup session is required.");
  }
  let progress: SetupProgress;
  try {
    progress = parseSetupProgress(
      session.data.user.setupProgress ?? initialSetup
    );
  } catch {
    return (
      <SetupStatus
        title="Your saved setup couldn’t be read"
        retry={() => session.refetch()}
      />
    );
  }
  const { user: sessionUser } = session.data;
  if (parsedUserId === undefined || parsedEmail === undefined) {
    throw new Error("Authenticated session has no user identity.");
  }
  const user = { ...sessionUser, email: parsedEmail, id: parsedUserId };
  const families = (organizations.data ?? []).map((family) => ({
    ...family,
    id: Schema.decodeUnknownSync(HouseholdOrganizationId)(family.id),
  }));
  const persistProgress = (
    next: SetupProgress,
    sourceCommandId?: typeof HouseholdPersonMutationId.Type
  ) =>
    Effect.gen(function* persistSetupProgress() {
      const decoded = Schema.decodeUnknownSync(SetupProgress)(next);
      const payload: {
        expectedVersion: typeof SetupProgressVersion.Type;
        progress: SetupProgress;
        sourceCommandId?: typeof HouseholdPersonMutationId.Type;
      } = {
        expectedVersion: Schema.decodeUnknownSync(SetupProgressVersion)(
          lastSaved.current.version
        ),
        progress: decoded,
      };
      if (sourceCommandId !== undefined) {
        payload.sourceCommandId = sourceCommandId;
      }
      const saved = yield* SetupProgressApiClient.use((api) =>
        api.setupProgress.save({ payload })
      ).pipe(
        Effect.provide(
          makeSetupProgressApiClientLayer({
            baseUrl: window.location.origin,
            headers: { "x-meal-planner-user": user.id },
          }).pipe(Layer.provide(FetchHttpClient.layer))
        ),
        Effect.catchTag("SetupProgressConflict", (conflict) =>
          external("refreshSession", () => session.refetch()).pipe(
            Effect.flatMap(() => Effect.fail(conflict))
          )
        )
      );
      lastSaved.current.version = saved.version;
    });
  const save = (
    next: SetupProgress,
    sourceCommandId?: typeof HouseholdPersonMutationId.Type
  ) =>
    persistProgress(next, sourceCommandId).pipe(
      Effect.flatMap(() => external("refreshSession", () => session.refetch())),
      Effect.asVoid
    );
  const familyId =
    progress.status === "paused" ||
    progress.checkpoint.stage === "invitation-response" ||
    progress.checkpoint.stage === "invitation-link" ||
    !("organizationId" in progress.checkpoint)
      ? undefined
      : progress.checkpoint.organizationId;
  return (
    <SetupContext
      key={user.id}
      value={{
        auth: scopedAuth,
        families,
        isFamilyOrganizer: (organizationId) =>
          active.data?.id === organizationId &&
          active.data.members.some(
            (member) => member.userId === user.id && member.role === "owner"
          ),
        logout: (next) =>
          Effect.gen(function* logout() {
            if (next !== undefined) {
              yield* persistProgress(next);
            }
            const redirect = router.state.location.pathname.startsWith(
              "/invitation/"
            )
              ? router.state.location.href
              : "/setup";
            yield* external("logout", () =>
              requireAuthSuccess(scopedAuth.signOut())
            );
            yield* external("refreshSession", () => session.refetch());
            queryClient.clear();
            yield* external("navigate", () =>
              router.navigate({
                replace: true,
                search: { redirect },
                to: "/login",
              })
            );
          }),
        peopleEffectForFamily: (organizationId) =>
          makeBrowserHouseholdPeopleEffectOperations({
            organizationId,
            userId: user.id,
          }),
        peopleForFamily: (organizationId) =>
          makeBrowserHouseholdPeopleOperations({
            organizationId,
            userId: user.id,
          }),
        progress,
        refresh: async () => {
          await Promise.all([
            session.refetch(),
            organizations.refetch(),
            active.refetch(),
          ]);
        },
        save,
        selectFamily,
        user,
      }}
    >
      {familyId === undefined ? (
        children
      ) : (
        <SetupFamilyActivation
          activeFamilyId={active.data?.id}
          familyId={familyId}
          selectFamily={selectFamily}
        >
          {children}
        </SetupFamilyActivation>
      )}
    </SetupContext>
  );
};
