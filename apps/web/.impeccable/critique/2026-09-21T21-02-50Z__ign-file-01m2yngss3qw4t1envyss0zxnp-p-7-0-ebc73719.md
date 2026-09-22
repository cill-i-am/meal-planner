---
target: Framed coss card, inputs and button depth
total_score: 20
max_score: 24
na_heuristics: 1,3,7,9
p0_count: 0
p1_count: 1
target_identity: "url:https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-7-0"
timestamp: 2026-09-21T21-02-50Z
slug: ign-file-01m2yngss3qw4t1envyss0zxnp-p-7-0-ebc73719
---

Method: dual-agent (A: direction_design_review; B: direction_evidence_review).

# Framed card direction review — 21 September 2026

Target: approved desktop login, mobile signup and button study on the [Paper exploration page](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-7-0). This assesses the design before implementation, not the old running application.

## Design health

| Heuristic | Score | Evidence |
| --- | --- | --- |
| Visibility of system status | n/a | Interactive states not established by static designs. |
| Match with the real world | 4 | Familiar account labels and direct task language. |
| User control and freedom | n/a | Navigation and draft preservation require runtime checks. |
| Consistency and standards | 3 | Component study contains conflicting border and focus colors. |
| Error prevention | 3 | Labels, password requirement and visibility control are represented. |
| Recognition rather than recall | 4 | Requirements and alternate account route remain visible. |
| Flexibility and efficiency | n/a | Autofill and keyboard behavior require runtime checks. |
| Aesthetic and minimalist design | 3 | Clear hierarchy; framing consumes mobile width. |
| Error recovery | n/a | New-direction recovery states need propagation. |
| Help and documentation | 3 | Concise field help and recovery entry. |
| Total | 20/24 | Visual review only; not functional readiness. |

## Assessment

The opaque form panel provides a stable reading surface over the pastel gradient. The muted footer separates alternate navigation. A thin inset highlight and small lower shadow make buttons feel pressable without competing with the form. Prefer soft edge over satin.

Authentication remains intentionally familiar. Family names, avatars, invitation status and privacy explanations provide product character later. Do not add decorative illustrations or promotional copy to distinguish a routine login screen.

The independent detector returned an empty findings array, exit 0, over three exported JSX files: desktop-login.jsx, mobile-signup.jsx and button-depth.jsx. There were no rule findings or false positives. Paper exports use div/SVG geometry, so this scan establishes neither semantic accessibility nor functioning interactions.

## Priority corrections

- P1: Carry every existing error, saving, uncertain-save and partial-invitation state into the new shell. Preserve values, specific messages and recovery actions. Keep focus and validation distinct from elevation.
- P2: Dense mobile setup should use 16px inner padding. The 390px auth composition provides 308px of control width, less than the previous 342px. Use natural page growth and scrolling; keep the action before supporting lists.
- P2: Use the approved input edge #909098 (3.17:1 on white), not the study's #B5B5BE (2.04:1). Reuse the existing ring token. Update tokens, component references and DESIGN.md together.
- P2: Underline inline footer links and provide actual 44px targets. The original footer text was only 18px high. The study's eye icon also needs the 44px wrapper already present in the approved auth screens.
- P2: Add depth to primary, solid secondary and outline actions. Keep links, ghost actions and repeated row actions flat. Pressed and disabled states lose external elevation. Preserve visible keyboard focus.

## People and task flow

No cognitive-load checklist failures or decision points with more than four competing options were observed in auth. Cross-screen memory and progressive disclosure remain unverified. Supporting people lists should stay visually subordinate without nested elevated cards.

For a busy parent using one hand, preserve ordinary scrolling when the keyboard opens. For enlarged-text and reduced-vision users, check footer wrapping, segment labels and focus visibility. For invited adults, keep recipient/account context and privacy explanations intact.

The emotional low point is an uncertain save or repeated entry. Retained values and precise recovery copy matter more there than additional decoration. Completion should show the assembled family and one next action.

Questions skipped: the direction and implementation scope are approved. Apply the corrections during implementation and check the resulting browser states.
