# Family onboarding design brief

This brief records the Paper design reviewed on 20 September 2026. It covers login and signup through family setup and the handoff to private discovery. It preserves the agreed design for implementation; it does not implement the screens.

## Design authority

[Live Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0) is the source of truth for visual design. Check the relevant live screens, states, and tokens before adding or changing UI. [DESIGN.md](../DESIGN.md) explains the design system. The [snapshot index](snapshots/index.md) and [manifest](paper-onboarding-state.json) preserve a dated baseline.

shadcn owns component structure, behavior, and semantic token conventions. The [reference theme](reference/shadcn-theme.css) maps those conventions to the white surface, diffuse pastel gradient, grey fields, blue links, pastel avatars, pill buttons, and segmented control shown in Paper. The [motion reference](reference/onboarding-motion.md) defines the gradient's subtle movement and static alternative.

The sky outside desktop windows represents desktop wallpaper. It is presentation context, not application UI. Implement the white application viewport and its content. Do not copy the outer sky, mockup padding, window framing, or phone status bar. Mobile designs have no sky strip.

## User and outcome

Help the first adult create an account, name their family, add the people they plan food for, and reach private discovery. Returning adults resume incomplete setup or enter their existing family. Invited adults join the existing family and person record without creating duplicates.

The audience is Ireland-first adults with varied family routines, dietary needs, and digital confidence. Support interrupted phone use and larger screens. [PRODUCT.md](../PRODUCT.md) owns the broader product context.

## Scope

- Email/password login and signup, including field and service errors.
- Family creation, people entry, roster review, and completion.
- Adult invitations, recipient responses, and partial-operation recovery.
- Save & exit with resumption of the pending step.
- Password recovery, marked as proposed until delivery is configured.

Private discovery, portions, routines, meal planning, and shopping remain outside this design slice.

## Agreed decisions

- Use a centered, narrow form with one main task at a time. This was the selected third composition; workspace and progress-rail alternatives were not selected.
- Preserve the themed appearance when adopting shadcn. Keep the segmented choice; the user rejected a neutral reskin and radio circles.
- Use **family** in product copy. Keep internal `household` identifiers.
- **Add and invite** collects an adult's email and invites them in the same user action. Recipients can join or decline. **Manage profile** creates a dependant without an account invitation.
- Keep one-person families valid. Another person's invitation or discovery must not block the creator.
- Reuse the account name when proposing the creator's person name. Preserve explicit creation and canonical account/person linking.
- Preserve safe drafts and original command identities. Resolve an active person draft before continuing; do not silently discard it.
- **Save & exit** saves the pending step. Resume checks canonical state before continuing that operation. A failed checkpoint save stays on the origin with an error.
- Omit **Get help signing in**. Do not invent a support destination or claim password-reset delivery exists.

The user asked whether age is needed for portions. The inspected person/profile schemas contain no DOB, age, or portion default. [PDR-0004](../../../docs/decisions/product/0004-meal-content-portions-recipes-and-shopping.md) specifies appetite-based portions. Keep DOB out of this setup; portion implementation belongs to later discovery/profile work.

## Screens and states

Each feature has matching desktop and mobile designs. Paper groups main screens above states and uses matching numbers across devices. The baseline contains 12 screens and 19 states per device: 62 design boards in total.

| Feature | Screens per device | States per device | Main screens |
| --- | --- | --- | --- |
| [Auth](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-6-0) | 2 | 3 | Log in; create account |
| [Family](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-5-0) | 3 | 6 | Name family; review family; ready for discovery |
| [People](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-4-0) | 2 | 3 | Add and invite adult; add managed profile |
| [Invitations](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-3-0) | 1 | 4 | Join or decline |
| [Recovery](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-2-0) | 4 | 3 | Request reset; check email; new password; password updated |

[Overview](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0) contains the feature index, design notes, transition annotations, and component-state reference. Paper's Family sidebar page still has the title **Household**; its canvas and product copy use **Family**. Page renaming was unavailable through the tools used for this handoff.

## Implementation references

- [Error contract](onboarding-error-contract.md): field validation and Better Auth/household API failures.
- [Transition contract](onboarding-transitions.md): recovery destinations, saved setup, and segmented-field behavior.
- [Implementation gaps](onboarding-implementation-gaps.md): 14 open gaps and code evidence.
- [Design decisions and checks](experiments/compact-themed-shadcn.md): the resolved critique findings and static verification.
- [First critique](onboarding-critique-2026-09-20.md) and [second critique](onboarding-critique-round2-2026-09-20.md): historical findings and resolutions.

## Reference and asset provenance

The user supplied [Ivan Boroja's video](https://x.com/ivanboroja/status/2101373757944459600) as the visual reference and rejected the prototype UI as the design authority. The chosen composition adapts its restrained application surfaces and rounded controls to family onboarding. The sky remains desktop presentation wallpaper. The third-party video, captured frames, rejected compositions, and temporary Impeccable session files are not included in this handoff.

The [sky asset](assets/daylight-sky.png) was generated for desktop mockup presentation; its [prompt](assets/daylight-sky.prompt.txt) is retained for provenance. Do not ship or import it into the application. All example names and email addresses in the Paper exports are synthetic.
