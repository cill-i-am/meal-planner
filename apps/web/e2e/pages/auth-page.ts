import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export class AuthPage {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  async signUp(name: string, email: string) {
    await this.page.goto("/signup?redirect=%2Fsetup%2Ffamily");
    await this.page.getByLabel("Your name", { exact: true }).fill(name);
    await this.page.getByLabel("Email", { exact: true }).fill(email);
    await this.page
      .getByLabel("Password", { exact: true })
      .fill("Test-family-password-29!");
    await this.page
      .getByRole("button", { exact: true, name: "Create account" })
      .click();
    await expect(
      this.page.getByRole("heading", { name: "Name your family" })
    ).toBeVisible();
  }

  async logout() {
    await this.page
      .getByRole("button", { exact: true, name: "Log out" })
      .click();
    await expect(
      this.page.getByRole("button", { exact: true, name: "Log in" })
    ).toBeVisible();
  }

  async login(email: string, password: string) {
    await this.page.getByLabel("Email", { exact: true }).fill(email);
    await this.page.getByLabel("Password", { exact: true }).fill(password);
    await this.page
      .getByRole("button", { exact: true, name: "Log in" })
      .click();
  }

  async revisit() {
    await this.page.bringToFront();
    // Headless pages stay visible; deliver the event emitted by a real tab switch.
    await this.page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange"))
    );
  }

  async requestPasswordReset(email: string, returnTo: string) {
    await this.page.goto(
      `/forgot-password?${new URLSearchParams({ redirect: returnTo })}`
    );
    await this.page.getByLabel("Email", { exact: true }).fill(email);
    await this.page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      this.page.getByRole("heading", { name: "Check your email" })
    ).toBeVisible();
  }

  async resetPassword(url: string, password: string) {
    await this.page.goto(url);
    await this.page.getByLabel("New password", { exact: true }).fill(password);
    await this.page
      .getByLabel("Confirm new password", { exact: true })
      .fill(password);
    await this.page.getByRole("button", { name: "Save new password" }).click();
    await expect(
      this.page.getByRole("heading", { name: "Password updated" })
    ).toBeVisible();
    await this.page.getByRole("link", { exact: true, name: "Log in" }).click();
  }
}
