import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

let clientSequence = 0;

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    clientSequence += 1;
    await context.setExtraHTTPHeaders({
      "x-test-client-ip": `198.18.${testInfo.workerIndex + 1}.${clientSequence}`,
    });
    await use(context);
  },
});
