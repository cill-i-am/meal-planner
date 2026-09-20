# Onboarding design snapshots

These exports preserve the Paper baseline reviewed on 20 September 2026. [Live Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0) remains the source of truth. Check the live designs before changing UI. These images document intended screens; they are not screenshots of the running application.

Sky outside desktop windows represents desktop wallpaper. It is not part of the application. The app begins at the white viewport; do not implement the outer framing or phone status bars. Mobile exports contain no sky strip.

The set contains 62 screen/state artboards and one component reference. Each row links matching desktop and mobile designs. [The manifest](../paper-onboarding-state.json) records source boards and SHA-256 checksums.

## Component reference

[View the themed shadcn component states](overview/component-states.webp).

## Auth

| Screen or state | Desktop | Mobile |
| --- | --- | --- |
| Screen 1 · Log in | [View](auth/desktop/screen-1-log-in.webp) | [View](auth/mobile/screen-1-log-in.webp) |
| Screen 2 · Create account | [View](auth/desktop/screen-2-create-account.webp) | [View](auth/mobile/screen-2-create-account.webp) |
| State 1 · Log in Validation | [View](auth/desktop/state-1-log-in-validation.webp) | [View](auth/mobile/state-1-log-in-validation.webp) |
| State 2 · Log in Rejected | [View](auth/desktop/state-2-log-in-rejected.webp) | [View](auth/mobile/state-2-log-in-rejected.webp) |
| State 3 · Signup Validation | [View](auth/desktop/state-3-signup-validation.webp) | [View](auth/mobile/state-3-signup-validation.webp) |

## Family

| Screen or state | Desktop | Mobile |
| --- | --- | --- |
| Screen 1 · Name family | [View](family/desktop/screen-1-name-family.webp) | [View](family/mobile/screen-1-name-family.webp) |
| Screen 2 · Review family | [View](family/desktop/screen-2-review-family.webp) | [View](family/mobile/screen-2-review-family.webp) |
| Screen 3 · Ready for discovery | [View](family/desktop/screen-3-ready-for-discovery.webp) | [View](family/mobile/screen-3-ready-for-discovery.webp) |
| State 1 · Name Validation | [View](family/desktop/state-1-name-validation.webp) | [View](family/mobile/state-1-name-validation.webp) |
| State 2 · Name Saving | [View](family/desktop/state-2-name-saving.webp) | [View](family/mobile/state-2-name-saving.webp) |
| State 3 · Name Check save | [View](family/desktop/state-3-name-check-save.webp) | [View](family/mobile/state-3-name-check-save.webp) |
| State 4 · Review One person | [View](family/desktop/state-4-review-one-person.webp) | [View](family/mobile/state-4-review-one-person.webp) |
| State 5 · Review Unavailable | [View](family/desktop/state-5-review-unavailable.webp) | [View](family/mobile/state-5-review-unavailable.webp) |
| State 6 · Setup saved | [View](family/desktop/state-6-setup-saved.webp) | [View](family/mobile/state-6-setup-saved.webp) |

## People

| Screen or state | Desktop | Mobile |
| --- | --- | --- |
| Screen 1 · Add and invite adult | [View](people/desktop/screen-1-add-and-invite-adult.webp) | [View](people/mobile/screen-1-add-and-invite-adult.webp) |
| Screen 2 · Add dependant | [View](people/desktop/screen-2-add-dependant.webp) | [View](people/mobile/screen-2-add-dependant.webp) |
| State 1 · Adult Validation | [View](people/desktop/state-1-adult-validation.webp) | [View](people/mobile/state-1-adult-validation.webp) |
| State 2 · Dependant Validation | [View](people/desktop/state-2-dependant-validation.webp) | [View](people/mobile/state-2-dependant-validation.webp) |
| State 3 · Adult Finish invitation | [View](people/desktop/state-3-adult-finish-invitation.webp) | [View](people/mobile/state-3-adult-finish-invitation.webp) |

## Invitations

| Screen or state | Desktop | Mobile |
| --- | --- | --- |
| Screen 1 · Join or decline | [View](invitations/desktop/screen-1-join-or-decline.webp) | [View](invitations/mobile/screen-1-join-or-decline.webp) |
| State 1 · Wrong account | [View](invitations/desktop/state-1-wrong-account.webp) | [View](invitations/mobile/state-1-wrong-account.webp) |
| State 2 · Unavailable invitation | [View](invitations/desktop/state-2-unavailable-invitation.webp) | [View](invitations/mobile/state-2-unavailable-invitation.webp) |
| State 3 · Invitation declined | [View](invitations/desktop/state-3-invitation-declined.webp) | [View](invitations/mobile/state-3-invitation-declined.webp) |
| State 4 · Finish profile linking | [View](invitations/desktop/state-4-finish-profile-linking.webp) | [View](invitations/mobile/state-4-finish-profile-linking.webp) |

## Recovery

| Screen or state | Desktop | Mobile |
| --- | --- | --- |
| Screen 1 · Request reset Proposed | [View](recovery/desktop/screen-1-request-reset-proposed.webp) | [View](recovery/mobile/screen-1-request-reset-proposed.webp) |
| Screen 2 · Check email | [View](recovery/desktop/screen-2-check-email.webp) | [View](recovery/mobile/screen-2-check-email.webp) |
| Screen 3 · New password | [View](recovery/desktop/screen-3-new-password.webp) | [View](recovery/mobile/screen-3-new-password.webp) |
| Screen 4 · Password updated | [View](recovery/desktop/screen-4-password-updated.webp) | [View](recovery/mobile/screen-4-password-updated.webp) |
| State 1 · Email Validation | [View](recovery/desktop/state-1-email-validation.webp) | [View](recovery/mobile/state-1-email-validation.webp) |
| State 2 · New password Validation | [View](recovery/desktop/state-2-new-password-validation.webp) | [View](recovery/mobile/state-2-new-password-validation.webp) |
| State 3 · Reset unavailable | [View](recovery/desktop/state-3-reset-unavailable.webp) | [View](recovery/mobile/state-3-reset-unavailable.webp) |
