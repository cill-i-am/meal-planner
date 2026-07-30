import { describe, expect, it } from "vitest";

import { decodeForcedToolResponse } from "./import-forced-tool-response.js";

const validArguments = {
  name: {
    citations: [],
    origin: "unresolved",
    reason: "not present in evidence",
    state: "unresolved",
  },
};

const textPart = (value: unknown) => ({
  text: typeof value === "string" ? value : JSON.stringify(value),
  type: "text",
});

const toolPart = (name = "record_recipe") => ({
  name,
  params: validArguments,
  type: "tool-call",
});

describe("forced tool response boundary", () => {
  it.each(["parameters", "arguments"] as const)(
    "accepts one native %s envelope when no structured call exists",
    (field) => {
      expect(
        decodeForcedToolResponse(
          [
            textPart({
              [field]: validArguments,
              name: "record_recipe",
            }),
          ],
          "record_recipe"
        )
      ).toEqual(validArguments);
    }
  );

  it.each(["parameters", "arguments"] as const)(
    "accepts one native %s envelope in the installed singleton-array shape",
    (field) => {
      expect(
        decodeForcedToolResponse(
          [
            textPart([
              {
                [field]: validArguments,
                name: "record_recipe",
              },
            ]),
          ],
          "record_recipe"
        )
      ).toEqual(validArguments);
    }
  );

  it("keeps one installed structured call authoritative beside non-envelope text", () => {
    expect(
      decodeForcedToolResponse(
        [textPart("non-authoritative model text"), toolPart()],
        "record_recipe"
      )
    ).toEqual(validArguments);
  });

  it.each([
    ["zero parts", []],
    [
      "multiple native text parts",
      [
        textPart({
          name: "record_recipe",
          parameters: validArguments,
        }),
        textPart({
          name: "record_recipe",
          parameters: validArguments,
        }),
      ],
    ],
    [
      "mixed structured and native calls",
      [
        toolPart(),
        textPart({
          name: "record_recipe",
          parameters: validArguments,
        }),
      ],
    ],
    ["multiple structured calls", [toolPart(), toolPart()]],
    [
      "wrong native tool name",
      [
        textPart({
          name: "wrong_tool",
          parameters: validArguments,
        }),
      ],
    ],
    ["malformed native JSON", [textPart("{")]],
    [
      "extra native envelope field",
      [
        textPart({
          extra: true,
          name: "record_recipe",
          parameters: validArguments,
        }),
      ],
    ],
    [
      "both native argument fields",
      [
        textPart({
          arguments: validArguments,
          name: "record_recipe",
          parameters: validArguments,
        }),
      ],
    ],
    ["missing native argument field", [textPart({ name: "record_recipe" })]],
    ["empty native envelope array", [textPart([])]],
    [
      "multiple native envelopes in one array",
      [
        textPart([
          {
            name: "record_recipe",
            parameters: validArguments,
          },
          {
            name: "record_recipe",
            parameters: validArguments,
          },
        ]),
      ],
    ],
    [
      "valid and malformed native envelopes in one array",
      [
        textPart([
          {
            name: "record_recipe",
            parameters: validArguments,
          },
          {
            name: "record_recipe",
          },
        ]),
      ],
    ],
    [
      "non-object native parameters",
      [textPart({ name: "record_recipe", parameters: "not-an-object" })],
    ],
    [
      "array native parameters",
      [textPart({ name: "record_recipe", parameters: [] })],
    ],
  ])("rejects %s", (_label, parts) => {
    expect(decodeForcedToolResponse(parts, "record_recipe")).toBeUndefined();
  });
});
