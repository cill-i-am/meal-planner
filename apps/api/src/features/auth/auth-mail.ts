export interface InvitationMail {
  readonly email: string;
  readonly url: string;
}

// MOCK(email): outbound delivery is deliberately not connected yet. Better Auth still
// creates real invitation records; local tests capture this callback instead of sending mail.
// Replace this adapter with the configured mail provider before enabling delivery.
export const mockInvitationMail = (_mail: InvitationMail): Promise<void> =>
  Promise.resolve();

export interface PasswordResetMail {
  readonly email: string;
  readonly url: string;
}

// MOCK(email): only delivery is mocked. Better Auth generates, expires and consumes
// real single-use reset tokens. Tests capture this callback; never log reset URLs.
export const mockPasswordResetMail = (
  _mail: PasswordResetMail
): Promise<void> => Promise.resolve();
