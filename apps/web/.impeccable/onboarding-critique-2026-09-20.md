# Onboarding design critique — 20 September 2026

Historical review of the pre-refinement design. The findings below were addressed or superseded by the user's decisions recorded in [design decisions and checks](experiments/compact-themed-shadcn.md). [DESIGN.md](../DESIGN.md) describes the resulting baseline. Keep the original measurements and recommendations as review evidence, not instructions for the final design.

The user later clarified that the sky mentioned in this review is desktop presentation wallpaper, not application UI. All mobile sky strips were removed.

Target: [Paper onboarding](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0), including Auth, Household, People, Invitations and Recovery, desktop and mobile.

Method: independent Impeccable assessments by `/root/impeccable_design_review` (A: design) and `/root/impeccable_evidence_review` (B: measurements, detector attempt and shadcn alignment). A completed before B findings entered synthesis. Parent also inspected representative screenshots. No designs or application behavior were changed. Recommendations below await the next design decision.

## Verdict and audience fit

The direction is coherent and suitable for household adults, but routine setup is over-presented. Repeated display headings, introductory paragraphs and footer slogans make simple tasks feel longer. The 16px input text is appropriate; reducing it would target the wrong thing.

PRODUCT.md and PDR-0015 establish Ireland-first households with varied routines, preferences, dependants and planning burdens, rather than a specific age or gender demographic. Prioritize interrupted phone use, varying digital confidence and adults joining someone else's household. These are design judgments, not findings from participant testing.

The centered forms, black primary actions, sky frame and lilac treatment are coherent. Keep that approved direction. Household rosters, explicit invitation actions and the privacy handoff provide product specificity; the repeated slogans are interchangeable with unrelated services. Extra illustration would not resolve the usability issues.

## Measured scale and recommended refinement

| Element | Current Paper | Recommendation |
| --- | --- | --- |
| Desktop heading | 48px / 52px | 36–40px on routine tasks; reserve larger treatment for welcome/completion |
| Mobile heading | 32px / 36px | 28–30px on routine tasks, with shorter wording |
| Body and input text | 16px / 24px | Keep |
| Labels and errors | 14px / 20px | Keep |
| Helper/footer text | Usually 13px / 20px | Use 14px for necessary instructions; remove redundant footer copy |
| Inputs | 52px high, 12px radius | 48px is a sensible compact variant |
| Primary actions | 48px high, pill radius | Keep |
| Form width | 432px desktop; 342px within 390px mobile | Keep |
| Group gaps | 24px desktop; 20px mobile | Keep real field groups; remove redundant gaps between already-padded roster rows |

## Priority findings

### P1 — Define accessible control boundaries and interaction states

Normal fields use #F4F4F6 against white without a border, approximately 1.10:1. The selected white person-type segment has the same weak distinction from its track. Strengthen the field boundary and selected indicator. W3C's non-text contrast guidance discusses 3:1 for input boundaries identified only by their background.

No keyboard focus treatment is represented in the Paper specification. The selected segment is 40px high; Show, Edit and header links lack explicit 44px hit areas. Specify focus-visible, hover, pressed, disabled, loading and invalid states, and provide generous hit areas without enlarging all visible labels. These are static design/specification gaps, not claims that a running UI failed accessibility testing.

Suggested commands: `$impeccable harden`, `$impeccable extract`.

### P1 — Clarify people categories without inventing age

The form offers Adult / Dependant and explains the latter as a child or someone whose profile you manage. Review then labels Maya Child without collecting child status or age. An adult with a managed profile can interpret both choices as applicable.

Use action-oriented choices such as Invite an adult / Manage their profile, with short explanations, subject to confirming their fit with the adult/dependant domain contract. Use Managed profile in the roster unless child status is actually collected. This does not justify adding DOB. Retain automatic invitation within Add and invite.

Suggested command: `$impeccable clarify`.

### P1 — Give blocked users a useful recovery path and retain identity context

The reset-disabled design sends someone who forgot their password back to try the password again. A supported beta needs a confirmed help/recovery route; do not invent a destination or imply recovery delivery exists. The wrong-account state should retain the current signed-in email. The partial-invitation state should display the entered destination email before Finish invitation. Do not expose another recipient's identity from an untrusted invitation link.

Keep the original mutation/reconciliation behavior: improve clarity without replacing an ambiguous operation with another create/send command. Explain failures directly, for example We couldn't load your household instead of Your household needs a moment.

Suggested command: `$impeccable harden`.

### P2 — Remove repeated ceremony and unnecessary copy

| Current treatment | Recommended change |
| --- | --- |
| Your household. Your preferences. Your say. | Delete the recurring footer |
| Let's start with your home. | Name your household |
| Who else is at your table? | Add someone |
| Add one person at a time. You can change this later. | Remove the obvious first sentence; retain edit reassurance only where useful |
| Everyone in one place. / Check your household before we get to know you. | Check your household / Check everyone is included |
| Adults receive an invitation when you add them, on review | Remove here; explain before sending and show status in the roster |
| Switch account repeated in invitation header and body | Keep one contextual action beside the current identity |
| Duplicate login/signup/back routes | Keep one clear route beside the relevant task |
| Start my food review | Tell us how you eat, or another clear label matching the private conversation |
| Just you for now? | You're ready to continue |

