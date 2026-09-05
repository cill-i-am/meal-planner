# Work Item — <Outcome>

- Status: Proposed
- Owner: <person or delivery owner>
- Stage / pull request: <links when they exist>

## Outcome and scope

Describe the person affected, the problem removed, and the observable result. Name exclusions only where they prevent a likely misunderstanding.

## Accepted direction

Link the product decisions, architecture, or blueprint sections that constrain this work. Define any new commands, states, invariants, permissions, or visible failures needed to make the outcome unambiguous.

Include authority, privacy, transaction, replay, concurrency, retention, and recovery requirements only where this work affects them. Identify the actual external effects and the authorization they require. Do not turn every category into a new implementation requirement.

## Acceptance evidence

List concrete scenarios and the evidence that will prove them. Use the real runtime or persistence seam when that is the changed contract. Include relevant authorization, isolation, replay, and failure cases for work that changes those behaviours. Choose required checks for this scope; use the [execution policy](../agents/execution-policy.md) for review and merge authority.

- <scenario and expected result>
- <verification method>

## Implementation constraints

Record constraints that help implementation without freezing a file layout or unnecessary abstraction. Capture consequential durable choices in the appropriate decision record.

## Delivery record

Record meaningful status changes, verification results, the reviewed head and findings, remaining gates, and the merge commit when applicable. Omit sections that add no useful information to the work item.
