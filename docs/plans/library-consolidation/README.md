# Reduce custom library plumbing

Only these assessments remain open. Check current callers before selecting work.

| Plan | Remaining work |
| --- | --- |
| [Private interview state](02-private-client.md) | Assess custom client state while preserving private history, admission, and unresolved commands. TanStack/base Agent adoption in #218 is already implemented. |
| [Forms and JSON](03-forms-and-json.md) | Assess current comparator callers and form behaviour. The two tasks can proceed independently where files do not overlap. |

Shared browser execution already uses generated-client Effects, TanStack Query,
and the stateless `apiEffectQuery` adapter. No AtomHttpApi migration is queued.
The bespoke D1 scanner and replacement assessment were cancelled at Cillian's
request. No replacement scanner or architecture gate is queued; runtime access,
persistence, and migration tests remain.

Coordinate overlapping profile schemas, submission code, manifests, and the
lockfile. LiveStore, provider evaluation, storage migration, and cloud operations
are outside these scopes. [Private discovery](../private-discovery/README.md)
owns model quality and its acceptance.
