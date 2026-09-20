# Library consolidation

Each outcome below owns one proposed scope and acceptance list. Start with the
actual implementation, not an old planning snapshot. A merged plan is not a
completed dependency. Original proposals #219–#225 remain open and untouched;
these records reconcile their overlapping scope and link immutable provenance.

1. [One browser Effect runtime](01-browser-runtime.md) supplies the shared lifecycle.
2. [Remaining private-client state](02-private-client.md) reuses that delivered pattern.
   TanStack/base Agent adoption already landed in #218; do not repeat it.
3. [Form validation and JSON equality](03-forms-and-json.md) can proceed independently
   where file ownership permits; equality adoption is conditional on equivalence.
4. [Optional dependency-guard assessment](04-architecture-guard.md) must prove a net
   reduction or explicitly retain the current guard. It does not block browser work.

Coordinate shared profile schemas, submission adapters, manifests and lockfile.
No LiveStore rollout, product-model replacement, provider evaluation, persistence
migration, cloud operation or deployment is included simply by accepting this index.

After this consolidation is accepted, the old overlapping planning PRs can be
superseded deliberately. They are not automatically closed or merged by this change.
