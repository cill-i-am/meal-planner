import type { ConversationBlock } from "@meal-planner/agent-conversations-api";
import type {
  HouseholdPersonId,
  MealPlanId,
} from "@meal-planner/household-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Overlay } from "../../components/ui/responsive-overlay.js";
import { apiEffectQuery, useApiRuntime } from "../api-client/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import {
  PlanningContentProposalReviewSheet,
  usePlanningContentSnapshot,
} from "../food-book/index.js";
import { makeHouseholdPeopleEffectOperations } from "../household-people/index.js";
import {
  HouseholdProfilesPanel,
  invalidateHouseholdProfiles,
  makeHouseholdProfileEffectOperations,
} from "../household-profiles/index.js";
import { PrivateInterviewsPanel } from "../private-interviews/index.js";
import {
  AgentConversationProvider,
  useAgentConversation,
} from "./conversation-controller.js";
import { ConversationSurface } from "./conversation-surface.js";
import type {
  ConversationPerson,
  PlanProposalReview,
  PlanProposalReviewActions,
  PlanningContentProposalReview,
} from "./conversation-surface.js";

const FamilyConversation = ({
  people,
  scope,
  selectedPersonId,
  onSelectPerson,
  planId,
  onPlanChangeCommitted,
  onPlanProposalReview,
  onPlanningContentProposalReview,
  onOpenPrivate,
}: {
  readonly people: readonly ConversationPerson[];
  readonly scope: DisplayedIdentity;
  readonly selectedPersonId: HouseholdPersonId | null;
  readonly onSelectPerson?: (personId: HouseholdPersonId | null) => void;
  readonly planId?: MealPlanId;
  readonly onPlanChangeCommitted?: () => void;
  readonly onPlanProposalReview?: PlanProposalReview;
  readonly onPlanningContentProposalReview?: PlanningContentProposalReview;
  readonly onOpenPrivate?: () => void;
}) => {
  const conversation = useAgentConversation();
  const planningContent = usePlanningContentSnapshot(scope);
  return (
    <>
      {planningContent.isError && (
        <Alert>
          <p>
            Current meal details could not be loaded. Routine suggestions need
            them for review.
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              await planningContent.refetch();
            }}
          >
            Retry meal details
          </Button>
        </Alert>
      )}
      <ConversationSurface
        conversation={conversation}
        people={people}
        selectedPersonId={selectedPersonId}
        {...(onSelectPerson === undefined ? {} : { onSelectPerson })}
        {...(planId === undefined ? {} : { planId })}
        {...(onPlanChangeCommitted === undefined
          ? {}
          : { onPlanChangeCommitted })}
        {...(onPlanProposalReview === undefined
          ? {}
          : { onPlanProposalReview })}
        {...(onPlanningContentProposalReview === undefined
          ? {}
          : { onPlanningContentProposalReview })}
        {...(onOpenPrivate === undefined ? {} : { onOpenPrivate })}
        planningContent={planningContent.data ?? null}
      />
    </>
  );
};

