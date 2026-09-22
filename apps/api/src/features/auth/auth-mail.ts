export interface InvitationMail {
  readonly email: string;
  readonly url: string;
}

// MOCK(email): outbound delivery is deliberately not connected yet. Better Auth still
// creates real invitation records; local tests capture this callback instead of sending mail.
// Replace this adapter with the configured mail provider before enabling delivery.
export const mockInvitationMail = (_mail: InvitationMail): Promise<void> =>
  Promise.resolve();
