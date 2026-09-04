import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("provider accounting authority boundary", () => {
  it("keeps global accounting independent of household authority", async () => {
    const paths = await readdir(import.meta.dirname);
    await Promise.all(
      paths
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map(async (file) => {
          const source = await readFile(
            new URL(file, import.meta.url),
            "utf-8"
          );
          expect(source, file).not.toMatch(
            /features\/households|\.\.\/households|householdDomain|readHousehold|prepareHousehold/u
          );
        })
    );
  });

  it("keeps household recovery independent of global accounting", async () => {
    const source = await readFile(
      new URL("../imports/import-provider-recovery.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toMatch(
      /provider-accounting|ProviderAccounting|AnyD1Database/u
    );
  });
});
