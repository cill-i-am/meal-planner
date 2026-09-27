import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    await context.setExtraHTTPHeaders({
      "x-test-client-ip": `192.0.2.${testInfo.workerIndex + 1}`,
    });
    await use(context);
  },
});
