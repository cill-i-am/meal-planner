import type { ProfileFact } from "@meal-planner/household-api";
import type { ProfileCard } from "@meal-planner/private-interview-api";
import { useState } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { describeProfileFact } from "../household-profiles/profile-fact-form.js";
import { PrivateCardCorrection } from "./private-card-correction.js";
import type {
  PrivateInterviewClient,
  PrivateInterviewView,
} from "./private-interview-client.js";
import { matchesCurrentProfileReview } from "./private-profile-review.js";

const afterMeaning = (card: ProfileCard, current: ProfileFact | undefined) => {
  switch (card.change._tag) {
    case "AddConfirmedProfileFact":
    case "ReplaceOrdinaryProfileFact": {
      return describeProfileFact(card.change.fact);
    }
    case "ConfirmProfileFact": {
      const fact =
        card.status === "confirmed" || card.status === "rejected"
          ? card.reviewedFact
          : current?.value;
      return fact === undefined || fact === null
        ? "Confirm the referenced fact"
        : `${describeProfileFact(fact)} — confirmed by you`;
    }
    case "RemoveOrdinaryProfileFact": {
      return "Remove this preference. No replacement is recorded.";
    }
    case "ConfirmHardConstraintReduction": {
      return card.change.replacement === null
        ? "Remove this safety fact. No replacement is recorded."
        : describeProfileFact(card.change.replacement);
    }
    default: {
      throw new Error(`Unreachable change: ${card.change satisfies never}`);
    }
  }
};
const statusLabels = {
  confirmed: "Confirmed for household",
  conflict: "Needs a new review",
  pending: "Confirmation pending",
  proposed: "Private proposal",
  rejected: "Rejected · private history",
};

