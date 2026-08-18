import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const stylesheet = await readFile(
  new URL("styles.css", import.meta.url),
  "utf-8"
);

describe("mobile recipe import layout", () => {
  it("uses its one-column breakpoint at 375px with full-width primary controls", () => {
    const mobileBreakpoint = 780;
    expect(375).toBeLessThanOrEqual(mobileBreakpoint);
    expect(stylesheet).toMatch(
      /@media \(max-width: 780px\) \{[\s\S]*?\.workspace \{\s+display: block;/u
    );
    expect(stylesheet).toMatch(
      /@media \(max-width: 780px\) \{[\s\S]*?\.input-row,\s+\.recipe-columns \{\s+grid-template-columns: 1fr;/u
    );
    expect(stylesheet).toMatch(
      /@media \(max-width: 780px\) \{[\s\S]*?\.approve-bar \.button \{\s+width: 100%;/u
    );
  });

  it("keeps authentication controls touch-sized and stacked at 375px", () => {
    expect(stylesheet).toMatch(/\.input \{[\s\S]*?min-height: 48px;/u);
    expect(stylesheet).toMatch(/\.button \{[\s\S]*?min-height: 48px;/u);
    expect(stylesheet).toMatch(
      /@media \(max-width: 780px\) \{[\s\S]*?\.auth-grid \{\s+grid-template-columns: 1fr;/u
    );
  });
});
