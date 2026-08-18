import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeForcedToolResponse,
  decodeForcedToolResponseResult,
} from "./import-forced-tool-response.js";

const validArguments = {
  name: {
    citations: [],
    origin: "unresolved",
    reason: "not present in evidence",
    state: "unresolved",
  },
};

const textPart = (value: Schema.Json) => ({
  text: Schema.is(Schema.String)(value)
    ? value
    : (JSON.stringify(value) ?? "null"),
  type: "text",
});

const toolPart = (name = "record_recipe") => ({
  name,
  params: validArguments,
  type: "tool-call",
});

describe("forced tool response boundary", () => {
  it.each(["parameters", "arguments"] as const)(
    "accepts one installed mirrored structured and native %s call",
    (field) => {
      expect(
        decodeForcedToolResponse(
          [
            toolPart(),
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

  it("accepts installed structured parameters encoded as one JSON object string", () => {
    expect(
      decodeForcedToolResponse(
        [
          {
            ...toolPart(),
            params: JSON.stringify(validArguments),
          },
        ],
        "record_recipe"
      )
    ).toEqual(validArguments);
  });

  it("compares mirrored JSON objects semantically while preserving array order", () => {
    const reordered = {
      name: {
        citations: [],
        origin: "unresolved",
        reason: "not present in evidence",
        state: "unresolved",
      },
    };
    expect(
      decodeForcedToolResponse(
        [
          toolPart(),
          textPart({
            name: "record_recipe",
            parameters: reordered,
          }),
        ],
        "record_recipe"
      )
    ).toEqual(validArguments);
  });

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

  it("accepts an installed bare-object text mirror only beside the same structured call", () => {
    expect(
      decodeForcedToolResponse(
        [toolPart(), textPart(validArguments)],
        "record_recipe"
      )
    ).toEqual(validArguments);
    expect(
      decodeForcedToolResponse([textPart(validArguments)], "record_recipe")
    ).toBeUndefined();
  });

  it("accepts one direct bare-object recipe authority only when explicitly enabled", () => {
    expect(
      decodeForcedToolResponseResult(
        [textPart(validArguments)],
        "record_recipe",
        { acceptUnwrappedObject: true }
      )
    ).toEqual({ _tag: "Decoded", value: validArguments });
  });

  it.each([
    ["the default boundary", undefined],
    ["a singleton array", [validArguments]],
  ] as const)(
    "rejects one bare-object recipe authority through %s",
    (_label, value) => {
      const content = [
        textPart(value === undefined ? validArguments : value),
      ] as const;
      expect(
        decodeForcedToolResponseResult(
          content,
          "record_recipe",
          value === undefined ? undefined : { acceptUnwrappedObject: true }
        )
      ).toEqual({
        _tag: "Malformed",
        reason: "invalid_native_envelope",
      });
    }
  );

  it.each([
    ["missing_content", [], { _tag: "Missing", reason: "missing_content" }],
    [
      "invalid_cardinality",
      [toolPart(), toolPart()],
      { _tag: "Malformed", reason: "invalid_cardinality" },
    ],
    [
      "unexpected_tool_name",
      [toolPart("wrong_tool")],
      { _tag: "Malformed", reason: "unexpected_tool_name" },
    ],
    [
      "invalid_arguments",
      [{ ...toolPart(), params: "{" }],
      { _tag: "Malformed", reason: "invalid_arguments" },
    ],
    [
      "invalid_native_envelope",
      [toolPart(), textPart("{")],
      { _tag: "Malformed", reason: "invalid_native_envelope" },
    ],
    [
      "mirror_mismatch",
      [
        toolPart(),
        textPart({
          name: "record_recipe",
          parameters: { ...validArguments, unexpected: true },
        }),
      ],
      { _tag: "Malformed", reason: "mirror_mismatch" },
    ],
  ] as const)(
    "classifies %s without retaining response data",
    (_reason, parts, expected) => {
      expect(decodeForcedToolResponseResult(parts, "record_recipe")).toEqual(
        expected
      );
      expect(JSON.stringify(expected)).not.toContain("not present in evidence");
    }
  );

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
      "conflicting mirrored argument objects",
      [
        toolPart(),
        textPart({
          name: "record_recipe",
          parameters: { ...validArguments, unexpected: true },
        }),
      ],
    ],
    [
      "conflicting mirrored tool names",
      [
        toolPart(),
        textPart({
          name: "wrong_tool",
          parameters: validArguments,
        }),
      ],
    ],
    ["multiple structured calls", [toolPart(), toolPart()]],
    ["malformed structured parameters", [{ ...toolPart(), params: "{" }]],
    [
      "non-object structured parameters",
      [{ ...toolPart(), params: JSON.stringify([]) }],
    ],
    [
      "malformed JSON-looking text beside a structured call",
      [toolPart(), textPart("{")],
    ],
    [
      "an extra-field native envelope beside a structured call",
      [
        toolPart(),
        textPart({
          extra: true,
          name: "record_recipe",
          parameters: validArguments,
        }),
      ],
    ],
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
