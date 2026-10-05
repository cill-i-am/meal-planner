# Browser account feature

Own account identity, native Better Auth client access, login/signup, safe return paths, and account changes. Export cross-feature access through [index.ts](index.ts). [AccountProvider](account-context.tsx) supplies an account without loading a family.

The router creates an auth client for each SSR request. The account query caches only a public identity projection; session tokens stay out of dehydrated data. Native login, family selection, and logout refresh or clear that query; window focus rechecks it.

If the account query fails, offer retry and sign-out from the account status screen. The setup route also offers sign-out from its route-level error screen, because loader failures can happen after account loading succeeds. A failed read prevents setup's header logout from rendering. Sign-out must clear account-scoped queries and return to login with the original same-origin route, so successful login can resume setup. Keep sign-out failures visible on the status screen.

Keep native identity operations on Better Auth's client. Account changes must clear or invalidate account-scoped remote data before another account can see it. Preserve same-origin redirect validation and the identity/query boundary. Do not introduce family or onboarding dependencies into this slice.

Authentication mutation options use the API transport feature's stateless `apiEffectQuery` adapter. Native Better Auth commands, retry windows, account refresh, and domain failures remain owned here.

Use [the auth map](../../../../../docs/reference/features/auth-family/authentication.md) for visible paths and proof. [Recovery](../recovery/AGENTS.md) uses this account boundary; [family](../family/AGENTS.md) and [invitations](../invitations/AGENTS.md) compose it. Shared visual components must not import these product features.

[account-query.ts](account-query.ts) is the frontend read owner. Login, setup, recovery, and application entry use its account query; organization reads use account-scoped Query keys. Do not add a second subscription through Better Auth's React session or organization hooks. Keep Better Auth's native commands and refresh the owning queries after those commands succeed. Cancel an in-flight anonymous account read before starting a login or signup command. A read started before the credential write can otherwise finish later with `null` and displace the new session. Refresh the account query after the native command succeeds.
