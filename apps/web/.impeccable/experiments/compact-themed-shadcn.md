# Onboarding design decisions and checks

This record explains the design refinements accepted on 20 September 2026. [Live Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0) remains the visual source of truth. [DESIGN.md](../../DESIGN.md) records the resulting design system, and [the snapshots](../snapshots/index.md) preserve this baseline.

## Decisions retained from the reviews

| Review finding | Accepted result |
| --- | --- |
| Routine tasks have too much visual emphasis | Use 36px/40px desktop and 28px/32px mobile task headings. Retain larger welcome/completion emphasis where Paper shows it. Remove repeated introductions and footer slogans. |
| Fields and selected segments lack clear boundaries | Add the input border token, visible focus states, and 44px targets. Keep the filled-field and segmented appearance. |
| Person labels imply age or overlap | Use **Invite adult** / **Manage profile**, and **Managed profile** in the roster. Do not infer child status or portions from the selection. |
| Recovery loses account or invitation context | Show the current signed-in email for wrong-account recovery and the saved invitation destination for partial completion. Retain the original operation. |
| Reset-unavailable copy has no useful destination | Explain that reset is unavailable and provide **Back to log in**. The user removed help copy; no support destination was invented. Delivery remains an implementation gap. |
| Tokens and component states drift | Use shadcn semantic roles with explicit theme overrides. Retain white/lilac surfaces, grey fields, blue links, pastel avatars, and black pill buttons. |
| R2-01: selected-border override hides the focus edge | Add a solid `ring` border and place the explicit focus rule after the selected-border rule. |
| R2-02: an empty choice gives managed-profile advice | Remove branch-specific guidance until a choice exists. Apply this to both device sizes. |
| R2-03: group validation has no theme equivalent | Add the `aria-invalid` group outline/halo and specify its label, error association, and focus behavior. |
| R2-04: password recovery lacks successful transitions | Add check-email, ordinary new-password, and password-updated screens in both sizes. Record every destination. Recovery remains proposed until delivery exists. |
| R2-05: exceptional states have no pause route | Add **Save & exit** to partial invitation, unavailable roster, and unfinished linking. Add **Setup saved**, the pending step, **Resume setup**, and **Log out**. |

The user rejected a neutral black-and-white reskin and radio circles. Those experiments are superseded. The segmented control uses single-selection shadcn ToggleGroup semantics. **Create an account** also uses the established blue link treatment across login states.

The user clarified that the sky is desktop wallpaper used to present the mockups, not part of the application. Earlier notes had incorrectly described it as an application frame. The handoff and Paper notes now identify that boundary, and the sky strips were removed from all 31 mobile designs. Desktop wallpaper and phone status bars remain presentation context only.

## Design verification

Desktop and mobile screenshots were reviewed across the main flow, representative validation and recovery states, and the component reference. Content-driven heights avoid clipping longer forms. The final set retains all 54 original design boards and adds eight, for 62 screen/state boards. Paper has 80 total artboards, including navigation and reference boards.

Before the gradient restoration, 47 live tokens had hash `4edac556`. The original 54 JSX exports referenced 38 token names with no missing definitions. The eight additions plus the notes/component reference referenced 35 names, all defined. These checks establish token coverage for those inspected exports, not application behavior.

Static contrast measurements were 3.32:1 for the input boundary against field fill, 5.25:1 for muted text against field fill, and 7.81:1 for error text against white. Computed styles confirmed the solid focus border, group invalid outline, and 44px exit target.

The saved reference theme compiled with Tailwind 4.3.3. The explicit unlayered focus rule follows the equally specific selected-border rule. The output includes the invalid-group outline and translucent halos with color-mix fallbacks. The compiler check used an installed local compiler after the pnpm launcher could not verify its registry signature with restricted network access.

## Pastel gradient restoration

The user identified that the original multicolour glow had been reduced to a uniform lilac wash. All 62 task surfaces now use layered lilac, blue, rose, and peach radial gradients, with a white fade at the upper edge. Four glow tokens replace the single `brand-wash` token, giving 50 live tokens with hash `d5cbbe01`.

The [motion reference](../reference/onboarding-motion.md) adapts Ceird's slow decorative glow into a 42-second alternating drift. It includes a browser preview without changing application source. Paper owns the static visual frame; the reference records the timing, amplitude, and pause behavior. The desktop sky remains presentation-only wallpaper.

## Verification limits

The reference CSS is not imported by the application. Static screenshots do not verify keyboard operation, screen-reader announcements, 320px layouts, text enlargement, state transitions, or email delivery. Those checks belong to implementation.

Both critique passes attempted the Impeccable detector. It failed because its engine was unavailable; detector counts are unavailable. The critiques therefore record manual design review and source inspection, not an automated accessibility pass.

All [G01–G14 implementation gaps](../onboarding-implementation-gaps.md) remain open. The [transition contract](../onboarding-transitions.md) specifies safe pending-step resumption. The historical critique scores have not been re-scored or presented as runtime evidence.
