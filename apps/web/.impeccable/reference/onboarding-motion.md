# Onboarding gradient and motion

The pastel gradient belongs inside the application. The sky outside desktop mockups remains presentation wallpaper. [Live Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0) owns the static visual design; [the HTML study](onboarding-motion.html) demonstrates the proposed movement using [the reference theme](shadcn-theme.css).

## Visual and motion contract

Use four overlapping radial gradients: lilac, blue, rose, and peach. Fade their upper edge and outer area into the white application surface. Keep fields opaque and text stationary. The gradient is decorative and does not communicate status.

- Move one background layer through a 42-second `ease-in-out` cycle that alternates direction.
- Limit translation to 1.5% horizontally and 0.75% vertically, and scale to 1.025. Opacity ranges from 0.88 to 1.
- Pause while the form contains focus. Preserve the current position when paused.
- Pause when the document is hidden or the surface is offscreen. The preview uses Page Visibility and Intersection Observer to set `data-motion-paused`.
- For `prefers-reduced-motion: reduce`, show the full static gradient without translation, scaling, or animation.
- Keep the layer isolated, clipped, and unable to intercept pointer input. Use a CSS pseudo-element; do not add canvas, a shader, or a motion dependency for this effect.

The preview includes an explicit pause control. Its form is read-only and demonstrates placement and focus behavior; it does not submit data or implement onboarding. The application must expose appropriate motion control and preserve reduced-motion behavior when integrating the reference.

## Ceird reference

The source inspected was Ceird commit `a4b0a3ec34c93d4dce1dfacee50aa2523919c1cf`: [entry-atmosphere styles](https://github.com/cill-i-am/ceird/blob/a4b0a3ec34c93d4dce1dfacee50aa2523919c1cf/apps/app/src/styles.css#L292) and [EntryAtmosphere](https://github.com/cill-i-am/ceird/blob/a4b0a3ec34c93d4dce1dfacee50aa2523919c1cf/apps/app/src/features/auth/entry-atmosphere.tsx#L13). Its glow uses layered radial gradients, slow transform/opacity drift, 30–42 second variants, and a static reduced-motion path.

This reference adapts the slow glow to Meal Planner's pastel palette. Ceird's blueprint grid, tracing marks, layout, and branding are not part of this design.

## Verification and implementation boundary

Browser checks cover a changing gradient transform with stable form bounds, manual pause, field-focus pause, offscreen pause, a static reduced-motion gradient, and no horizontal overflow at 320px. Mobile inputs remain 16px. The darkest full-strength gradient stop has at least 4.5:1 contrast against the existing muted text color; fields keep their opaque fill.

The preview and CSS are design references. They are not imported by the app. Integrating the layer, verifying real-page visibility handling, and measuring performance on target devices remain part of G12 in the [implementation ledger](../onboarding-implementation-gaps.md).
