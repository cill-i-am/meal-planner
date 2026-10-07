# Meal Planner

Meal Planner helps a household decide what to eat and what to buy. It learns each person's preferences, proposes a practical week of meals, and turns an approved plan into a shopping list. Parts of this experience are still being built.

## Start here

- [Documentation and coding standards](docs/README.md)
- [Product purpose and scope](apps/web/PRODUCT.md)
- [Plans and remaining work](docs/plans/README.md)
- [Product and architecture decisions](docs/decisions/README.md)

## Development

This pnpm monorepo contains the [API](apps/api/README.md), [web app](apps/web/README.md) and shared API types under `packages/`. Use the versions and scripts in [package.json](package.json).

Use [local development](docs/how-to/local-development.md) to choose the application runtime and verification commands. [Infrastructure operations](docs/how-to/operate-infrastructure.md) covers provider setup and deployment. Never commit provider credentials or cookies.
