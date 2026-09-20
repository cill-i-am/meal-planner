# Meal Planner

An AI-native household food service: learn how the household eats, propose a practical personalised week, and turn an approved plan into shopping demand. The full product vision is broader than the currently implemented experience.

## Start here

- [Documentation and engineering contracts](docs/README.md)
- [Product purpose and scope](docs/explanation/product/vision-and-scope.md)
- [Plans and remaining work](docs/plans/README.md)
- [Decisions](docs/decisions/README.md)

## Development

This pnpm monorepo contains the [API](apps/api/README.md), [web app](apps/web/README.md) and shared contracts under `packages/`. Use the versions and scripts in [package.json](package.json).

`pnpm check`, `pnpm test`, `pnpm lint` and `pnpm build` are repository checks. `pnpm dev` starts the local **Tesco Node catalogue host**, not the complete web and Cloudflare application. See [local development](docs/how-to/local-development.md) and [infrastructure operations](docs/how-to/operate-infrastructure.md) for the distinct runtimes and configuration. Never commit provider credentials or cookies.
