# Workspace dependency upgrade

Registry and upstream release metadata checked on 5 September 2026 against
`origin/main` at `3501311ad8609f1ba7911acbb74d6fe5d0bf4295`. This upgrade covers all
six workspace manifests, their transitive lockfile resolutions, CI actions, and
the media container's pinned tools.

## Selected versions

| Area | Selection |
| --- | --- |
| Local and CI toolchain | Node `24.20.0` LTS; pnpm `12.3.4`; TypeScript `6.0.3` |
| Workers test runtime | `@cloudflare/vitest-plugin` `1.1.4`; Miniflare `5.20260903.0-alpha`; Vitest `4.1.11` |
| Authentication | Better Auth, its Drizzle adapter, and the `auth` CLI `1.7.2` |
| GraphQL | `17.0.2` |
| Frontend | Latest compatible TanStack patches, Vite `8.2.2`, React plugin `6.1.1`, Nitro `3.0.260903-beta` |
| Source tooling | Oxlint and plugins `1.81.0`; Oxfmt `0.66.0`; Ultracite `7.10.8`; tsx `4.23.13` |
| Infrastructure | Alchemy `2.0.0-beta.76`; Effect family `4.0.0-rc.112`; mysql2 `3.24.3` |
| Database | Drizzle ORM and Kit `1.0.0-rc.5-ab785fc` |
| Media image | Node `24.20.0-bookworm-slim`, yt-dlp `2026.08.19`, FFmpeg `9.0.1` |
| CI actions | Checkout `7.0.1`, setup-node `7.0.0`, pnpm/action-setup `6.1.0`, each pinned to its verified commit |

The manifests and lockfile contain the complete exact selections. The image
retains a digest-pinned base, yt-dlp checksum verification, and FFmpeg signed-tag
and commit verification. The pnpm action release adds pnpm 12 support.

## Compatibility decisions

