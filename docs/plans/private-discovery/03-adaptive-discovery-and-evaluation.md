# Work Item 03 — Adaptive discovery and evaluation

Status: active
Owner: unassigned — remaining evaluation and tone work
- Implementation: merged on 2026-09-19 in [PR #218](https://github.com/cill-i-am/meal-planner/pull/218), commit `04e97e8389e531bd2bc4af46945f2ed349674d12`.
- Evaluation: broader model-quality evaluation and human ratings remain unfinished. The product owner explicitly deferred these gates to follow-up work when approving the implementation merge; no scores or quality acceptance were inferred.
- Owning stage: [Stage 2 — Private discovery and repeat profile review](README.md).
- Current contract: [Application-owned discovery coverage](../../reference/discovery-coverage.md).
- Runtime decision: [ADR-0004](../../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md#base-agent-and-tanstack-chat--accepted-2026-09-13).

## Outcome and scope

An adult receives private profile proposals and application-selected follow-up
questions, with correction, rejection, explicit confirmation, completion and
retained history. The model cannot confirm facts or write household state. A new
session receives the adult's current canonical profile and its own conversation,
without an earlier session's transcript.

The application owns required-topic coverage, question wording, clarification,
proposal revision binding, safety routing and atomic acceptance. Cloudflare's
base Agent owns durable lifetime; published TanStack packages own orchestration,
chat events and client history. The three TanStack patches and custom binding
wrapper are removed. Authorization, final-send fences and explicit household
confirmation remain application-owned. The contract above owns the detailed
rules, including typed fallback discovery and cancellation.

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

The product owner qualitatively accepted the earlier dependant-and-fallback
example, but found the responses robotic and requested more empathy. This was
not a numerical human rating. Improve acknowledgements, follow-up questions and
review invitations to recognize the person's actual circumstances and practical
burden, use warm plain language, and reduce repeated administrative wording.
Avoid stock sympathy, invented feelings, excessive reassurance and unnecessary
questions. Application-rendered wording is part of this work; prompt changes
alone cannot address it.

Preserve attribution, uncertainty, privacy and explicit confirmation. Warmth must
not imply that a proposal is already saved. Review representative conversations
with the product owner after the changes.

## Historical evidence

The pre-cleanup [evaluation records](https://github.com/cill-i-am/meal-planner/tree/04e97e8389e531bd2bc4af46945f2ed349674d12/evals/private-discovery) and
[work-item diary](https://github.com/cill-i-am/meal-planner/blob/04e97e8389e531bd2bc4af46945f2ed349674d12/docs/delivery/stages/02-private-discovery/03-adaptive-discovery-and-evaluation.md)
remain available at merge `04e97e8`. The evaluation README retains the useful
findings and their limits. Historical failures remain failures, unknown provider
outcomes remain unknown, and deleting duplicate reports releases no reservation.
