# coss UI visual references

Reviewed on 21 September 2026. shadcn remains the component foundation. These references inform appearance, not a migration to coss component APIs.

- [Button](https://coss.com/ui/docs/components/button): a thin upper highlight and small lower shadow on solid controls; restrained depth on outline controls; reduced elevation while pressed or disabled.
- [Input](https://coss.com/ui/docs/components/input): white surfaces, visible edges and soft lower shadows.
- [Card](https://coss.com/ui/docs/components/card): a white rounded primary surface over a muted footer.

The source and documentation were inspected through the shadcn registry CLI. The implementation retains shadcn Button/Input primitives, supported InputGroup composition and the shadcn Card API. CardBody is a local presentational grouping for the white surface; it does not introduce another component-library contract. Form behavior remains in TanStack Form and Effect Schema.

The theme uses Tailwind utilities, 44px default controls, pill buttons, 12px inputs, Inter and semantic colors. Primary, secondary, outline and destructive variants receive suitable depth; link and ghost variants remain flat. Base UI stays at 1.8.0 and Tailwind at 4.3.3.
