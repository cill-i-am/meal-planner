import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export class PrivateReviewPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get region() {
    return this.page.getByRole("region", { name: "Your private sessions" });
  }

  async start() {
    await this.region
      .getByRole("button", { name: "Update my food profile" })
      .click();
    await this.expectOpen();
  }

  async complete() {
    await this.region.getByRole("button", { name: "Complete session" }).click();
    await this.expectCompleted();
  }

  async select(ordinal: number) {
    await this.region
      .getByRole("navigation", { name: "Your private sessions" })
      .getByRole("button", { name: new RegExp(`Session ${ordinal}\\b`, "u") })
      .click();
  }

  async expectOpen() {
    await expect(this.region.getByLabel("Your message")).toBeEnabled();
    await expect(this.region.getByText("What has changed?")).toBeVisible();
  }

  async expectCurrentFact(label: string) {
    await expect(
      this.region
        .getByRole("list", { name: "Current shared food facts" })
        .getByText(`${label}: like (ingredient)`)
    ).toBeVisible();
  }

  async expectCompleted() {
    await expect(
      this.region.getByText("Completed · history only")
    ).toBeVisible();
    await expect(this.region.getByLabel("Your message")).toHaveCount(0);
  }
}
