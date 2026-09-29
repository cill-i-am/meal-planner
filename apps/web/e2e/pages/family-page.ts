import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export class FamilyPage {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async create(name: string) {
    await this.page
      .getByRole("button", { name: "Set up without chat" })
      .click();
    await this.page.getByLabel("Family name", { exact: true }).fill(name);
    await this.page
      .getByRole("button", { exact: true, name: "Create our family" })
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

  async openRename(name: string) {
    await this.page
      .getByRole("button", { exact: true, name: `Manage ${name}` })
      .click();
    await this.page.getByRole("menuitem", { name: "Edit name" }).click();
    await expect(this.page.getByRole("dialog")).toBeVisible();
  }

  async saveRename(name: string) {
    const dialog = this.page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Save changes" }).click();
  }

  async rename(from: string, to: string) {
    await this.openRename(from);
    await this.saveRename(to);
    await expect(this.page.getByRole("dialog")).toBeHidden();
    await expect(this.page.getByText(to, { exact: true })).toBeVisible();
  }

  async reviewConflict() {
    await expect(this.page.getByRole("alert")).toContainText(
      "This person changed"
    );
    await this.page
      .getByRole("button", { exact: true, name: "Review family" })
      .click();
    await expect(this.page.getByRole("dialog")).toBeHidden();
  }

  async openAddPerson() {
    await this.page.getByRole("button", { name: "Add someone else" }).click();
    await expect(
      this.page.getByRole("heading", { exact: true, name: "Add someone" })
    ).toBeVisible();
  }

  async fillPerson(name: string) {
    await this.page.getByLabel("Name", { exact: true }).fill(name);
  }
  async submitPerson() {
    await this.page
      .getByRole("button", { exact: true, name: "Add person" })
      .click();
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