const currentFact = (card: ProfileCard, view: PrivateInterviewView) => {
  const { change } = card;
  if (change._tag === "AddConfirmedProfileFact") {
    return;
  }
  return view.profile?.facts.find((fact) => fact.id === change.factId);
};
const BeforeMeaning = ({
  card,
  view,
  current,
}: {
  readonly card: ProfileCard;
  readonly view: PrivateInterviewView;
  readonly current: ProfileFact | undefined;
}) => {
  if (view.profile === null) {
    return <>Load your current profile to review this change.</>;
  }
  if (card.change._tag === "AddConfirmedProfileFact") {
    return <>This proposal adds a fact to your profile.</>;
  }
  if (current === undefined) {
    return <>This fact is no longer in your shared profile.</>;
  }
  return (
    <>
      {describeProfileFact(current.value)}
      <br />
      <span className="helper">
        {current.standing._tag === "provisional" ? "Provisional" : "Confirmed"}{" "}
        ·{" "}
        {current.source === "interview"
          ? "Interview confirmation"
          : "Manual entry"}
      </span>
    </>
  );
};
const confirmationLabel = (card: ProfileCard) => {
  if (card.change._tag === "ConfirmHardConstraintReduction") {
    return "Confirm safety change for household";
  }
  if (
    card.change._tag === "AddConfirmedProfileFact" &&
    card.change.fact._tag === "NoKnownHardConstraints"
  ) {
    return "Confirm no known hard constraints for household";
  }
  return "Confirm for household";
};
const profileStatus = (view: PrivateInterviewView) => {
  if (view.profileLoading) {
    return "Loading your current shared profile…";
  }
  if (view.profileUnavailable) {
    return "Your current profile could not be loaded.";
  }
  return "Review against your current shared profile.";
};
const reviewState = (card: ProfileCard, view: PrivateInterviewView) => {
  const current = currentFact(card, view);
  const missing =
    card.change._tag !== "AddConfirmedProfileFact" && current === undefined;
  const stale =
    view.profile !== null &&
    card.expectedProfileVersion !== view.profile.version;
  const busy =
    view.pending !== null ||
    view.pendingConfirmation !== null ||
    view.notice !== null ||
    !view.cardsLoaded ||
    !view.historyLoaded;
  return {
    busy,
    current,
    disabled: busy || view.profile === null,
    missing,
    reviewMismatch:
      view.profile !== null && !matchesCurrentProfileReview(card, view.profile),
    stale,
  };
};
const CardActions = ({
  card,
  client,
  view,
}: {
  readonly card: ProfileCard;
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => {
  const [safetyChecked, setSafetyChecked] = useState(false);
  const { busy, current, disabled, missing, reviewMismatch, stale } =
    reviewState(card, view);
  const safety = card.change._tag === "ConfirmHardConstraintReduction";
  const confirmDisabled =
    disabled ||
    stale ||
    missing ||
    reviewMismatch ||
    card.status !== "proposed";
  return (
    <>
      {(stale || card.status === "conflict") && (
        <Alert>
          <p>
            Your shared profile changed or this proposal could not be applied.
            Refresh the current facts, review them, and save a revised proposal
            before confirming again.
          </p>
        </Alert>
      )}
      {reviewMismatch && !missing && (
        <Alert>
          <p>
            This proposal’s saved review does not match the current shared fact.
            Review the current fact and save a revised proposal before
            confirming.
          </p>
        </Alert>
      )}
      {view.profile !== null && missing && (
        <p>The referenced fact is unavailable. You can reject this proposal.</p>
      )}
      <p>
        Confirming makes this change visible to your household as your own
        confirmed food information.
      </p>
      {safety && (
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={safetyChecked}
            disabled={confirmDisabled}
            onChange={(event) => setSafetyChecked(event.target.checked)}
          />
          I confirm this safety constraint change
        </label>
      )}
      <div className="private-session-actions">
        <Button
          disabled={confirmDisabled || (safety && !safetyChecked)}
          onClick={() =>
            client.confirmCard(
              card,
              safety ? "I confirm this safety constraint change" : null
            )
          }
        >
          {confirmationLabel(card)}
        </Button>
        <Button disabled={busy} onClick={() => client.rejectCard(card)}>
          Reject proposal
        </Button>
      </div>
      {!missing && (
        <details>
          <summary>Review or correct proposal</summary>
          <PrivateCardCorrection
            card={card}
            current={current}
            disabled={disabled}
            key={`${card.revision}:${view.profile?.version ?? "loading"}`}
            revise={(change) => client.reviseCard(card, change)}
          />
        </details>
      )}
    </>
  );
};
const CardReview = ({
  card,
  client,
  view,
}: {
  readonly card: ProfileCard;
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => {
  const current = currentFact(card, view);
  const editable =
    (card.status === "proposed" || card.status === "conflict") &&
    view.sessionState?.status === "open";
  return (
    <li className="private-profile-card">
      <div className="review-heading">
        <h4>Proposal {card.ordinal}</h4>
        <Badge>{statusLabels[card.status]}</Badge>
      </div>
      <p className="helper">Revision {card.revision}</p>
      <dl className="private-profile-meanings">
        <dt>Current shared fact</dt>
        <dd>
          <BeforeMeaning card={card} current={current} view={view} />
        </dd>
        <dt>Proposed change</dt>
        <dd>{afterMeaning(card, current)}</dd>
      </dl>
      {card.status === "confirmed" && (
        <p>
          This confirmation was saved to your household profile. Your private
          messages stay private.
        </p>
      )}
      {card.status === "rejected" && (
        <p>
          This proposal was rejected without changing your household profile.
        </p>
      )}
      {editable && <CardActions card={card} client={client} view={view} />}
    </li>
  );
};

export const PrivateProfileCards = ({
  client,
  view,
}: {
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => (
  <section
    aria-labelledby="private-profile-cards-title"
    className="private-profile-cards"
  >
    <h3 id="private-profile-cards-title">Profile proposals</h3>
    <p>
      Proposals stay private until you explicitly confirm a change for your
      household.
    </p>
    {view.pendingConfirmation !== null && (
      <Alert>
        <p role="status">
          A confirmation is pending. Its outcome is not known yet. Other changes
          and session completion are paused until it settles.
        </p>
        {view.confirmationStatus === "retry_required" ? (
          <>
            <p>Reconnect before checking the same confirmation again.</p>
            <Button onClick={client.reconnectSession}>
              Reconnect to check confirmation
            </Button>
          </>
        ) : (
          <Button
            disabled={
              view.confirmationStatus === "sending" ||
              view.sessionState === null
            }
            onClick={() => {
              void client.checkConfirmation();
            }}
          >
            {view.confirmationStatus === "sending"
              ? "Checking confirmation…"
              : "Check confirmation"}
          </Button>
        )}
      </Alert>
    )}
    {!view.cardsLoaded && <p role="status">Loading private proposals…</p>}
    {view.cardsLoaded && view.cards.length === 0 && (
      <p>
        No profile proposals yet. Automatic proposals are not available yet.
      </p>
    )}
    {view.cards.length > 0 && (
      <>
        <div className="private-session-actions">
          <p>{profileStatus(view)}</p>
          <Button
            disabled={view.profileLoading}
            onClick={() => {
              void client.refreshProfile();
            }}
          >
            Refresh current profile
          </Button>
        </div>
        <ol
          aria-label="Private profile proposals"
          className="private-profile-card-list"
        >
          {view.cards.map((card) => (
            <CardReview
              card={card}
              client={client}
              view={view}
              key={`${card.id}:${card.revision}`}
            />
          ))}
        </ol>
      </>
    )}
    {view.moreCards && (
      <Button onClick={client.loadCards}>Load more proposals</Button>
    )}
  </section>
);
