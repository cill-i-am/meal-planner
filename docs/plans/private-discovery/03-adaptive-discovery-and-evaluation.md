# Work Item 03 — Adaptive discovery and evaluation

Status: active
Owner: unassigned — remaining evaluation and tone work
- Implementation: merged on 2026-09-19 in [PR #218](https://github.com/cill-i-am/meal-planner/pull/218), commit `04e97e8389e531bd2bc4af46945f2ed349674d12`.
- Evaluation: broader model-quality evaluation and human ratings remain unfinished. The product owner explicitly deferred these gates to follow-up work when approving the implementation merge; no scores or quality acceptance were inferred.
- Owning stage: [Stage 2 — Private discovery and repeat profile review](README.md).
- Current contract: [Application-owned discovery coverage](../../reference/discovery-coverage.md).
- Runtime decision: [ADR-0004](../../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md#base-agent-and-tanstack-chat--accepted-2026-09-13).

## Outcome and scope

Adults receive private profile proposals and follow-up questions selected by the
application. They can correct, reject, and explicitly confirm proposals, complete
the session, and read saved history. The model cannot confirm facts or write
household data. A new session receives the adult's current profile and its own
conversation, not transcripts from earlier sessions.

The application decides required topics, question wording, clarification, which
proposal revision is being changed, safety handling, and which changes to save
atomically. Cloudflare's base Agent manages durable lifetime. Published TanStack
packages manage orchestration, chat events, and client history. The three
TanStack patches and custom binding wrapper have been removed.

The application still owns access checks, the check immediately before physical
send, and explicit household confirmation. The linked contract describes these
rules, typed fallback discovery, and cancellation.

## Current evaluation status

The final implementation head `9f4ed3d84b544d929e28b4fb6d9587449cfcce3d`
passed independent review and the recorded
[live Kimi opening](../../../evals/private-discovery/kimi-published-sdk-opening-results.md).
Exactly one application turn succeeded in 31.818 seconds, proposed a tomato
preference and rendered the required allergy question. Explicit UI confirmation
advanced the synthetic household profile from version 0 to 1; the confirmed card
persisted after reload. All 978 tracked source files matched before and after the
recording. This proves one live opening and confirmation flow, not sustained
interview quality or a complete evaluation family.

The PR head `8e1fe9f56b2358af349966de7664b99f924e1e5f` adds documentation to
that reviewed code. Both [hosted CI jobs](https://github.com/cill-i-am/meal-planner/actions/runs/35439217035)
passed. Local provider, frontend and native tests cover schema/coverage,
authorization, persistence, replay and confirmation. Two lifecycle regressions
specifically prove that empty streams reject before persistence success, and
that deadlines settle the application and release resources while a provider is
still pending; a valid late response cannot commit.

The SDK may make three provider attempts per logical turn. The
[accounting policy](../../../evals/private-discovery/provider-accounting-policy.json)
reserves all three and retains the full reservation when usage is unknown. The
live report retains the conservative exposure checkpoint. Neither stopping a
turn nor closing the local runtime proves that upstream work stopped.

Provider configuration remains disabled by default. This delivery did not deploy
the application or accept a production model configuration.

## Remaining work

- Complete the eight-family adult-discovery evaluation, candidate comparison,
  live A-to-B profile-change review and suite-wide fixed-judge evidence using the
  [evaluation assets and procedure](../../../evals/private-discovery/README.md).
- Obtain all sixteen actual product-owner ratings for the two applicable
  dimensions across eight families. The blank calibration template remains
  unscored; model scores cannot replace human ratings. Stage completion and the
  external-beta gate remain governed by
  [PDR-0006](../../decisions/pdr-0006-ai-evaluation-and-release-evidence.md).
- Improve conversation tone as described below.
- For a future failed live run, retain bounded sanitized provider error-code and
  origin metadata where supported, so the cause can be investigated without
  retaining private prompts or raw provider payloads.
- Broader repeat-review UX, dependant assistance and cumulative Stage 2 exit
  remain with Work Items 04–05. Routine, planning, repair, learning and shopping
  obligations belong to their later stages and remain not exercised here.

### Warmer conversation

The product owner liked the earlier dependant-and-fallback example but found its
wording robotic and asked for more empathy. This was feedback, not a numerical
human rating. Improve acknowledgements, follow-up questions, and review
invitations so they respond to the person's circumstances and practical effort.
Use warm, plain language without stock sympathy, invented feelings, excessive
reassurance, repeated administrative wording, or unnecessary questions. Some
wording comes from the application, so prompt changes alone cannot fix it.

Preserve attribution, uncertainty, privacy and explicit confirmation. Warmth must
not imply that a proposal is already saved. Review representative conversations
with the product owner after the changes.

## Historical evidence

The [evaluation records](https://github.com/cill-i-am/meal-planner/tree/04e97e8389e531bd2bc4af46945f2ed349674d12/evals/private-discovery)
and [work-item diary](https://github.com/cill-i-am/meal-planner/blob/04e97e8389e531bd2bc4af46945f2ed349674d12/docs/delivery/stages/02-private-discovery/03-adaptive-discovery-and-evaluation.md)
remain available at merge `04e97e8`. The evaluation README keeps their findings
and limits. Removing duplicate reports does not turn a failed run into a pass,
resolve unknown provider usage, or release reserved budget.