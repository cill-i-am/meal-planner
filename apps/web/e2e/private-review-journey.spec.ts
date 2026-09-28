import { test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";
import { FoodProfilePage } from "./pages/food-profile-page.js";
import { PrivateReviewPage } from "./pages/private-review-page.js";

test("a completed private session stays read-only when an adult starts a fresh profile review", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Private reviewer",
    `private-review-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Private review family");
  await family.confirm();
  await new FoodProfilePage(page).addPreference("Carrots");

  const review = new PrivateReviewPage(page);
  await review.start();
  await review.expectCurrentFact("Carrots");
  await review.complete();
  await review.start();
  await review.expectCurrentFact("Carrots");
  await review.select(1);
  await review.expectCompleted();

  await page.reload();
  await review.select(2);
  await review.expectOpen();
  await review.expectCurrentFact("Carrots");
  await review.select(1);
  await review.expectCompleted();
});