- Node 24 is the latest LTS line at the audit date. Node 26 is Current; the
  [Node release policy](https://nodejs.org/en/about/previous-releases) recommends
  an LTS line for production applications.
- TypeScript 7 does not yet provide the stable compiler API used by the
  repository's semantic architecture checks. TypeScript `6.0.3` is the latest
  release with that supported API. This avoids retaining a second compiler just
  for checks. See the [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  and [compiler API tracking issue](https://github.com/microsoft/TypeScript/issues/63703).
- The [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)
  has moved from `@cloudflare/vitest-pool-workers` to
  `@cloudflare/vitest-plugin`. Its `1.1.4` package requires Vitest `^4.1.0` and
  directly depends on Miniflare `5.20260903.0-alpha`. Both are adopted together;
  Vitest 5 is outside that supported peer range.
- Alchemy beta 76 and Effect rc 112 remain the current adopted upstream releases.
  Drizzle's exact release matches Alchemy's peer requirement; switching to its
  older stable or `beta` dist-tag would downgrade the repository. The existing
  exact-version Alchemy patch and its removal conditions in the
  [Alchemy review](alchemy-upgrade-review.md) remain applicable.
- The root explicitly supplies Zod `4.5.4` for Drizzle's shared optional peer.
  Without that declaration, pnpm selects different Zod peers for the same
  Drizzle version under Alchemy and the API, splitting its nominal class types
  at the Household database boundary. Cloudflare's own exact Zod dependency is
  preserved; no dependency override is required.
- Installation reports an optional `capnp-es@0.0.14` peer declaration for
  TypeScript `^5.7.3`. Its code generator is not used by this repository. The
  serializer is exercised through real Miniflare tests; no peer override hides
  the declaration.

## Source changes

Native Miniflare fixtures now declare worker manifests, environment bindings,
exports, and triggers through the version 5 configuration API. The manifest
uses an absolute module root and in-memory module contents. D1, KV, R2, Queue,
Workflow, and Durable Object identities and persistence paths remain explicit.
The Queue lost-acknowledgement fixture uses a native Worker RPC service binding
because Miniflare no longer supports `wrappedBindings`; it still accepts the
queue send before raising the intentional lost acknowledgement.

TypeScript 6 removes the need for the old disabled synthetic-import settings;
Node path imports use their default export. Oxfmt and Oxlint changes are limited
to the new formatting and lint requirements, including explicit void statements
inside asynchronous UI event handlers. The TypeScript override disables the
JavaScript redeclaration rule for valid paired type/value schema names; compiler
checks and the unsafe declaration-merging rule remain enabled. Two Worker host
fixtures retain their existing multiple-class exemption at the file scope where
the upgraded rule reports it.

GraphQL 17 is exercised by the existing provider document parsing tests. The
repository does not use the execution APIs with signature changes listed in the
[GraphQL 17 upgrade guide](https://www.graphql-js.org/upgrade-guides/v16-v17/).

Retained media manifests treat tool versions as nonempty producer provenance.
Their validity is independent of the binaries installed today. Existing
schema-v1 media/manifest pairs produced by FFmpeg `8.1.2` and yt-dlp `2026.07.04`
remain readable with their original checksums and retention bounds. New
acquisitions record the current pinned versions. Real R2 regressions cover both
generations of tool provenance through the same reader.

## Verification record

Verification used Node `24.20.0` and pnpm `12.3.4`. The independent complete run
used `5ac6bcae5b4b81390050d04217ebf6f19ca1e42c`. The subsequent correction at
`220337f2c45d0c8e37947e7f4a497422d8069fbf` changes only retained tool-provenance
decoding and its R2 regression coverage.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed in the independent verification checkout. |
| `pnpm format:check`, `pnpm lint`, `pnpm check` | Passed independently on the upgrade; passed again after the provenance correction. |
| `pnpm test` | 1,071 tests passed across 99 files with no skips: 129 infrastructure, 55 shared-package, 95 web, and 792 API tests. Includes real authentication, D1, R2, Durable Object, Queue, and Workflow behaviour. |
| `pnpm build` | Passed for every workspace package. |
| `pnpm exec ultracite doctor` | Passed. |
| `pnpm --filter @meal-planner/api exec vitest run src/features/imports/import-media-r2.worker.test.ts src/features/imports/import-acquisition-checkpoint.test.ts` | 29 tests passed independently after the provenance correction. Before the fix, the new regression rejected the prior tool versions while accepting the current versions. |
| `pnpm auth:db:generate`, `pnpm db:generate`, `pnpm --filter @meal-planner/api household:db:generate` | No schema changes or new migrations. |
| Built Nitro browser check | Passed anonymous SSR, hydration, asset loading, and browser-error checks against synthetic anonymous API responses. |
| `pnpm test:container` | One real-image test passed in 1,112.63 seconds, covering installed tool versions, nonroot execution, temporary-directory isolation, network restrictions, media processing, and cleanup. The Dockerfile/runtime are unchanged by the provenance correction. |

`pnpm auth:schema:generate` is **not** a no-diff pass. Both the base
`auth@1.7.0-rc.6` and upgraded `auth@1.7.2` CLI exit successfully but emit an
additional `id: text("id")` after the invitation's `inviterId`, duplicating its
existing primary-key field. Their raw outputs are byte-identical: 6,744 bytes,
SHA-256 `8510ae92408d4e835994acaed2369f682339eb4eca4479e87ee7ba4366174b9d`.
The configured invitation ID is required by the existing caller-supplied-ID
contract, which remains covered by the authentication worker tests. The
[upstream generator](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/cli/src/generators/drizzle.ts#L282-L290)
emits both a primary ID and every configured field. This inherited generator
limitation does not introduce schema drift in this upgrade; the checked-in
canonical schema and all migrations remain unchanged. No generator patch or
normalization path was added.

No provider requests, deployment, publication, production compatibility-date
change, or applied migration edits are included in this upgrade. The browser
proof covers the built anonymous entry flow; authenticated runtime behaviour
is covered by the real Worker integration suite.
