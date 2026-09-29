import {
  EmailAddress,
  HouseholdOrganizationId,
  InvitationId,
  UserId,
} from "@meal-planner/household-api";
import type * as Cloudflare from "alchemy/Cloudflare";
import type { BaseRuntimeContext } from "alchemy/RuntimeContext";
import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
import { beforeAll, expect, it } from "vitest";

import {
  EmailDeliveryUnavailable,
  makeCloudflareEmailSender,
} from "../email/index.js";
import { makeHouseholdInvitationMailer } from "../households/people/invitation-mail.adapter.js";
import { renderInvitationMail } from "../households/people/invitation-mail.js";
import { renderPasswordResetMail } from "./auth-mail.js";
import * as authSchema from "./auth.database-schema.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerAuthDatabase,
    testEnv.AUTH_TEST_MIGRATIONS
  );
});

const recipient = Schema.decodeUnknownSync(EmailAddress)(
  "recipient@example.test"
);
const senderAddress = Schema.decodeUnknownSync(EmailAddress)(
  "noreply@mail.e2e.ceird.app"
);
const runtimeContext: BaseRuntimeContext = {
  Type: "test",
  env: {},
  // eslint-disable-next-line unicorn/no-useless-undefined -- Alchemy uses undefined for an absent binding.
  get: () => Effect.succeed(undefined),
  id: "auth-mail-test",
  set: (id) => Effect.succeed(id),
};

it("renders escaped invitation content and both actionable formats in Workerd", async () => {
  const url = "https://ceird.app/invitation/synthetic-id";
  const mail = await renderInvitationMail({
    email: recipient,
    familyName: "Morgan <script>",
    inviterName: "Alex & Sam",
    url,
  });

  expect(mail.subject).toBe("You’re invited to Meal Planner");
  expect(mail.html).toContain("Morgan &lt;script&gt;");
  expect(mail.html).toContain("Alex &amp; Sam");
  expect(mail.html).not.toContain("<script>");
  expect(mail.html).toContain(url);
  expect(mail.text).toContain(url);
  expect(mail.text).toContain("48 hours");
});

it("renders the Better Auth reset URL without losing its query string", async () => {
  const url =
    "https://ceird.app/api/auth/reset-password/synthetic?callbackURL=%2Freset-password&source=mail";
  const mail = await renderPasswordResetMail({ email: recipient, url });

  expect(mail.subject).toBe("Reset your Meal Planner password");
  expect(mail.html).toContain(url.replaceAll("&", "&amp;"));
  expect(mail.text).toContain(url);
  expect(mail.text).toContain("1 hour");
});

it("reads canonical family and inviter names before submitting a linked invitation", async () => {
  const database = drizzle(testEnv.MealPlannerAuthDatabase);
  const suffix = crypto.randomUUID();
  const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
    `family-${suffix}`
  );
  const inviterId = Schema.decodeUnknownSync(UserId)(`inviter-${suffix}`);
  const invitationId = Schema.decodeUnknownSync(InvitationId)(
    `invitation-${suffix}`
  );
  await database.insert(authSchema.organization).values({
    createdAt: new Date(),
    id: organizationId,
    name: "the Morgan family",
    slug: `morgan-${suffix}`,
  });
  await database.insert(authSchema.user).values({
    createdAt: new Date(),
    email: `inviter-${suffix}@example.test`,
    emailVerified: false,
    id: inviterId,
    name: "Alex",
    updatedAt: new Date(),
  });
  const sent: string[] = [];
  const sendInvitation = makeHouseholdInvitationMailer({
    baseURL: "https://ceird.app",
    database,
    send: (mail) => {
      sent.push(mail.text);
      return Promise.resolve();
    },
  });

  await Effect.runPromise(
    sendInvitation({
      email: recipient,
      invitationId,
      inviterId,
      organizationId,
    })
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("Alex invited you to join the Morgan family");
  expect(sent[0]).toContain(`https://ceird.app/invitation/${invitationId}`);
});

it("submits HTML and text through the Cloudflare binding without leaking provider errors", async () => {
  const submitted: unknown[] = [];
  const sender = makeCloudflareEmailSender(
    {
      send: (message) => {
        submitted.push(message);
        return Effect.succeed({ messageId: "synthetic-provider-id" });
      },
    },
    runtimeContext,
    true,
    senderAddress
  );
  const mail = await renderPasswordResetMail({
    email: recipient,
    url: "https://ceird.app/reset-password?token=synthetic",
  });

  await sender(mail);
  expect(submitted).toEqual([
    {
      from: { email: senderAddress, name: "Meal Planner" },
      html: mail.html,
      subject: mail.subject,
      text: mail.text,
      to: recipient,
    },
  ]);

  const failing = makeCloudflareEmailSender(
    {
      send: () =>
        Effect.fail({
          _tag: "SendEmailError",
          message: "private reset URL appeared in provider error",
        } as Cloudflare.Email.SendEmailError),
    },
    runtimeContext,
    true,
    senderAddress
  );
  await expect(failing(mail)).rejects.toMatchObject({
    _tag: EmailDeliveryUnavailable.name,
  });
  await expect(failing(mail)).rejects.not.toThrow(
    "private reset URL appeared in provider error"
  );

  const disabled = makeCloudflareEmailSender(
    {
      send: () => Effect.die("Disabled delivery invoked the provider"),
    },
    runtimeContext,
    false,
    senderAddress
  );
  await expect(disabled(mail)).rejects.toMatchObject({
    _tag: EmailDeliveryUnavailable.name,
  });
});
