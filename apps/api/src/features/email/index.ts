import type { EmailAddress } from "@meal-planner/household-api";
import type * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import type { BaseRuntimeContext } from "alchemy/RuntimeContext";
import { Data, Effect } from "effect";
import type { ReactElement } from "react";
import { render, toPlainText } from "react-email";

export {
  Action,
  EmailFrame,
  bodyStyle,
  headingStyle,
  noteStyle,
} from "./email-layout.js";

export interface OutboundEmail {
  readonly to: EmailAddress;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export class EmailDeliveryUnavailable extends Data.TaggedError(
  "EmailDeliveryUnavailable"
)<Record<string, never>> {}

export const renderEmail = async ({
  element,
  subject,
  to,
}: {
  readonly element: ReactElement;
  readonly subject: string;
  readonly to: EmailAddress;
}): Promise<OutboundEmail> => {
  const html = await render(element);
  return { html, subject, text: toPlainText(html), to };
};

/** Cloudflare binding adapter; provider diagnostics never include mail content. */
export const makeCloudflareEmailSender =
  (
    client: Pick<Cloudflare.Email.SendClient, "send">,
    runtimeContext: BaseRuntimeContext,
    enabled: boolean
  ) =>
  (mail: OutboundEmail): Promise<void> => {
    if (!enabled) {
      return Effect.runPromise(Effect.fail(new EmailDeliveryUnavailable({})));
    }
    return Effect.runPromise(
      client
        .send({
          from: { email: "noreply@mail.ceird.app", name: "Meal Planner" },
          html: mail.html,
          subject: mail.subject,
          text: mail.text,
          to: mail.to,
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError(() => new EmailDeliveryUnavailable({})),
          Effect.provideService(RuntimeContext, runtimeContext)
        )
    );
  };
