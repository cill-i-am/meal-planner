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

Signup introduces the family journey with a food image and the account form. On
desktop the story sits beside the form; on mobile it becomes a short header above
the fields. Login and recovery use centered, plain forms. The [connected entry
design](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-J-0)
shows the default screens; the [implementation states](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-K-0)
show validation, rejected and pending login, reset confirmation, invalid links,
and new-password entry. The Paper boards are design references, not evidence of
runtime behavior.

Setup exposes **Log out**. If the account itself cannot load, its status screen
offers **Log out and sign in again** as a recovery action. It returns to login
with the protected route preserved, so successful login can resume setup. An
invitation exposes **Switch account** and preserves the invitation as the return
destination. A valid `redirect` search value carries a local destination;
external origins and auth-page loops are rejected.

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
| Account read failure | Keep a session, fail the account read, then choose **Log out and sign in again** | The account cache clears, login retains the safe setup destination, and successful authentication resumes setup |
| Request reset | Fill **Email**, select **Send reset link** | **Check your email** appears for accepted requests; record delivery separately |
| Reset password | Use a valid test reset link; fill **New password** and **Confirm new password**, then **Save new password** | **Password updated**, token removed from URL, new password works at login; old sessions are revoked |
| Invalid reset | Open without a token, with an expired token, or reuse a consumed token | Invalid-link state; **Request a new link** leads to recovery |

For an account change in another tab, refresh or refocus the first tab and confirm
that stale protected data is cleared or access is blocked before another write.
Use the [cross-feature journey](journeys.md) for the whole isolation check.

## Email ownership

The shared email feature owns layout, HTML/text rendering, and the Cloudflare
adapter. Auth owns password-reset content. Household people owns invitation
content and submits it after association. A failed submission preserves the
invitation and permits retry with the same invitation identity.

## Gotchas

The reset form is implemented. Production auth supplies React Email content to
the Cloudflare send binding after the delivery gate is enabled. The generic
**Check your email** screen still cannot demonstrate inbox delivery. Test valid-token behavior only with an authorized test-mail
capture or known test fixture; do not print tokens. Missing mailbox access is a
missing prerequisite, not a passing delivery check.

Controls disable during pending operations and rate-limit waits. Verify recovery
from those states when the change affects retries. Do not replace authentication
with a mocked account and claim session/cookie behavior was tested.
Login and signup cancel an in-flight anonymous account read before the credential
write, then refresh the account query after success. If a stale read finishes
later, it must not send the new account back to login. The browser-mode auth
route test holds that read open to exercise this order; the native journey checks
the cookie and redirect path.

Owners: [browser auth](../../../../apps/web/src/features/auth/AGENTS.md),
[recovery](../../../../apps/web/src/features/recovery/AGENTS.md), and
[server auth](../../../../apps/api/src/features/auth/AGENTS.md).
Source checks: auth route/navigation/boundary tests, recovery input/operation tests,
and native [auth tests](../../../../apps/api/src/features/auth/auth.worker.test.ts).

## Browser regression coverage

Authentication and recovery mutation options use the shared stateless Effect
Query adapter. Better Auth still owns native commands; these features own retry
windows, safe return destinations, and account refresh. Passwords and reset
tokens remain transient.

[Playwright journeys](../../../../apps/web/e2e/family-journey.spec.ts) exercise
signup and password reset through native local Workers. A JavaScript-disabled
browser also checks that SSR credential fields and submission stay disabled until
hydration. Resetting submitted fields must preserve the success screen; clearing
old feedback on edits applies only to failed mutations.


[Multi-tab journeys](../../../../apps/web/e2e/account-concurrency.spec.ts) cover
logout, account switching with an unsent form, expiry while a write is in flight,
and retry after login. The expiry fixture changes the real D1 session; it does
not replace the API response. The original tab retains the exact submitted
command in memory while login opens in another tab. If you close or reload the
original tab, inspect saved server data before making a new change.

TanStack Query rechecks identity on `visibilitychange`. Headless browsers keep
pages visible, so the page object delivers this browser event explicitly. Cookies,
account reads, and cache isolation still use the real runtime.

## Native account storage

The Alchemy beta.80 adapter requires Better Auth 1.7.5. Its native account schema
uses `providerId` and `accountId`; the former `issuer` field is removed by a
Drizzle migration. The app retains a unique index on the native identity pair
for atomic password reset. Existing account credentials and sessions are
preserved; conflicting historical identities fail migration rather than being
discarded. Local migration tests and native reset tests verify this boundary.
