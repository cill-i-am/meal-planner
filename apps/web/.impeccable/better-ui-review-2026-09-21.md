# Better UI polish review

Reviewed and applied on 21 September 2026 using the requested [better-ui skill](https://github.com/jakubkrehel/skills/tree/main/skills/better-ui) and its surfaces, animations, icon transitions, icons, enter/exit and performance references. shadcn/Base UI, Tailwind, semantic OKLCH colours, current density and the approved framed-card direction remain the foundation.

## Scope

The implementation scope is login, signup and reset-unavailable, including their shared controls. Shared Button behavior also reaches existing application callers. The design scope is every canonical onboarding screen/state in [Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0). Earlier explorations and historical screenshots remain historical references.

| Paper page | Desktop/mobile screens and states | Applied changes |
| --- | --- | --- |
| Auth | 10 | Layered surface edge, matching body radius, password icons |
| Household | 18 | Layered surface edge and matching body radius where framed |
| People | 10 | Layered surface edge and matching body radius |
| Invitations | 10 | Layered surface edge and matching body radius where framed |
| Recovery | 14 | Layered surface edge, matching body radius where framed, password icons |

The Overview reference also records button press and icon motion values and the updated eye icon. All 62 canonical surface styles were checked through Paper's computed styles. This does not implement the remaining family, invitation or configured password-recovery flows; their gaps remain in the onboarding ledger.

## Shadows for elevation; borders for structure

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM, resolved | `apps/web/src/components/ui/card.tsx:14`; `apps/web/src/styles.css:626`; all 62 canonical Paper cards | Decorative border plus a single shallow shadow | Three neutral shadow layers: 1px edge at 6%, 1px lower edge at 6%, 2px lower shadow at 4%; footer dividers and field/state borders retained | Surface depth stays soft while structural boundaries remain legible. |

## Concentric corners

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW, resolved | `apps/web/src/components/ui/card.tsx:14`; `apps/web/src/components/ui/card.tsx:88`; 48 framed Paper cards | Outer border inset and inconsistent 15px/16px inner radii | Zero-inset body and outer surface both use 16px | Coincident edges have matching curvature without changing the established card shape. |

## Interruptible, explicit motion

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM, resolved | `apps/web/src/components/ui/button.tsx:8`; `apps/web/src/components/ui/button.tsx:57`; `apps/web/src/features/auth/auth-form.tsx:119` | Broad transition and no scale feedback | Explicit color/background/border/shadow/scale transitions, 150ms ease-out, scale 0.96; static links and password action | Presses feel tactile without moving the eye target or link text. Reduced motion removes scaling and transitions. |
| LOW, resolved | `apps/web/src/components/ui/tooltip.tsx:48` | Opacity transition relied on default timing | Explicit 150ms ease-out | Frequent tooltip feedback stays restrained and consistent. |

## Contextual icons and optical weight

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM, resolved | `apps/web/src/components/ui/icon-swap.tsx:5`; `apps/web/src/features/auth/auth-form.tsx:132`; `apps/web/src/styles.css:625`; Paper password fields and Overview | Conditional icon mounting and mismatched Paper icon size/stroke | Both Lucide icons stay mounted; opacity 0–1, scale 0.25–1, blur 4–0px, 300ms cubic-bezier(0.2, 0, 0, 1); 16px icons with 1.5px stroke | State changes are interruptible and match adjacent text weight. Label, tooltip and pressed state remain available without motion. |

## Local consistency

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW, resolved | `apps/web/src/features/auth/auth-screens.tsx:341` | Recovery heading retained 36px/40px line heights | Agreed 32px/36px mobile/desktop line heights | Recovery now follows the same task-heading rhythm as login and signup. |

## Verification

- All 159 web tests across 18 files passed, along with TypeScript, focused lint, formatting and the production build. No dependency was added.
- Live browser: signup, login and reset-unavailable; empty and validation states; password visibility, normal-speed icon motion and pressed-button feedback. Computed motion values matched the specified durations, curve, scale and blur.
- Reduced-motion emulation confirmed no button transition and immediate icon changes. Temporary media and viewport overrides were reset.
- Narrow signup at 320px had no horizontal overflow. Desktop login and recovery retained clear spacing, visible input boundaries and a distinct footer.
- No warnings or errors appeared in the inspected browser console.
- Paper: structural/style audit of all 62 screens, plus visual checks of mobile signup, login validation, adult invitation and validation, family review and unavailable, join/decline, wrong account, password validation and reset unavailable. Desktop card checks covered signup, family review, adult invitation, join/decline and password validation. The Overview was also inspected.
- Visual verdict: hierarchy, spacing, contrast, alignment and artboard fit are consistent in those previews. Dense forms retain enough space for errors; the supporting footer stays subordinate to the main action.

**Not verified:** motion playback at 10% speed; the in-app browser rejected the Animation CDP method. Normal-speed motion and computed values were verified. Loading and disabled behavior was covered by existing tests and source review, but was not replayed in this browser pass. Non-auth application callers were not individually walked through. Paper-only flows have no live interaction coverage, and not all 62 screens received an individual screenshot review. CI and PR review remain deferred at the user's request.

**Approve** for the inspected polish and recorded coverage. No HIGH finding remains in that scope; this is not approval of unimplemented flows or uninspected runtime behavior.
