import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export class FoodProfilePage {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  get region() {
    return this.page.getByRole("region", { name: "Food profiles" });
  }

  async open() {
    const disclosure = this.page.locator("details#saved-food-facts");
    await expect(disclosure).toBeVisible();
    if ((await disclosure.getAttribute("open")) === null) {
      await disclosure.locator(":scope > summary").click();
    }
    await expect(this.region).toBeVisible();
  }

  async expectPerson(name: string) {
    await this.open();
    await expect(
      this.region.getByRole("heading", { name: `${name}’s food profile` })
    ).toBeVisible();
  }

  async addPreference(label: string) {
    const form = this.region.getByRole("group", { name: "Add a food fact" });
    await form.getByLabel("Food or ingredient").fill(label);
    await form.getByRole("button", { name: "Add fact" }).click();
    await this.expectPreference(label);
  }

  async correctPreference(from: string, to: string) {
    const fact = this.region
      .getByRole("listitem")
      .filter({ hasText: `${from}: like (ingredient)` });
    await fact.getByText("Edit preference", { exact: true }).click();
    const form = fact.getByRole("group", {
      name: "Correct this preference",
    });
    await form.getByLabel("Food or ingredient").fill(to);
    await form.getByRole("button", { name: "Save correction" }).click();
    await this.expectPreference(to);
    await expect(
      this.region.getByText(`${from}: like (ingredient)`, { exact: true })
    ).toBeHidden();
  }

  async expectPreference(label: string) {
    await this.open();
    await expect(
      this.region.getByText(`${label}: like (ingredient)`, { exact: true })
    ).toBeVisible();
  }

  async expectVersion(version: number) {
    await this.open();
    await expect(
      this.region.getByText(`Profile version ${version}.`)
    ).toBeVisible();
  }
}