/** The shared conversation and the adult's private interview have separate owners. */
export const OurTastesPage = ({
  scope,
}: {
  readonly scope: DisplayedIdentity;
}) => {
  const queryClient = useQueryClient();
  const runtime = useApiRuntime();
  const peopleOperations = useMemo(
    () => makeHouseholdPeopleEffectOperations(scope, runtime),
    [scope.organizationId, scope.userId, runtime]
  );
  const profileOperations = useMemo(
    () => makeHouseholdProfileEffectOperations(scope, runtime),
    [scope.organizationId, scope.userId, runtime]
  );
  const [selectedPersonId, setSelectedPersonId] =
    useState<HouseholdPersonId | null>(null);
  const [privateOpen, setPrivateOpen] = useState(false);
  const [contentReview, setContentReview] = useState<{
    readonly block: Extract<
      ConversationBlock,
      { _tag: "PlanningContentProposal" }
    >;
    readonly actions: PlanProposalReviewActions;
  } | null>(null);
  const roster = useQuery(
    apiEffectQuery.queryOptions({
      queryFn: () => peopleOperations.list(false),
      queryKey: ["our-tastes-roster", scope.userId, scope.organizationId],
      retry: false,
      staleTime: 15_000,
    })
  );
  const people: ConversationPerson[] =
    roster.data?.people
      .filter((person) => person.lifecycle === "active")
      .map((person) => ({
        displayName: person.displayName,
        id: person.id,
        isCurrentAdult: person.isCurrentAdult,
        kind: person.kind,
      })) ?? [];
  return (
    <section
      aria-labelledby="our-tastes-title"
      className="flex w-full flex-col gap-10 py-5 md:gap-14 md:py-8"
    >
      <header className="flex max-w-3xl flex-col gap-4">
        <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
          Our tastes
        </p>
        <h1
          id="our-tastes-title"
          className="font-display text-signup-promise-mobile md:text-signup-promise-desktop leading-none tracking-tight"
        >
          Find the food they say yes to.
        </h1>
        <p className="text-muted-foreground text-base leading-7">
          Ask about each person, review useful suggestions, and keep shared food
          facts up to date.
        </p>
      </header>
      {roster.isPending && <p role="status">Loading your family…</p>}
      {roster.isError && (
        <Alert>
          <p>Your family roster could not be loaded.</p>
          <Button
            variant="outline"
            onClick={async () => {
              await roster.refetch();
            }}
          >
            Try again
          </Button>
        </Alert>
      )}
      {roster.data !== undefined && (
        <AgentConversationProvider
          accountId={scope.userId}
          scope={{ _tag: "FamilyShared", familyId: scope.organizationId }}
        >
          <FamilyConversation
            scope={scope}
            people={people}
            selectedPersonId={selectedPersonId}
            onSelectPerson={setSelectedPersonId}
            onOpenPrivate={() => setPrivateOpen(true)}
            onPlanningContentProposalReview={(block, actions) =>
              setContentReview({ actions, block })
            }
          />
        </AgentConversationProvider>
      )}
      <Overlay.Root
        open={contentReview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setContentReview(null);
          }
        }}
        desktop="drawer"
      >
        <Overlay.Content data-theme="journey">
          <Overlay.Header>
            <Overlay.Title className="sr-only">
              Review meal setup change
            </Overlay.Title>
            <Overlay.Description className="sr-only">
              Review the exact suggested change before confirming.
            </Overlay.Description>
          </Overlay.Header>
          <Overlay.Body>
            {contentReview && (
              <PlanningContentProposalReviewSheet
                scope={scope}
                block={contentReview.block}
                actions={contentReview.actions}
                onClose={() => setContentReview(null)}
              />
            )}
          </Overlay.Body>
        </Overlay.Content>
      </Overlay.Root>
      <details
        className="group border-border border-t pt-6"
        id="private-food-conversations"
        open={privateOpen}
        onToggle={(event) => setPrivateOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer items-center justify-between font-medium">
          My private food conversations <span aria-hidden="true">↗</span>
        </summary>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          Your own answers stay private. Review and confirm any proposed fact
          before sharing it with the family.
        </p>
        <div className="pt-6">
          <PrivateInterviewsPanel
            accountId={scope.userId}
            householdId={scope.organizationId}
            onConfirmationSettled={() => {
              void invalidateHouseholdProfiles(
                queryClient,
                scope.organizationId
              );
            }}
          />
        </div>
      </details>
      <details
        className="group border-border border-t pt-6"
        id="saved-food-facts"
      >
        <summary className="flex min-h-11 cursor-pointer items-center justify-between font-medium">
          Review saved food facts <span aria-hidden="true">↗</span>
        </summary>
        <div className="pt-6">
          <HouseholdProfilesPanel
            accountId={scope.userId}
            organizationId={scope.organizationId}
            operations={profileOperations}
            peopleOperations={peopleOperations}
            selectedPersonId={selectedPersonId}
            onSelectPerson={setSelectedPersonId}
          />
        </div>
      </details>
    </section>
  );
};

export const FamilyConversationPanel = ({
  scope,
  planId,
  onPlanChangeCommitted,
  onPlanProposalReview,
  onPlanningContentProposalReview,
}: {
  readonly scope: DisplayedIdentity;
  readonly planId?: MealPlanId;
  readonly onPlanChangeCommitted?: () => void;
  readonly onPlanProposalReview?: PlanProposalReview;
  readonly onPlanningContentProposalReview?: PlanningContentProposalReview;
}) => {
  const runtime = useApiRuntime();
  const peopleOperations = useMemo(
    () => makeHouseholdPeopleEffectOperations(scope, runtime),
    [scope.organizationId, scope.userId, runtime]
  );
  const roster = useQuery(
    apiEffectQuery.queryOptions({
      queryFn: () => peopleOperations.list(false),
      queryKey: ["our-tastes-roster", scope.userId, scope.organizationId],
      retry: false,
      staleTime: 15_000,
    })
  );
  return (
    <AgentConversationProvider
      accountId={scope.userId}
      scope={{ _tag: "FamilyShared", familyId: scope.organizationId }}
    >
      <FamilyConversation
        scope={scope}
        people={
          roster.data?.people
            .filter((person) => person.lifecycle === "active")
            .map((person) => ({
              displayName: person.displayName,
              id: person.id,
              isCurrentAdult: person.isCurrentAdult,
              kind: person.kind,
            })) ?? []
        }
        selectedPersonId={null}
        {...(planId === undefined ? {} : { planId })}
        {...(onPlanChangeCommitted === undefined
          ? {}
          : { onPlanChangeCommitted })}
        {...(onPlanProposalReview === undefined
          ? {}
          : { onPlanProposalReview })}
        {...(onPlanningContentProposalReview === undefined
          ? {}
          : { onPlanningContentProposalReview })}
      />
    </AgentConversationProvider>
  );
};
