# Autonomous delivery and codebase gardening

Status: active
Progress: operating model agreed; source audit complete; installation pending
Owner: Codex, with Cillian owning product direction
Decision date: 2026-10-04
Delivery: persist the agreement, audit obstacles, then present the adoption changes

## Agreed operating model

Cillian wants to work at the level of domains, their responsibilities, and their
interactions. Agree the intended outcome, architectural direction, important
trade-offs, and verification criteria together. After that agreement, the agent
owns implementation and delivery through merge: TDD, independent reviews,
verification, fixing findings, PR creation, CI monitoring, conflict resolution,
and merging when the required checks and reviews pass. Routine implementation
decisions and repeated review rounds do not require another human prompt.

Return to Cillian when evidence requires a material change to the agreed product
direction or domain responsibilities, or when a real blocker cannot be resolved.
The approved scope does not cover unrelated external actions. Existing deployment
authorization and the repository's delivery pipeline remain relevant to the
requested endpoint.

Pstack is the execution workflow. Matt Pocock's skills support design, learning,
review, and improvement. This is an intentional combination, not a claim to run
either upstream system unchanged.

## Skill responsibilities

| Responsibility | Selected method |
| --- | --- |
| Challenge and agree direction | Matt's `grill-me`, `grill-with-docs`, and shared `grilling` |
| Domain language, ownership, and decisions | Matt's `domain-modeling`, using this repo's canonical references and decision register |
| Module depth and interfaces | Matt's `codebase-design`, including deletion tests and alternative interface designs |
| Find gardening candidates | Matt's `improve-codebase-architecture` |
| Resolve uncertain design behavior | Matt's `prototype` and pstack's executable design exploration |
| Capture approved work | Matt's `to-spec` and `to-tickets`, configured for repository-based planning |
| Build, verify, review, and merge | Pstack's implementation, review, verification, babysit, and shipping workflows |
| Review standards and intended behavior separately | Matt's `code-review`, coordinated within automated review |
| Improve the agent environment | Matt's `retro` and `writing-for-agents`, with pstack's structural correction methods |
| Learn a topic over time | Matt's `teach` |
| Understand a particular change or subsystem | Pstack's `teach`, `how`, and `why` |
| Present a PR | Matt's `pr` and relevant observed evidence |
| Re-explain an unclear answer | Matt's `wait-what` |
| Hard bugs or large unresolved projects | Matt's `diagnosing-bugs` and `wayfinder`, when the task warrants them |

Include `setup-matt-pocock-skills` and referenced resources so the selected skills
can operate. Resolve duplicate names such as `teach` and `tdd` explicitly. Choose
model roles from the models and reasoning efforts actually available on the host.
Pstack's babysit workflow ends at merge-ready; the approved delivery workflow must
continue into shipping without another request to merge.

## Gardening and explanations

Move quickly while keeping behavior, access, persistence, and data-safety
guarantees. Accept limited implementation debt and remove it deliberately through
regular gardening: dead code, unnecessary forwarding modules, duplicate paths,
shallow interfaces, stale docs, and recurring mistakes. Within an agreed gardening
scope, agents own the cleanup PRs through review and merge. Changes to domain
meaning or ownership return to the architectural discussion when they exceed the
agreed direction.

Use retrospectives to improve the tools and environment producing the code. Prefer
structural fixes, types, lint rules, and meaningful regression checks for recurring
mistakes; reserve prose rules for decisions that require judgment.

Provide domain-level diagrams, Ben-style interactive walkthroughs, or Psychopomp
videos when Cillian wants to inspect the system. Explain ownership, interactions,
and important state transitions first. These explanations are distinct from
runtime verification evidence. No visual artifact is required for every PR.

The proposed maintenance cadence is cleanup during normal delivery plus a weekly
focused gardener sweep. No recurring automation has been configured by this plan.

## Adoption and current audit

Commit to this workflow for a month once setup works, then keep what works and
discard what does not. The current assignment is to read the repository's docs,
agent rules, existing skills, code and relevant Meal Planner chat history, identify
concrete impediments, and recommend simplifications before changing the workflow.

Audit evidence and coverage are recorded in
[the workflow audit](../research/2026-10-04-agent-workflow-audit.md).

Acceptance for subsequent setup:

- [ ] Selected skills and their dependencies load in the actual Codex host.
- [ ] One workflow owns execution; duplicated skill names route deliberately.
- [ ] Repository guidance agrees on plan approval and autonomous delivery.
- [ ] Verification uses the real supported development and test commands.
- [ ] An agreed change completes implementation, independent review, CI and merge
  without Cillian prompting each phase.
- [ ] A gardener pass ships useful verified improvements without changing the
  agreed domain behavior.
- [ ] On-demand explanations show real domains and their interactions.
- [ ] The month-long adoption has an actual start date after setup is verified.

## Source snapshots reviewed

- [Matt's skills](https://github.com/mattpocock/skills/tree/24fe0ef7737efae15c87225755e9f6f5965e4888), version 1.3.1.
- [Lauren's pstack](https://github.com/cursor/plugins/tree/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/pstack), version 0.15.9.
- [Pstack Codex port](https://github.com/ScriptedAlchemy/pstack-codex/tree/e68a46d430d0427d9a7a7f0fb04f42bc63f62fe9), pinned to upstream 0.15.5.
- [Verification guide](https://x.com/poteto/status/2094457600259842065),
  [design guide](https://x.com/poteto/status/2097732320606507506), and
  [Ben's visual walkthrough](https://x.com/BHolmesDev/status/2106829942206173497).

The Codex port's package and file-coverage validators passed in this chat. That
does not establish installed end-to-end behavior in Meal Planner. No bundle has
been installed or activated by this agreement record.
