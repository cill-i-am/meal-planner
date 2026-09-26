# Web interface work

For UI changes, inspect the relevant live [Paper design](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0) and [DESIGN.md](DESIGN.md). Paper is the design source; Markdown and screenshots record a dated version. Keep shadcn as the component foundation, including its APIs, behavior and semantic tokens. Other libraries may inspire the visual theme; do not replace the foundation when applying that styling.

Use Tailwind utilities for layout, typography, spacing, responsive rules and interaction states. Keep semantic theme variables in the Tailwind theme. Custom CSS is only for blur or motion effects that Tailwind cannot express; do not add page-specific CSS selectors for ordinary UI styling.

Define theme colours in OKLCH and consume them through semantic tokens. Use OKLCH for authored colour mixes. Do not introduce hex, RGB or HSL literals into application styling or current design references.

Every icon-only action needs an accessible name and a shadcn Tooltip that appears on hover and keyboard focus. Keep the tooltip accurate when the action changes, such as Show password / Hide password.

Implement an agreed design without asking for approval again. For a new screen or substantial redesign, agree it in Paper before coding the UI. If Paper is unavailable, say so and continue with work the committed references support. Do not treat an old screenshot as the latest design.

For form behavior, read [the form rules](../../docs/reference/forms.md). [PRODUCT.md](PRODUCT.md) and [.impeccable/config.json](.impeccable/config.json) are inputs to the design tools. Do not regenerate or replace them during unrelated work.
