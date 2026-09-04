# Work Item — Seven-pass codebase cleanup

- Status: Verifying
- Stage: Explicit repository-wide maintenance request, 2026-09-04
- Owner: Codex integration owner with bounded implementation agents
- Pull request: `codex/seven-pass-cleanup` against `main`
- Completed by: Not merged

## Household Outcome

Derived audio and frame artifacts can pass the real media boundary. Recipe
confirmation displays the saved recipe, and planning consumes the household's
approved Recipe Bank through one selection path. The implementation removes
unused experimental paths, duplicate contracts, forwarding layers, and tests
that assert source spelling instead of behavior.

## Accepted Direction

This work follows the repository's greenfield policy, the
[household domain boundary](../architecture/household-domain.md),
[recipe import authority](../architecture/recipe-import-intent.md), and current
[product and architecture decisions](../decisions/README.md). It preserves the
account linking, invitation, and departure work merged in PR #201.

## Scope and Disposition

The user authorized all findings from the seven-pass audit and requested a PR.
The numbered dispositions below correspond to that audit.

| Finding | Implemented direction |
| --- | --- |
| 1 | Decode original/audio/frame artifact identities, check their acquisition owner, and forward the complete ID. |
| 2 | Preserve endpoint-specific browser response types and exercise actual saved-recipe confirmation. |
| 3 | Select once from the local Recipe Bank; remove supplied-recipe RPCs and synthetic authority values. |
| 4–5 | Remove historical source/comment/migration-inventory locks and redundant architecture scans; keep boundary enforcement. |
| 6 | Delete unconsumed projections, fake extractors, obsolete pilot modules, and identity-only tests. |
| 7 | Require metadata that every successful producer supplies. |
| 8 | Decode speech JSON once, then walk its bounded structure. |
| 9 | Persist conservative settlement directly, with atomic evidence, budget, and replay writes. |
| 10 | Reuse the admitted recovery authority result. |
| 11–12 | Inline one-caller workflow sequences and remove an unreachable checkpoint variant. |
| 13–16 | Simplify admitted routing and tagged handlers, allocate from canonical acquisition claims, and use native RPC in fixtures. |
| 17 | Share recipe planning schemas in one small domain package and reuse canonical current-result schemas. |
| 18–19 | Remove redundant internal validation and decode JSON at actual ingress. |
| 20 | Remove the unused second column/rail and verify desktop and narrow layouts. |
| 21–24 | Remove forwarding functions, aliases, unused services, repeated projections, and prop plumbing; derive form options from schemas. |
| 25 | Share byte hashing and native Worker fixture bundling. |
| 26–27 | Remove vacuous assertions; strengthen actual concurrency, privacy, and provider completion proof. |
| 28 | Remove unused class-variance-authority and unnecessary tailwind-merge. |
| 29 | Consolidate lint-rule provenance scans and remove stale override entries. |
| 30 | Update application docs, condense completed migration narrative, and delete obsolete operator runbooks. |

The unwired pilot subsystem and its manual runbooks are removed: no current
accepted delivery scope requires that experimental entrypoint. The unconstructed
visual uncertainty variant is removed; actual provider `outcome_unknown` fencing
and existing storage-error behavior remain. Supported provider envelope variants,
RPC serialization boundaries, and required Alchemy package patches remain.

No new product feature, cloud deployment, live provider request, retailer action,
or production data migration is included.

## Authority, Failure, and Replay

Household SQLite remains the sole product writer; Better Auth proves membership
before private routing. Planning reads approved local recipes and persists their
real review versions and fingerprints. Media artifact reads reject other owners,
generations, and malformed variant suffixes. Completed evidence carries the
metadata required for replay rather than inventing missing-data branches.

Provider accounting remains independent of household recovery. Conservative
settlement writes audit/replay evidence and the dispatch/budget transition in one
D1 transaction. Missing evidence or a failed replay write must leave the invocation
and budget unchanged. Unknown provider outcomes remain fenced against redispatch.
No external I/O is introduced inside household transactions.

## Acceptance Evidence

- [ ] All repository type, build, test, lint, and format checks pass.
- [x] Media client → installed Alchemy Durable Object bridge → artifact registry
      proves original, audio, and frame reads plus foreign-owner rejection.
- [x] Native household tests preserve isolation, restart, replay, collisions,
      generation fences, and planning from approved recipes.
- [x] Native accounting proves conservative settlement, evidence requirements,
      rollback, and retry.
- [x] Desktop/narrow browser checks cover review, validation, and saved recipe.
- [ ] Container extraction checks pass, or an explicit environmental limit is recorded.
- [ ] Independent review of the immutable PR head has no unresolved findings.

## Delivery Log

- Started from freshly fetched `origin/main` at
  `9a59f85170f379e065920eadaaf69593d90c2c40` in an isolated worktree on
  `codex/seven-pass-cleanup`. Original checkout changes were preserved.
- Installed the declared lockfile. Fresh-base TypeScript checks passed;
  baseline root tests passed (12 files, 138 tests), and web tests passed
  (12 files, 85 tests).
- Final integrated `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm build`,
  `pnpm exec ultracite doctor`, and `git diff --cached --check` passed. The full
  `pnpm test` and local `pnpm test:container` runs were active at commit time;
  their final outcomes and exact-head review are recorded on the PR.
- Focused import suites: 38 files / 498 tests passed; native acquisition restart
  passed. Provider suites: 140 tests, native accounting 27 tests, and native
  Workflow 17 tests passed, including conservative-settlement rollback and retry.
- Media suites: 25 focused tests and 16 native R2 tests passed. The installed
  Durable Object bridge covers original/audio/three frame variants and rejects
  foreign owners, generations, and invalid suffixes.
- Household suites: 71 focused tests and all 49 native boundary tests passed.
  Stored timestamps decode once. A separate native RPC probe proved the
  non-enumerable `Symbol.dispose` transport property, so fixture materialization
  remains at that actual boundary while custom error envelopes are removed.
- Web tests: 85 passed; household contracts: 22 passed; import contracts: 31 passed.
  Chrome at 1440×1000 and 375×812 exercised review edits, validation, confirmation,
  and the saved-recipe result with local HTTP fixtures. The narrow layout has no
  horizontal overflow. Screenshots are attached to the PR. This proves browser
  behavior; it does not claim live authentication or provider execution.
