# Web interface design

Use [PRODUCT.md](PRODUCT.md) for the interface's product context. The [Impeccable config](.impeccable/config.json) owns the build-path default.

[Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0) is the source of truth for the visual design. Before adding or changing screens, components, or other UI, inspect the relevant live Paper screens, states, and tokens. Use [DESIGN.md](DESIGN.md) for the design rules and links. Markdown and exported snapshots record a dated baseline; they do not override Paper. shadcn owns component structure, behavior, and semantic token conventions; theme those components to match Paper.

For new surfaces and substantial visual redesigns, develop the composition in Paper and refine it with the user before application UI coding. If Paper has no design for the requested surface, extend the agreed visual system there first. Keep the design reference and affected documentation aligned with the agreed result. If Paper is unavailable, report that limitation and use the committed snapshots only for work the available evidence supports; do not present them as the latest live design.
