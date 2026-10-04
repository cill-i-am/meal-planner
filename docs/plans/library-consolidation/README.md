# Reduce custom library plumbing

Each child owns its scope and acceptance. Use the implemented interfaces and
current source when selecting a remaining change.

| Plan | State and next action |
| --- | --- |
| [Shared browser execution](01-browser-runtime.md) | Done with generated-client Effects, TanStack Query and the stateless `apiEffectQuery` adapter. No AtomHttpApi migration is queued. |
| [Private interview state](02-private-client.md) | Proposed. Inspect remaining custom client state against the completed shared adapter; preserve private session history, access and command recovery. The TanStack/base Agent adoption in #218 is already implemented. |
| [Forms and JSON](03-forms-and-json.md) | Proposed. Assess current comparator callers and form behavior; its two tasks can proceed independently where they do not edit the same files. |
| [Dependency-checking assessment](04-architecture-guard.md) | Cancelled. The bespoke scanner was removed. |

Coordinate overlapping profile schemas, submission code, package manifests and
the lockfile. LiveStore, product changes, provider evaluation, storage migration
and cloud operations are outside these consolidation scopes. Discovery quality
and external-beta acceptance remain with the [private-discovery plans](../private-discovery/README.md).

The September planning proposals are linked from their children for history.
Their old stacked-PR sequence is complete and is not a delivery instruction.
