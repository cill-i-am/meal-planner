# Documentation standard

Give each requirement, decision and task one home. Link to that page instead of
keeping another version. A brief summary is useful; two separately maintained
specifications or task lists are not.

| Reader's question | Where the answer belongs |
| --- | --- |
| What is this, and where do I start? | Root or local README |
| How can I learn it? | Tutorial with an exercise and a result the reader can check |
| How do I do this task? | How-to guide with prerequisites, steps and checks |
| What are the rules? | Reference with responsibilities, requirements, source and tests |
| How does it work, and why? | Explanation; label anything that is still planned |
| Why did we choose this? | Decision record with options, reasons, costs and approval evidence |
| What will change, and what is left? | Plan with scope, approach, acceptance criteria, status and next action |
| How should an agent work? | Short instructions in AGENTS.md, not a product manual |

Use [Diátaxis](https://diataxis.fr/) for tutorials, how-to guides, reference and
explanation. Plans and decision records are separate kinds of record. Add a page
when someone needs it, not to fill a folder or create four pages for every feature.

## Writing style

Write for someone who understands software but does not know this project yet.
Use the approach in [NBJ Write Clearly](https://github.com/daniel-p-green/nbj-write-clearly):
make the text easier to understand without changing its facts or technical meaning.
Its [source guide](https://developers.google.com/style) provides more detail.

Start with the answer or purpose. Name the person or component doing the work.
Use familiar words, active verbs, short paragraphs and descriptive headings. Put
conditions before the actions they control. Define a necessary technical term
before relying on it. Keep one term for each concept.

For example, write “retry the same saved request after a lost response” rather
than “preserve retained intent across ambiguous outcomes.” Explain the exact
request identity or failure rule where that detail matters.

Keep commands, code, API names, file paths, UI labels and quotations exact.
Preserve numbers, dates, requirements, exceptions and uncertainty: “might” is not
“will,” and “planned” is not “implemented.” Do not remove a security rule or a
useful example to shorten a page. Do not add claims that the source does not support.

Cut repeated conclusions, vague claims, filler and unnecessary process language.
Use numbered steps for a sequence and tables for comparisons. Keep the existing
structure when it helps the reader. Apply these rules to docs, plans, PR titles,
PR descriptions and agent explanations. Do not rewrite clear sentences merely to
make them different.

## Plans and decisions

Use [one plan](../plans/_template.md) for an outcome. A one-pager, design proposal
and implementation plan can be the same document as work develops. Split them only
when they describe independently deliverable work. Start short and add detail for
important risks. A small task can use the request and PR instead.

A plan explains the objective, background, goals and non-goals, approach,
alternatives, risks, checks, delivery and unanswered questions. Follow
[the design-document guide](https://refactoringenglish.com/excerpts/write-an-effective-design-doc/)
when choosing what detail to include.

Each plan keeps its own status and acceptance checklist. The
[plans index](../plans/README.md) sets the order without copying those checklists.
A parent plan links to its children and checks that their combined result works.
Use `proposed`, `ready`, `active`, `blocked`, `done` or `cancelled`. When work is
replaced, link the replacement and explain why.

A ready plan is not an implemented feature. A new request to implement a plan
covers the assigned work across its milestones. It does not cover unrelated
roadmap items. An old note that the plan was written during a planning-only task
does not prevent a later implementation request.

Approved, implemented, merged, deployed and evaluated mean different things.
Leave unmet acceptance items open. If work is deliberately deferred, record the
actual decision and link the follow-up. When work finishes, update the reusable
docs, keep a short result with evidence tied to the tested commit, and remove it
from the active queue. Historical results are not instructions to repeat the work.

Use [the decision register](../decisions/README.md) for important product, privacy,
data-ownership and storage choices, especially those that are costly to reverse.
Routine implementation choices need no decision record. Keep ADR/PDR identifiers,
actual dates, approval evidence and the scope of any replacement. Never invent an
approval. A material change needs a decision that explicitly replaces the old
choice; fixing a fact or link does not.

## Intent and maintenance

A feature's reference page explains its intent: what it is responsible for, what
it must not do, its important guarantees, and where to find the code and tests.
Keep one home for that knowledge even when the feature spans apps and packages.
Explanation teaches the design; decisions record why it was chosen. Do not add a
separate hierarchy of INTENT.md files.

AGENTS.md requires the engineering standards for code work. Moving a standard into
docs does not make it optional. Read the relevant pages, not every page. Keep
PRODUCT.md, DESIGN.md, skill assets and metadata where their tools expect them
unless a replacement has been tested.

Update the page that owns a rule when behavior or acceptance changes. Check links
and the tools that use them. If code and docs disagree, identify and resolve the
specific difference instead of assuming the newer one is correct. Keep historical
claims in the past. Keep credentials, private transcripts and raw private data out
of records. Do not add another permission policy, orchestration process or handoff
ledger.
