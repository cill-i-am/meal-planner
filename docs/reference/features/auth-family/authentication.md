# Authentication and recovery

## Sub-features

- Email/password signup and login, password visibility, validation, and pending/error states.
- Same-origin return destinations through login, signup, and password recovery.
- Logout and account switching from setup and invitation screens.
- Reset-link request, invalid link, new password, and return to login.

## How to get to it (user POV)

Open `/login`, or follow an authenticated route while signed out. Select
**Create an account** to open `/signup`; **Log in** returns to login.
**Forgot password?** opens `/forgot-password`. A reset link opens
`/reset-password?token=…`. Opening `/reset-password` without a token shows
**This reset link is no longer valid** and **Request a new link**.

Setup exposes **Log out**. An invitation exposes **Switch account**, preserving
that invitation as the return destination. A valid `redirect` search value carries
a local destination; external origins and auth-page loops are rejected.

## Driving it with agent-browser

Use [the shared runtime and evidence setup](README.md#launch-and-establish-what-you-can-prove).
Take a snapshot after every navigation and act on its named controls.

| Path | Drive | Proof |
| --- | --- | --- |
| Signup | Fill **Your name**, **Email**, **Password**; select **Create account** using a disposable account | Auth succeeds, the requested local destination opens, and account identity survives reload |
| Login | Fill **Email** and **Password**; select **Log in** | Expected account appears; reload preserves the session |
| Validation/rejection | Submit invalid email or insufficient password; then use a known wrong password | Relevant feedback appears; no authenticated navigation or false success |
| Password visibility | Use **Show password**, then **Hide password** | Input visibility changes without changing its value |
| Return destination | Open `/login?redirect=%2Fsetup`, visit signup/recovery, then log in | Links retain the destination and success returns to setup |
| Unsafe return | Open login with an external or protocol-relative redirect | Navigation remains in the app |
| Logout | Select **Log out** from setup; reopen its protected URL | Login is required and the previous account's family is not shown |
| Request reset | Fill **Email**, select **Send reset link** | **Check your email** appears for accepted requests; record delivery separately |
| Reset password | Use a valid test reset link; fill **New password** and **Confirm new password**, then **Save new password** | **Password updated**, token removed from URL, new password works at login; old sessions are revoked |
| Invalid reset | Open without a token, with an expired token, or reuse a consumed token | Invalid-link state; **Request a new link** leads to recovery |

For an account change in another tab, refresh or refocus the first tab and confirm
that stale protected data is cleared or access is blocked before another write.
Use the [cross-feature journey](journeys.md) for the whole isolation check.

## Gotchas

The reset form is implemented. Default server mail callbacks are mocks, so a
success screen cannot demonstrate email delivery. Test valid-token behavior only
with an authorized test-mail capture or known test fixture; do not print tokens.
Missing mailbox access is a missing prerequisite, not a passing delivery check.

Controls disable during pending operations and rate-limit waits. Verify recovery
from those states when the change affects retries. Do not replace authentication
with a mocked account and claim session/cookie behavior was tested.

Owners: [browser auth](../../../../apps/web/src/features/auth/AGENTS.md),
[recovery](../../../../apps/web/src/features/recovery/AGENTS.md), and
[server auth](../../../../apps/api/src/features/auth/AGENTS.md).
Source checks: auth route/navigation/boundary tests, recovery input/operation tests,
and native [auth tests](../../../../apps/api/src/features/auth/auth.worker.test.ts).
