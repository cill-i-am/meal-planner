# Deliver invitation and password-reset email

Status: done
Owner: authentication and household people
Scope: application code, Paper designs, local verification, repository delivery, and E2E activation on `e2e.ceird.app`. Production activation remains a separate operation.
Design: [Transactional email in Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-F-0).

## Outcome

Send actionable invitation and password-reset messages from `noreply@mail.e2e.ceird.app` in E2E. Use React Email for HTML and plain text, Cloudflare Email Sending's Worker binding for submission, and Alchemy for the binding and sending domain. Keep the saved invitation and reset token with their existing owners.

## Boundaries and decisions

- Better Auth creates and consumes reset tokens and invitation records. Its reset callback renders and submits mail. The household people command submits invitation mail only after the person is associated with the invitation. An interrupted command reuses the invitation ID.
- `features/email` owns the shared message layout, rendering and Cloudflare adapter. Server auth owns reset content. Household people owns invitation content and the read of family/inviter display names. The Worker composes the dependencies; no browser mail endpoint is added.
- Both formats include the action URL. The templates state the configured 1-hour reset and 48-hour invitation expiry. The Paper page **Transactional email** has standard and narrow variants for both. Its actions follow the primary button on Paper's **Overview** page: 48px high, pill shaped, 15px semibold text, dark gradient, and subtle depth. Email HTML retains a solid color fallback where clients omit the gradient or shadow.
- React Email's components gallery informed the layouts. The application uses the installed `react-email` package's components, `render`, and `toPlainText`; Workerd tests check this combination.
- The binding permits arbitrary recipients and restricts the sender to `MEAL_PLANNER_EMAIL_SENDER_ADDRESS`. E2E uses `noreply@mail.e2e.ceird.app`; the existing default is `noreply@mail.ceird.app`. Each stage that provisions a sending domain uses a distinct subdomain because Cloudflare manages it at the account level.
- Runtime delivery is gated off by default. First provision and verify the stage's sending domain, disable Cloudflare's default Email preview, then enable delivery for that stage.
- Cloudflare accepting a message is submission evidence, not proof of inbox delivery. The reset request retains a generic confirmation for known and unknown addresses. An invitation send failure returns an unavailable response after the saved association; retrying the same command can resend the same invitation.

## Acceptance and evidence

- [x] React Email renders HTML and text in Workerd; dynamic names are escaped and the action URL survives rendering.
- [x] Cloudflare adapter submits both formats and returns a safe error without message content.
- [x] Native household recovery test observes no send before association and a send after retry with the same invitation ID.
- [x] A provider failure after association can be retried with the same invitation record.
- [x] PR #257's five local browser journeys pass after its mail fixture moved to the household send boundary.
- [x] Full repository checks and review passed at the delivery commit in PR #258.
- [x] The repository change was merged in PR #258.
- [x] The E2E operation verified the target account, Workers Paid eligibility, active `ceird.app` zone and enabled `mail.e2e.ceird.app` sender. The sending-domain API confirms `preview_enabled: false` before the delivery flag was enabled for the API release.
- [x] On 30 September 2026, user-controlled mailbox aliases received both messages in the inbox. The reset message passed SPF, DKIM and DMARC; its link changed the password, revoked the old session and rejected reuse. Invitation signup returned to the saved invitation, acceptance linked the existing adult, and Continue opened the correct family workspace. Provider submission and inbox receipt were verified separately; no token URLs are recorded here.

## Activation

Follow [Alchemy operations](../how-to/operate-infrastructure.md#transactional-email) for the account and stage checks. The E2E deployment needs `CEIRD_ZONE_ID` from the verified `ceird.app` zone and `MEAL_PLANNER_EMAIL_SENDER_ADDRESS=noreply@mail.e2e.ceird.app`. Do not infer the account or run an Alchemy plan solely to discover it. Production mail remains unverified.

## References

- [React Email render and plain text](https://react.email/docs/utilities/render)
- [Cloudflare Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare sending subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/)
- [Cloudflare pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Cloudflare email preview](https://developers.cloudflare.com/email-service/observability/logs/#message-preview)
- [Cloudflare sending subdomain preview API](https://developers.cloudflare.com/api/resources/email_sending/subresources/subdomains/methods/edit/)
