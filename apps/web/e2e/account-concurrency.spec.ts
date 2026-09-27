import { test, expect } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";

test("logout in another tab removes private family data when the tab is revisited", async ({
  page,
  context,
}) => {
  await new AuthPage(page).signUp(
    "Tab organizer",
    `tabs-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Private tab family");
  await family.addAdult("Private person");
  const second = await context.newPage();
  await second.goto(page.url());
  await new FamilyPage(second).expectReview();
  await new AuthPage(second).logout();
  await new AuthPage(page).revisit();
  await expect(
    page.getByRole("button", { exact: true, name: "Log in" })
  ).toBeVisible();
  await expect(page.getByText("Private person", { exact: true })).toBeHidden();
});

test("a competing rename shows the latest person without silently overwriting it", async ({
  page,
  context,
}) => {
  await new AuthPage(page).signUp(
    "Editing organizer",
    `edits-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Editing family");
  await family.addAdult("Jamie");
  const other = await context.newPage();
  await other.goto(page.url());
  const second = new FamilyPage(other);
  await second.expectReview();
  await second.openRename("Jamie");
  await page.bringToFront();
  await family.rename("Jamie", "Jamie updated");
  await other.bringToFront();
  await second.saveRename("Stale overwrite");
  await second.reviewConflict();
  await expect(other.getByText("Jamie updated", { exact: true })).toBeVisible();
  await expect(
    other.getByText("Stale overwrite", { exact: true })
  ).toBeHidden();
  await second.rename("Jamie updated", "Reviewed correction");
  await page.reload();
  await expect(
    page.getByText("Reviewed correction", { exact: true })
  ).toBeVisible();
});

test("an expired session rejects a write and the same command can be retried after login", async ({
  page,
  context,
}) => {
  const email = `expired-${crypto.randomUUID()}@example.test`;
  await new AuthPage(page).signUp("Expiry organizer", email);
  const family = new FamilyPage(page);
  await family.create("Expiry family");
  await family.openAddPerson();
  await family.fillPerson("One saved person");
  const commands: string[] = [];
  const submitted = Promise.withResolvers<null>();
  const release = Promise.withResolvers<null>();
  await page.route("**/v1/families/*/people", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    commands.push(route.request().postData() ?? "");
    if (commands.length === 1) {
      submitted.resolve(null);
      await release.promise;
    }
    await route.continue();
  });
  await family.submitPerson();
  await submitted.promise;
  try {
    const expired = await page.request.post("/__test/expire-session");
    expect(expired.status()).toBe(204);
  } finally {
    release.resolve(null);
  }
  await expect(page.getByRole("alert")).toContainText("Your session ended");
  expect(commands).toHaveLength(1);
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Log in in a new tab" }).click();
  const login = await opened;
  await new AuthPage(login).login(email, "Test-family-password-29!");
  await expect(
    login.getByRole("heading", { exact: true, name: "Add someone" })
  ).toBeVisible();
  await new AuthPage(page).revisit();
  await page
    .getByRole("button", { exact: true, name: "Check and continue" })
    .click();
  await family.expectReview();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  await page.reload();
  await expect(page.getByText("One saved person", { exact: true })).toHaveCount(
    1
  );
});

test("an account change in another tab clears the previous family and unsent fields", async ({
  page,
  context,
}) => {
  await new AuthPage(page).signUp(
    "First organizer",
    `first-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("First private family");
  await family.openAddPerson();
  await family.fillPerson("Private unsent draft");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Private unsent draft"
  );
  const second = await context.newPage();
  await second.goto(page.url());
  await new AuthPage(second).logout();
  await new AuthPage(second).signUp(
    "Second organizer",
    `second-${crypto.randomUUID()}@example.test`
  );
  await new AuthPage(page).revisit();
  await expect(page.getByText("First organizer", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Name", { exact: true })).toBeHidden();
  await page.goto("/setup/family");
  await new FamilyPage(page).create("Second family");
  await expect(
    page.getByText("Second organizer", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("First organizer", { exact: true })).toBeHidden();
});
