# Auth card view transitions

Implemented on 21 September 2026, using Impeccable's animate/polish guidance and the requested [better-ui skill](https://github.com/jakubkrehel/skills/tree/main/skills/better-ui). The live Paper auth/recovery cards share the 480px surface and 16px corners; this refinement preserves their layout and shadcn components. Paper’s Overview motion note now records the same timing and reduced-motion behavior; the note fits its existing section without clipping.

## Motion thesis

- Focal moment: one framed card changes task when moving between login, signup and reset-unavailable.
- Continuity: the opaque surface changes bounds over 300ms with ease-out. Heading, fields and footer are separate snapshots so their text never stretches.
- Feedback: old content fades out over 100ms; new content fades in over the next 200ms. The new heading receives keyboard focus immediately. Controls are not staggered and no artificial delay is added to navigation.
- Budget: native snapshots only during route changes. Header and gradient stay outside the route animation; no new dependency, recurring effect or persistent compositing hint is added.

TanStack Router owns the transition lifecycle through its [documented navigation support](https://tanstack.com/router/latest/docs/framework/react/examples/view-transitions), checked against the installed router source. Typed transition support is required because TanStack otherwise falls back to animating all navigations without running the route-selection callback. Unsupported browsers navigate normally. Reduced motion is checked for each navigation and removes snapshot names and animations. Same-path updates, initial loads and routes outside the three auth screens are excluded.

Native pseudo-element motion rules live in styles.css; component layout and snapshot naming remain Tailwind utilities. This is the permitted motion exception to the Tailwind-only rule. The [MDN view-transition guide](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using) documents these browser-owned snapshot pseudo-elements.

## Review: continuity and legibility

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM, resolved | `apps/web/src/features/auth/auth-layout.tsx:31`; `apps/web/src/styles.css:671` | Abrupt route replacement; an initial whole-card cross-fade exposed the glow and overlapped headings | Separate surface and content snapshots, opaque resizing surface, sequential text fades | Shared-element continuity explains the task change without stretching text or briefly putting controls over the gradient. |
| LOW, resolved | `apps/web/src/features/auth/auth-view-transition.ts:5`; `apps/web/src/router.tsx:16` | No scoped navigation motion | Typed auth-only transitions, including browser history, with current reduced-motion preference | Keeps frequent validation and non-auth navigation immediate. |

## Verification

TypeScript, focused lint, 28 auth/navigation tests and the production build passed. Browser checks covered login/signup navigation, both recovery links, keyboard activation and heading focus, settled Back/Forward navigation, and recovery at 390px without horizontal overflow. Captured intermediate frames confirmed the surface stays opaque and content fades independently. Reduced motion disabled snapshot names and the active auth transition. Temporary viewport/media overrides were reset; the login preview remains available.

Rapid history reversal reached the correct final route. Chromium reported a native `AbortError: Transition was skipped. New ViewTransition started` when a new transition superseded one in progress; no form or route failure occurred.

**Not verified:** 10% playback, which this in-app browser's Animation CDP interface does not support; non-Chromium runtime behavior; a full frame-time performance profile. Configured password-reset forms remain Paper designs and do not yet participate in a live route transition. This does not implement reset delivery.

**Approve** for the inspected auth transition. No HIGH finding remains in that scope. CI and PR work remain deferred.