Keep copy that changes a decision: why an invitation will be sent, who manages a profile, password requirements, privacy boundaries and actionable errors. Use the smaller routine-heading scale above while keeping 16px input text and comfortable main targets.

Suggested commands: `$impeccable distill`, `$impeccable typeset`, `$impeccable layout`.

### P2 — Make the token system a usable shadcn theme

The measured sizes, Inter typeface, 12px inputs and pill buttons are valid shadcn customization. Matching default appearance is unnecessary. Semantic roles and consistent component states matter more.

Only 9 of 20 Paper tokens are referenced. All defined font sizes, weights, tracking, leading, breakpoint, container and spacing tokens have zero references. Focused searches found 56 literal 12px nodes versus 8 field-radius bindings, and 40 literal 999px nodes versus 14 pill-radius bindings. Many text nodes use #000000 while the ink token is #111114; heading gray #73737B is separate from muted text #65656F. Either name intentional roles or consolidate these values.

| Paper role | shadcn mapping |
| --- | --- |
| surface | background; separate foreground pairings for buttons |
| ink | foreground / primary, with explicit primary-foreground |
| muted text | muted-foreground, not muted |
| field fill | supporting surface such as muted; input remains a separately selected boundary role |
| rule | border for separators; do not assume sufficient contrast for an input boundary |
| error text and border | destructive, plus an explicit border role if the difference is intentional |
| focus | ring |
| selected, disabled, hover, pressed | component state definitions using appropriate semantic roles |

Bind repeated dimensions and typography. Define responsive heading sizes and component variants. The existing Field/TanStack/Effect validation contract already aligns with shadcn and should be retained. Existing prototype wrappers and cream/green CSS are not an implementation of these new designs.

Suggested commands: `$impeccable extract`, `$impeccable document`.

## Design health

Scores are design heuristics, not implementation verification or participant research. The final consistency score includes the independent token/state evidence.

| Heuristic | Score / 4 | Main reason |
| --- | --- | --- |
| System status | 3 | Progress, pending and uncertain outcomes are represented |
| Real-world language | 2 | Person categories and food review require interpretation |
| User control | 3 | Back, cancel, defer and decline are visible |
| Consistency | 2 | Terminology, token binding and interaction specifications drift |
| Error prevention | 3 | Explicit invitation action and field validation are designed |
| Recognition | 3 | Useful roster; some recovery identity is missing |
| Efficiency | 2 | Repetition and excess introductory space slow scanning |
| Minimalism | 3 | Calm layout with avoidable copy |
| Error recovery | 2 | Reset-disabled dead end and missing context |
| Help | 3 | Useful explanations; blocked users need a real support route |
| Total | 26 / 40 | Promising direction; targeted refinement needed |

## Strengths, cognitive load and personas

The narrow form and black primary action give a clear reading path. Editable rosters and neutral invitation status are useful. Privacy information before discovery, inline error placement and mutation-aware recovery are worth preserving. Error text contrast measures about 7.81:1, muted text 5.76:1 and links 6.06:1 against white.

Cognitive load is moderate: three weaknesses concern hierarchy, redundant disclosure and identity recall. There is no evidence of a genuine decision menu with more than four alternatives. The opening is welcoming; repeated presentation makes the middle feel ceremonial; completion's privacy explanation is useful but food review makes the next action sound evaluative.

- Interrupted mobile planner: a long introduction pushes the adult form and roster down; partial-invitation recovery omits the destination email.
- Invited adult or first-time organiser: overlapping categories and Child appearing without that input can undermine confidence.
- Adult relying on readable text or larger targets: preserve 16px input text and 48px main actions; specify focus and secondary hit areas.

## Evidence and limits

Paper token hash: c84815a2. Assessment A inspected all 18 main screens and 11 representative states. B independently checked tokens, styles, JSX and representative screenshots in all five features. Both used fresh hidden browser tabs to inspect the Paper canvas and closed them. No overlay was injected; the Paper editor DOM is not the product implementation.

The CLI detector was genuinely attempted on exported JSX but returned exit 127: engine 0.1.5 was absent and its default cache unwritable. Finding counts are unavailable, not zero. The storage slug command failed for the same reason; this is a manually saved review record, with no helper snapshot or trend. Both ignore lists were absent. No live server started; B removed its two temporary JSX files. No design or application edits were made.

References: [shadcn theming](https://ui.shadcn.com/docs/theming), [Button](https://ui.shadcn.com/docs/components/base/button), [Field](https://ui.shadcn.com/docs/components/base/field), [Input](https://ui.shadcn.com/docs/components/base/input), [TanStack Form](https://ui.shadcn.com/docs/forms/tanstack-form), [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), local PRODUCT.md, PDR-0015 and onboarding-error-contract.md.

## Decisions for the next pass

1. Scope: all five findings, or copy and sizing first?
2. Hierarchy: compact routine screens with larger welcome/completion moments, or compact headings throughout?

The existing implementation-gap ledger remains open; this critique does not approve application coding.
