import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export class FamilyPage {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async create(name: string) {
    await this.page.getByLabel("Family name", { exact: true }).fill(name);
    await this.page
      .getByRole("button", { exact: true, name: "Create family" })
      .click();
    await this.expectReview();
  }

  async expectReview() {
    await expect(
      this.page.getByRole("heading", { exact: true, name: "Your family" })
    ).toBeVisible();
  }

  async addAdult(name: string) {
    await this.page.getByRole("button", { name: "Add someone else" }).click();
    await this.page.getByLabel("Name", { exact: true }).fill(name);
    await this.page
      .getByRole("button", { exact: true, name: "Add person" })
      .click();
    await this.expectReview();
    await expect(this.page.getByText(name, { exact: true })).toBeVisible();
  }

  async rename(from: string, to: string) {
    await this.page
      .getByRole("button", { exact: true, name: `Manage ${from}` })
      .click();
    await this.page.getByRole("menuitem", { name: "Edit name" }).click();
    await this.page
      .getByRole("dialog")
      .getByLabel("Name", { exact: true })
      .fill(to);
    await this.page
      .getByRole("dialog")
      .getByRole("button", { name: "Save changes" })
      .click();
    await expect(this.page.getByRole("dialog")).toBeHidden();
    await expect(this.page.getByText(to, { exact: true })).toBeVisible();
  }

  async invite(email: string) {
    await this.page
      .getByRole("button", { exact: true, name: "Invite to join" })
      .click();
    const dialog = this.page.getByRole("dialog");
    await dialog.getByLabel("Email", { exact: true }).fill(email);
    await dialog.getByRole("button", { name: /^Invite /u }).click();
    await expect(dialog).toBeHidden();
  }

  async confirm() {
    await this.page
      .getByRole("button", { exact: true, name: "Continue" })
      .click();
    await expect(
      this.page.getByRole("heading", { name: "Your family is ready." })
    ).toBeVisible();
    const pendingResponse = this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/complete-setup") &&
        response.request().method() === "POST"
    );
    await this.page.getByRole("button", { name: "I’ll do this later" }).click();
    const response = await pendingResponse;
    expect(response.ok()).toBe(true);
  }
}
