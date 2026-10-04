---
target: Conversational family setup
total_score: 30
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
target_identity: "file:/Users/cillianbarron/.codex/worktrees/a56d/Meal planner/apps/web/src/features/onboarding/family-setup.tsx"
target_fingerprint: "sha256:8cfe781b003f2bccfb2d44767f0de5de599c828a3268e4e5bd1e03c5e215f87c"
target_path: /Users/cillianbarron/.codex/worktrees/a56d/Meal planner/apps/web/src/features/onboarding/family-setup.tsx
timestamp: 2026-10-04T23-15-45Z
slug: apps-web-src-features-onboarding-family-setup-tsx
---

Method: dual-agent (A: family_design_critique · B: family_design_detector)

# Conversational family setup critique

Target: apps/web/src/features/onboarding/family-setup.tsx, family-table.tsx and family-setup-chat.tsx.

## Design specificity

This feels authored for Meal Planner. The family table is a persistent review surface, with the account holder seated before the first message and people appearing around it as the draft arrives. Plain questions and corrections let the table carry the detail. It avoids the interchangeable card stack of a generic assistant.

The independent detector returned zero findings on each of the three source files, with exit code zero. There were no detector false positives. Browser overlay injection was not verified; no live overlay is claimed.

## Design health

| Heuristic | Score | Evidence or limit |
| --- | --- | --- |
| System status | 3 | Draft, saving and recovery labels are visible. |
| Match with the real world | 4 | People, names and roles around the table fit the product. |
| User control and freedom | 3 | Corrections and manual entry are deliberate choices. |
| Consistency | 3 | Both modes retain the same header and draft context. |
| Error prevention | 3 | Agreement is bound to the exact displayed draft. |
| Recognition rather than recall | 3 | A contextual cue explains saving and continuation. |
| Flexibility and efficiency | 3 | One description can add several people. |
| Aesthetic and minimal design | 3 | Conversation stays plain; the table carries the details. |
| Error recovery | 2 | Exact retries are tested; fault states received less live visual review. |
| Help and documentation | 3 | The opening and save cue explain the immediate task. |
| Total | 30/40 | Good, with recovery visual evidence less complete. |

## What works

- The table stays present from one account holder to the displayed family.
- Replies ask for the next useful detail without repeating every person.
- Conversational corrections and the optional seeded form support different editing needs.

## Priority issues and disposition

- P1, fixed: assent did not explain saving and automatic continuation. The composer now says “Reply yes to save your family and explore their tastes.”
- P2, fixed: empty mobile history left excessive space and pushed the manual link below the first view. The empty history is now compact.
- P2, fixed: the desktop composer crossed the entire page while conversation occupied one column. It now aligns with the dialogue.
- P2, fixed: manual entry changed context abruptly. It retains the header, explains the seeded draft and offers “Return to conversation.”
- P2, fixed after the final source review: manual edits disappeared when switching modes. Activity boundaries now preserve both local presentations. A browser regression verifies edited names, unsent chat text, hidden controls and zero writes while switching.

## Cognitive load and emotional journey

The first assessment found two of eight cognitive-load checklist failures: unclear next action and reliance on recall for the confirmation format. The contextual cue addresses both. No decision point has more than four visible choices. The opening is inviting, the populated table is the reveal, and a correction gives visible control. Confirmation now explains its consequence before the automatic move into food discovery.

## Persona checks

- First-time parent: the save cue makes conversational agreement discoverable.
- Mobile parent: the empty view exposes the composer and manual alternative within the first viewport. Longer manual forms grow naturally.
- Keyboard and screen-reader user: controls have accessible names, the transcript scrolls, and the table announces names and roles on revision. Reduced-motion behavior was source-reviewed rather than measured in a recording.

## Minor observations

Future visual review should exercise unknown-result states in a live browser under controlled faults. Current recovery proof comes from meaningful browser and native tests. The detector browser preflight stalled, so CLI results and the separate independent desktop/mobile inspection are the available evidence.

Questions skipped: the user specified the direction and authorized implementation.
