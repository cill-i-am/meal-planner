# AI-native journey: interface and motion review

Method: independent design review by `journey_design_review` (A) and detector/browser review by `auth_entry_ui` (B), followed by implementation and integration checks. B's findings were withheld until A finished.

## Direction

The interface follows the approved [family edit](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-I-0) and [connected entry](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-J-0) designs. New recovery, review and incomplete-data states are recorded on the [implementation page](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-K-0).

The family and its food remain the focus. Conversation gathers context and proposes changes; the user sees and confirms the exact change before it becomes shared data. The serif display type, approved food photography and restrained person colors carry the product's character. Shared shadcn controls preserve familiar focus, keyboard and overlay behavior.

## Findings and changes

| Finding | Change |
| --- | --- |
| An empty fixed-height history pushed the first composer below the viewport. | Empty conversations use a compact introduction; populated history has one scroller and an anchored composer. |
| Review blocks appeared separately from the assistant turn that produced them. | Server-owned turn IDs associate messages, questions and proposals inside the same conversation log. |
| First plan creation reported a version conflict when meal coverage was missing. | The domain returns `config_missing`; the interface points to meal setup before creating a draft. |
| Review dialogs exposed IDs or offered actions without an owning review screen. | People, meals and dates use readable labels. Domain features own the complete planning and food-content reviews. |
| Dense forms and repeated headings competed with the current plan. | Existing plans use one main heading and compact controls. Page gutters have one owner; forms use focused sections and shared controls. |
| Portal content inherited the old green theme. | Journey overlays carry the same semantic theme as their trigger surfaces. |
| Cooking instructions were difficult to distinguish from recipe metadata. | The recipe exposes ingredients and method, with a separate focused step view. |

## Motion and sound

[Better UI](https://github.com/jakubkrehel/skills/tree/main/skills/better-ui) and Impeccable informed these choices:

- Preserve continuity when a reviewed roster changes. Avoid replaying entrance animation on saved history.
- Use a short 140 ms transition between cooking steps. Reduced motion keeps the state change legible without vertical movement.
- Reuse the existing button press and icon-swap behavior instead of adding another motion system.
- Use the existing quiet interaction click for deliberate food selections and cooking navigation. The saved mute preference gates playback; blocked or unsupported audio never blocks the action.
- Do not play audio for model completion, page loading or background saves.

## Review evidence

The CLI detector returned no findings in the conversation, planning, food-book, workspace and onboarding source directories. Browser injection succeeded on three representative screens. Its eyebrow-label and cream-palette warnings reflected the approved visual language; the nested-composer warning reinforced the need to simplify that surface.

The first browser pass found no horizontal overflow at 320, 390 or 1440 px and no WCAG A/AA violations on the sampled setup, tastes, weeks and food-book screens. It also checked keyboard navigation, the skip link, drawer Escape/focus return and mute persistence. These observations came from an intermediate bundle; the final integration checks are recorded in the [implementation plan](../../../docs/plans/ai-native-family-journey.md).

Final regression checks pass: 257 web tests, 1,203 API tests, and eight native journey cases across Chromium and mobile WebKit. The browser cases cover exact retry after a committed response is lost, linked-adult admission, confirmed food facts, a complete two-week plan, shared cooks and later leftovers, explicit revisions, and recipe cooking with mute and reduced motion.

The final populated plan, day, recipe, cooking and question views report no automated WCAG A/AA violations. The 320 and 390 px views fit without horizontal overflow; desktop review uses 1440 px. Gradient contrast needs manual inspection. The settled segmented indicator stays aligned with its selected label. Meal occasions appear in a consistent breakfast-to-snacks order while retaining the original per-person occasion IDs. Deterministic provider fixtures establish application behavior, not live model quality.

## Run notes

No critique ignore list was present. Both reviewers used isolated browser sessions; the detector overlay server and those sessions were closed. Audio preference and source gating were checked; audible sound was not measured. New states remain editable in Paper.

Questions skipped: the user requested implementation and review fixes within the already approved direction.

## Final hook triage

The decorative left border on the private profile review introduction predated this branch. It and its extra indentation were removed so the introduction aligns with the surrounding text. Inter remains the approved body and control font, paired with Instrument Serif display headings. The repository hook config records an `overused-font=Inter` exception scoped only to `apps/web/src/styles.css`. The final CSS detector reports no remaining findings; formatting checks pass.
