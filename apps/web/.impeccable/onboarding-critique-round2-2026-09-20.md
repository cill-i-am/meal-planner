# Family onboarding critique — round 2

Historical review. All five findings were subsequently addressed in Paper and its reference contract; see [the resolution](#resolution-after-user-approval--20-september-2026). The original measurements and scores remain review evidence.

The user later clarified that the sky mentioned in this review is desktop presentation wallpaper, not application UI. All mobile sky strips were removed.

Date: 20 September 2026. Target: [live Paper file](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0), Auth, Family, People, Invitations and Recovery on desktop and mobile, plus the themed component reference. Token hash: `4edac556`.

Method: two fresh isolated agents. `/root/impeccable_round2_design` performed Assessment A; `/root/impeccable_round2_evidence` performed Assessment B and withheld all substantive evidence until A finished. Neither read the previous critique. The parent verified the contradictory helper, partial-invitation recovery, login affordance, recovery inventory and specific theme styles. No design or application changes were made.

## Verdict

Keep the current visual direction and sizing. The approved sky frame, lilac wash, filled fields, blue links, pastel avatars, pill buttons and segmented choice form a coherent interface. Compact routine headings are easier to scan, while welcome and completion retain useful emphasis. Remaining work is concentrated in state correctness, transition coverage and design-to-theme fidelity.

The operational content is sufficiently specific to this product: invited adults, managed profiles, family membership and private food discovery. More branding or food illustration would not inherently improve it. The target audience remains Ireland-first adults dealing with varied family routines, interrupted phone use and differing digital confidence; no age or gender bracket is established.

## Design health — 30/40

These are Assessment A's independent design-artifact scores, not runtime test results or participant research.

| Heuristic | Score / 4 | Reason |
| --- | --- | --- |
| System status | 3 | Progress, pending and partial success are clear; some successful transitions remain unspecified |
| Real-world language | 3 | Family and invitation language is understandable; profile linking is more abstract |
| User control | 2 | Normal paths have exits; several exceptional states lose an explicit pause route |
| Consistency | 3 | Cohesive controls, with a state-copy contradiction and weak link affordance |
| Error prevention | 3 | Add and invite states its effect; recipient identity and password requirements are visible |
| Recognition | 3 | Names, emails and roster states help; exact return destinations need specification |
| Efficiency | 3 | Solo continuation, optional people and deferred discovery work |
| Minimalism | 4 | Focused tasks and restrained hierarchy on both device classes |
| Error recovery | 3 | Useful messages and preserved values; password recovery lacks its full successful path |
| Help | 3 | Short contextual explanations work; exceptional states need next-step context |
| Total | 30 / 40 | Good direction, with bounded fixes remaining |

## Five priority findings

### R2-01 · P2 · Segmented keyboard focus loses its solid edge

The component reference's focused segment has only the translucent blue halo. Live styles show no solid border or outline. Its contrast is approximately 2.19:1 against the muted track and 2.26:1 against white, below the 3:1 non-text contrast criterion for the state indicator. Other reference controls add a solid blue edge.

Assessment B compiled the actual saved theme with installed Tailwind 4.3.3. The unlayered default/pressed border rules in [shadcn-theme.css](reference/shadcn-theme.css) outrank the registry's layered `focus-visible:border-ring` rule. The issue is the override composition, not use of a custom theme.

Fix: explicitly provide a solid `--ring` edge in Paper and make focus win over both unselected and pressed border rules in the theme contract. Preserve the segmented appearance. Suggested pass: `impeccable harden`.

Sources: [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [CSS cascade layer ordering](https://www.w3.org/TR/css-cascade-5/#layer-order), local theme lines 94–100 and `reference/shadcn-base-nova/toggle.json`.

### R2-02 · P2 · An empty choice still gives managed-profile advice

Both independent reviews found this. In People → Dependant Validation, neither segment is selected and the error says “Choose how they’ll take part.” The helper simultaneously says “You’ll manage their food preferences. No account needed.” This occurs on desktop and mobile.

Fix: hide branch-specific guidance until a value exists, or use a neutral sentence for the empty state. Keep the segmented control. Suggested pass: `impeccable clarify`.

### R2-03 · P2 · The group error frame is missing from the theme contract

The invalid participation group and the component reference draw a red group boundary and halo. The saved `.onboarding-segments` rules only define its layout and background. The underlying registry ToggleGroup has no group invalid appearance; item invalid styles and Field error text do not reproduce the illustrated whole-group frame.

Fix: specify the group invalid modifier, its error styling and field/error association alongside the existing variants. This is a design-to-theme handoff gap, not a shipped application bug; the theme is intentionally not imported. Suggested pass: `impeccable harden`.

### R2-04 · P2 · Password recovery needs its successful path

Recovery currently shows a reset request, email validation, invalid new-password entry and reset unavailability. There is no represented check-email/link-sent confirmation, normal new-password state, or completed-reset destination.

Fix: complete that minimal path and annotate the transitions. Keep recovery marked proposed until delivery exists. Preserve the user's instruction to omit Get help copy. Suggested pass: `impeccable onboard`.

### R2-05 · P2 · Exceptional states lose the visible pause route

Normal setup has Save & exit. Finish Jamie's invitation, Your family didn't load and Finish joining your family instead show one completion/retry action and a plain Alex header. The design does not establish a recognisable, safe way to pause or the return destination.

Fix: define an explicit pause/return route for each state, retain the original pending operation and communicate what is saved. Do not treat an uncertain mutation as a fresh create/send opportunity. Suggested pass: `impeccable harden`.

## Strengths, cognitive load and audience fit

- The adult CTA and nearby invitation helper explain the external action before submission.
- Solo setup works without apology or forced people entry.
- Completion provides reassurance about the next private conversation and the user's sharing choice.

The main journey has low cognitive load: one dominant task, related fields grouped, progressive disclosure and few peer alternatives. The three row-specific Edit actions do not compete with Continue as five equal choices. The local choice-error contradiction and unclear exceptional-state exits are the main interpretation burden.

The welcoming opening settles into compact routine forms and a meaningful completion moment. Partial operations create the largest emotional valley because the familiar pause action disappears. A first-time adult may hesitate at the contradictory helper or muted signup link; an interrupted organiser needs a safe exit; the solo adult is well served.

## Sizing and themed shadcn evidence

Measured representative forms: 432px desktop; 342px inside a 390px phone frame. Routine headings are 36/40px desktop and 28/32px mobile. Input text is 14/20px desktop and 16/24px mobile. Input, button and segment targets are 44px high; representative Edit is 64×44px and Save & exit is 73×44px. No undersized action target or clipping was confirmed in inspected designs.

The theme has 47 live tokens. Text and normal field boundary contrast checks are sound: muted text 5.76:1 on white / 5.25:1 on the field fill, links 6.06:1 on white, and input border 3.32:1 against fill. The current theme and control shapes are intentional overrides; neither a neutral reskin nor radio circles is recommended.

Minor observations: make the actionable Create an account phrase use the established link treatment rather than muted helper styling. Translucent focus/error colors are recorded as resolved literals in Paper; they can drift when base palette values change and should be regenerated or rebound when supported. The longer mobile adult form places its primary action before the existing roster, so its height alone is not a defect.

## Decisions for the next pass

1. Fix all five findings together, or do the theme and copy corrections first?
2. For interrupted partial setup, use Save & exit with resumption of the pending step, or return to the family summary with a visible pending item?

## Evidence boundaries

A inspected all 18 main desktop/mobile screens, 16 representative states and the component board through live Paper screenshots and trees. B independently measured representative controls and states, inspected source/theme composition, and compiled the theme in temporary files. The parent verified selected evidence. 320px layouts, text enlargement, keyboard operation, announcements and actual state transitions remain unverified in a running application.

The CLI detector received a real one-file JSX scan but failed with exit 127 because engine 0.1.5 was absent and its default cache unwritable. Counts are unavailable, not zero. The critique-storage slug helper failed for the same reason; this is a manual review record with no helper-generated trend. Ignore lists were absent. B inspected a fresh, hidden, signed-out read-only browser view of the Paper canvas and closed it; no editor-DOM detector or overlay was used. No server was started. B removed its temporary JSX/compiled CSS and directory. The live Paper designs and application source remain unchanged.

## Resolution after user approval — 20 September 2026

The review above records the pre-fix evidence. The user subsequently approved all five findings and Save & exit with resumption of the pending step.

| Finding | Design resolution |
| --- | --- |
| R2-01 | Solid token-bound focus border in Paper; explicit theme focus rule ordered after the pressed border. Verified with Tailwind 4.3.3 compilation and live styles. |
| R2-02 | Removed branch-specific managed-profile help from the empty choice in desktop and mobile validation. |
| R2-03 | Added the theme's group invalid modifier, matched Paper's outline/halo and specified labelled-group, linked-error and focus behavior. |
| R2-04 | Added check-email, normal new-password and password-updated screens in both sizes, with destinations in Paper notes and the transition contract. Recovery remains proposed until delivery exists. |
| R2-05 | Added Save & exit to all three exceptional states in both sizes; added paired Setup saved with pending-step context and Resume setup / Log out. Specified durable checkpoint, save-failure and original-operation reconciliation rules. |

The minor Create an account affordance also uses the established blue link treatment. See [design verification](experiments/compact-themed-shadcn.md#design-verification) and [transition contract](onboarding-transitions.md). These close the design findings; G01–G14 remain implementation work. The heuristic score has not been re-scored or presented as runtime evidence.
