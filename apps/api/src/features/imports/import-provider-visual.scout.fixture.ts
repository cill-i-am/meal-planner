/** Sanitized 2026-10-23 accounted Scout response to three synthetic text JPEGs.
 * See docs/evals/recipe-evidence-acquisition.md. No real source-media data. */
export const syntheticThreeFrameResponse = {
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: "",
        tool_calls: [
          {
            function: {
              arguments:
                '{ \n    "frames": [\n        {"observations": [{"text": "2 onions"}]}, \n        {"observations": [{"text": "Simmer 10 minutes"}]}, \n        {"observations": [{"text": "Serve with rice"}]}\n    ] \n}',
              name: "record_visual_evidence",
            },
            id: "synthetic-scout-visual-call",
            type: "function",
          },
        ],
      },
    },
  ],
  tool_calls: [
    {
      arguments: {
        frames: [
          {
            observations: [
              {
                text: "2 onions",
              },
            ],
          },
          {
            observations: [
              {
                text: "Simmer 10 minutes",
              },
            ],
          },
          {
            observations: [
              {
                text: "Serve with rice",
              },
            ],
          },
        ],
      },
      name: "record_visual_evidence",
    },
  ],
  usage: {
    completion_tokens: 54,
    prompt_tokens: 2235,
    total_tokens: 2289,
  },
} as const;
