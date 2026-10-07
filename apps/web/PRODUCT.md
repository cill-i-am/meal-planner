# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web, designed for both desktop and mobile.

## Stack

The code and `package.json` own implementation details. Follow [web instructions](AGENTS.md) when implementing an interface.

## Users

Adults trying to feed a whole family with less deciding, coordinating, cooking, and shopping. People have different tastes, schedules, portions, and dietary needs. The first release serves a small, supported, invite-only household beta in Ireland.

## Product Purpose

Meal Planner is an AI-native household food service. It learns how a family eats and lives, recommends a practical personalised week, and turns the approved plan into a combined shopping list. Optional supermarket ordering comes later.

Success means less active planning time, fewer corrections over successive weeks, and a family returning because the service remembers what works. [Beta criteria](../../docs/decisions/pdr-0015-invite-only-beta-cohort-and-learning-cadence.md) are targets, not demonstrated results.

## Positioning

The primary interface is a conversation with an attentive professional. The service understands what someone wants to achieve, asks the next useful question, and makes a concrete suggestion. It uses what it already knows and explains important assumptions in ordinary language.

Questions, choices, and editable interfaces appear within the conversation when they help. A meal, a recipe, or the emerging week can become the focus of the screen. The interface updates as the conversation changes it, keeping useful work visible and easy to revisit. Typing and direct manipulation are equally valid ways to make a correction.

Household profiles, versioned facts, and validation are implementation mechanisms. Their existence does not require matching screens, a setup checklist, or a fixed interview sequence. Ask for missing information when it affects the result. Confirm consequential changes in their context.

## Operating Context

Use spans planning at a desk, checking dinner on a phone, cooking, and shopping. Work, school, childcare, packed lunches, eating out, and changing preparation time are ordinary inputs.

These illustrative exchanges describe intended behaviour, not finished screens or a fixed script:

- **“Tuesday is chaos.”** Use known routines to propose a low-effort dinner. If timing is unknown, ask one useful question. Show the proposed change beside its effect on preparation and shopping. Ask whether it applies this week or should become a recurring preference when that distinction matters.
- **“Can we make this?”** Turn a supported recipe source into an editable recipe in the conversation. Show missing information honestly and ask only for what is needed to save or use it. Explain acquisition failures and offer a useful next step.
- **“That week looks good.”** Make clear which week and changes are being approved. Preserve that approved version. Later changes produce a visible proposal, with shopping consequences explained before another commitment.

Someone can correct a misunderstanding, skip a nonessential question, pause, resume, or revisit an earlier result. One adult can provide provisional information and start planning before other adults complete their own reviews. Shared meals, simple alternatives, leftovers, packaged food, meals elsewhere, and intentional skips can all reduce work. Ordinary use requires no daily meal confirmation.

## Capabilities and Constraints

### Implementation and scope

The [feature map](../../docs/reference/features/README.md) links implemented behaviour to code and tests. [Remaining work](../../docs/plans/README.md) separates unfinished capabilities, evaluation, and release checks. These records do not prove deployment or beta readiness.

The intended product covers household learning, routines, food content, a feasible personalised week, explicit approval, retailer-neutral shopping, and optional weekly learning. Clinical nutrition, calories and macros, inferred pantry tracking, food-safety certification, dependant accounts, public recipe marketplaces, external calendar integration in the first vertical, and general organisation management are excluded. Retailer fulfilment and purchase are outside the initial beta.

### Durable boundaries

- AI proposes; application code validates and commits. Hard dietary constraints remain outside model discretion.
- Private adult conversations stay private. Only explicitly confirmed household-visible information informs shared planning and explanations. Adults can manage dependant profiles; other adults can join later without losing their existing person or history.
- Adults can edit household profiles and approve plans, with attribution. Hard constraints are never silently removed. Approved plans remain stable until a revision is explicitly approved.
- One household authority owns shared product state. Presentation choices do not create another source of truth.
- Recipe facts retain evidence and explicit unknowns. Missing quantities, yield, timing, or nutrition are not invented.
- Retailer adapters consume approved retailer-neutral demand. Basket creation, checkout, payment, and other external mutations need explicit approval.

## Brand Commitments

Use **family** in customer-facing copy. Be perceptive, practical, and direct. Explain a question or trade-off when it helps someone decide. Avoid database terminology and medical or therapeutic claims. The [design reference](DESIGN.md) owns visual direction.

## Evidence on Hand

This brief owns product intent. Consult [decision records](../../docs/decisions/README.md) for the reason behind a specific boundary and [engineering references](../../docs/README.md) when implementing it. Those contracts define guarantees, not mandatory screens or conversation order. Synthetic examples are not testimonials or measured results; private transcripts are not promotional material.

## Product Principles

Save household effort, account for everyone, and make useful progress visible. Offer one understandable recommended week with focused alternatives where needed. Keep drafts editable, changes explainable, and weekly feedback optional.

## Accessibility & Inclusion

Support keyboard operation, visible focus, named fields and status announcements, 44px interaction targets, text enlargement, responsive layouts, and reduced motion. Preserve these requirements when generated interfaces appear or update.
