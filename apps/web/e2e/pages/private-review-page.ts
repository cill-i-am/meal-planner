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

  get proposal() {
    return this.region
      .getByRole("list", { name: "Private profile proposals" })
      .getByRole("listitem")
      .first();
  }

  async start() {
    await this.region
      .getByRole("button", { name: "Update my food profile" })
      .click();
    await this.expectOpen();
    await expect(this.region.getByText("What has changed?")).toBeVisible();
  }

  async complete() {
    await this.region.getByRole("button", { name: "Complete session" }).click();
    await this.expectCompleted();
  }

  async sendMessage(text: string) {
    await this.region.getByLabel("Your message").fill(text);
    await this.region.getByRole("button", { name: "Send message" }).click();
    await expect(this.proposal).toBeVisible();
  }

  async expectProposal(label: string) {
    await expect(this.proposal.getByText("Private proposal")).toBeVisible();
    await expect(
      this.proposal.getByText(`${label}: like (ingredient)`)
    ).toBeVisible();
  }

  async correctProposal(label: string) {
    await this.proposal.getByText("Review or correct proposal").click();
    await this.proposal.getByLabel("Food or ingredient").fill(label);
    await this.proposal
      .getByRole("button", { name: "Save revised proposal" })
      .click();
    await this.expectProposal(label);
  }

  async confirmProposal() {
    await this.proposal
      .getByRole("button", { name: "Confirm for household" })
      .click();
    await expect(
      this.proposal.getByText("Confirmed for household")
    ).toBeVisible();
  }

  async select(ordinal: number) {
    await this.region
      .getByRole("navigation", { name: "Your private sessions" })
      .getByRole("button", { name: new RegExp(`Session ${ordinal}\\b`, "u") })
      .click();
  }

  async expectOpen() {
    await expect(this.region.getByLabel("Your message")).toBeEnabled();
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
    await expect(
      this.region.getByRole("button", { name: "Confirm for household" })
    ).toHaveCount(0);
  }
}
