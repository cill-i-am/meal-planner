import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export class InvitationPage {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async open(url: string) {
    await this.page.goto(url);
  }

  async expectWrongAccount() {
    await expect(
      this.page.getByRole("heading", { name: "Use the invited email" })
    ).toBeVisible();
    await expect(
      this.page.getByRole("button", { name: "Join family" })
    ).toBeHidden();
  }

  async accept() {
    await this.page
      .getByRole("button", { exact: true, name: "Join family" })
      .click();
    await expect(
      this.page.getByRole("heading", { exact: true, name: "Your family" })
    ).toBeVisible();
  }
}
