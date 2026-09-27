import { Schema } from "effect";

import { expect, test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";
import { InvitationPage } from "./pages/invitation-page.js";

test("saves a family and corrections across page loads, then completes setup", async ({
  page,
  browser,
}) => {
  await new AuthPage(page).signUp(
    "Organizer",
    `organizer-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("The browser family");
  const reviewURL = page.url();
  const familyId = new URL(reviewURL).searchParams.get("familyId");
  expect(familyId).toBeTruthy();
  const responses = await Promise.all(
    ["/v1/families", `/v1/families/${familyId}/people`].map((path) =>
      page.request.get(path)
    )
  );
  for (const response of responses) {
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  const html = await page.request.get(reviewURL);
  expect(html.headers()["cache-control"]).toContain("no-store");
  const serverOnly = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  try {
    const initial = await serverOnly.newPage();
    await initial.goto(reviewURL);
    await expect(
      initial.getByRole("button", { exact: true, name: "Log out" })
    ).toBeDisabled();
    await expect(
      initial.getByRole("button", { exact: true, name: "Manage Organizer" })
    ).toBeDisabled();
  } finally {
    await serverOnly.close();
  }
  await family.addAdult("Alex");
  await family.rename("Alex", "Alexandra");
  await page.reload();
  await family.expectReview();
  await expect(page.getByText("Alexandra", { exact: true })).toBeVisible();
  await family.confirm();
  await page.goto(reviewURL);
  await family.expectReview();
  await family.rename("Alexandra", "Alex");
});

test("reconciles a committed creation after its response is lost without creating another family", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Recovery organizer",
    `recovery-${crypto.randomUUID()}@example.test`
  );
  const commands: unknown[] = [];
  await page.route("**/v1/families", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    commands.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await (commands.length === 1
      ? route.abort("failed")
      : route.fulfill({ response }));
  });
  const family = new FamilyPage(page);
  await family.create("Recovered family");
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  await page.reload();
  await family.expectReview();
  const families = await page.request.get("/v1/families");
  expect(await families.json()).toMatchObject([{ name: "Recovered family" }]);
});

test("requires the invited account and explicit acceptance before joining the saved family", async ({
  page,
  browser,
}) => {
  const email = `recipient-${crypto.randomUUID()}@example.test`;
  await new AuthPage(page).signUp(
    "Invitation organizer",
    `inviter-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Invitation family");
  const reviewURL = page.url();
  await family.addAdult("Recipient");
  await family.invite(email);
  const mail = await page.request.get(
    `/__test/mail?email=${encodeURIComponent(email)}`
  );
  expect(mail.ok()).toBe(true);
  const invitation = Schema.decodeUnknownSync(
    Schema.Struct({ kind: Schema.Literal("invitation"), url: Schema.String })
  )(await mail.json());
  const invitationPage = new InvitationPage(page);
  await invitationPage.open(invitation.url);
  await invitationPage.expectWrongAccount();
  const recipientContext = await browser.newContext({
    extraHTTPHeaders: { "x-test-client-ip": "198.51.100.1" },
  });
  try {
    const recipientPage = await recipientContext.newPage();
    await new AuthPage(recipientPage).signUp("Recipient", email);
    const recipientInvitation = new InvitationPage(recipientPage);
    await recipientInvitation.open(invitation.url);
    await expect(
      recipientPage.getByRole("button", { name: "Join family" })
    ).toBeVisible();
    // Loading an invitation does not itself accept it.
    const before = await recipientPage.request.get("/v1/families");
    expect(await before.json()).toEqual([]);
    await recipientInvitation.accept();
    await expect(
      recipientPage.getByText("Recipient", { exact: true })
    ).toBeVisible();
    await page.goto(reviewURL);
    await family.expectReview();
    await expect(
      page.getByRole("button", { name: "Invite again" })
    ).toBeHidden();
  } finally {
    await recipientContext.close();
  }
});

test("resets a password through local mail and returns to the same saved family", async ({
  page,
}) => {
  const email = `reset-${crypto.randomUUID()}@example.test`;
  const auth = new AuthPage(page);
  const family = new FamilyPage(page);
  await auth.signUp("Reset organizer", email);
  await family.create("Still here");
  const reviewURL = page.url();
  await auth.logout();
  await auth.requestPasswordReset(email);
  const mail = await page.request.get(
    `/__test/mail?email=${encodeURIComponent(email)}`
  );
  expect(mail.ok()).toBe(true);
  const reset = Schema.decodeUnknownSync(
    Schema.Struct({ kind: Schema.Literal("reset"), url: Schema.String })
  )(await mail.json());
  await auth.resetPassword(reset.url, "New-family-password-73!");
  await auth.login(email, "New-family-password-73!");
  await expect(page).not.toHaveURL(/\/login/u);
  await page.goto(reviewURL);
  await family.expectReview();
  await expect(
    page.getByText("Reset organizer", { exact: true })
  ).toBeVisible();
});

test("SSR forms cannot submit before hydration", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/signup");
    await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { exact: true, name: "Create account" })
    ).toBeDisabled();
    await expect(page.getByRole("form")).toHaveAttribute("method", "post");
  } finally {
    await context.close();
  }
});
