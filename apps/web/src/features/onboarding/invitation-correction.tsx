import type { SetupCheckpoint } from "@meal-planner/household-api";
import { Schema } from "effect";

import { useAppForm } from "../../components/forms/form.js";
import { Button } from "../../components/ui/button.js";
import {
  CardBody,
  CardHeader,
  CardDescription,
  CardContent,
  CardFooter,
} from "../../components/ui/card.js";
import { FieldGroup } from "../../components/ui/field.js";
import { InvitationEmailInput } from "./people-input.js";
import { SetupError, SetupFrame } from "./setup-ui.js";

const input = Schema.Struct({ email: InvitationEmailInput });
const validator = Schema.toStandardSchemaV1(input);
export const InvitationCorrectionForm = ({
  checkpoint,
  busy,
  error,
  submit,
  logout,
  cancel,
}: {
  readonly checkpoint: Extract<
    SetupCheckpoint,
    { stage: "person-invite-draft" }
  >;
  readonly busy: boolean;
  readonly error: boolean;
  readonly submit: (email: string) => Promise<void>;
  readonly logout: (email: string) => void;
  readonly cancel: () => void;
}) => {
  const form = useAppForm({
    defaultValues: { email: checkpoint.email },
    onSubmit: ({ value }) =>
      submit(Schema.decodeUnknownSync(input)(value).email),
    validators: { onChange: validator, onSubmit: validator },
  });
  const message = {
    already_invited:
      "An invitation is already waiting for this email. Use a different email, or review your family before inviting again.",
    already_member:
      "This email already belongs to someone in your family. Use a different email for this person, or return to review your family.",
    forbidden:
      "Only the family organiser can invite people. Their profile is saved; ask the organiser to finish the invitation.",
    invalid_email: "Check their email address and try again.",
    limit:
      "Your family has too many pending invitations. Review your family before inviting again.",
    not_sent:
      "There isn’t an invitation for this person yet. Enter their email to invite them.",
  }[checkpoint.reason];
  return (
    <SetupFrame
      step="people"
      action={
        <Button
          variant="link"
          disabled={busy}
          onClick={() => logout(form.state.values.email)}
        >
          Log out
        </Button>
      }
    >
      <form.AppForm>
        <form.Frame className="max-w-140" size="sm" pending={busy}>
          <CardBody>
            <CardHeader>
              <form.Heading
                rejected={false}
                errorTitle="Check their invitation"
              >
                Check their invitation
              </form.Heading>
              <CardDescription>
                {checkpoint.displayName}’s profile is saved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SetupError>{message}</SetupError>
              <FieldGroup>
                <form.AppField name="email">
                  {(field) => (
                    <field.TextField
                      id="invitation-email"
                      label="Email"
                      type="email"
                      autoComplete="off"
                      maxLength={254}
                      disabled={busy}
                    />
                  )}
                </form.AppField>
              </FieldGroup>
              {error && (
                <SetupError>We couldn’t save your place. Try again.</SetupError>
              )}
              <Button
                type="submit"
                disabled={busy || checkpoint.reason === "forbidden"}
              >
                {busy ? "Saving…" : "Invite this person"}
              </Button>
            </CardContent>
          </CardBody>
          <CardFooter>
            <Button variant="link" disabled={busy} onClick={cancel}>
              Review your family
            </Button>
          </CardFooter>
        </form.Frame>
      </form.AppForm>
    </SetupFrame>
  );
};
