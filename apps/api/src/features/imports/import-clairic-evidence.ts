import type { RecipeEvidenceItem } from "./import-recipe-extractor.js";

export interface ClairicEvidenceText {
  readonly state: string;
  readonly sources: readonly {
    readonly start: number;
    readonly end: number;
    readonly item: RecipeEvidenceItem;
  }[];
}

/** Keep source bytes and order intact; source identity is injected locally. */
export const assembleClairicEvidenceText = (
  items: readonly RecipeEvidenceItem[]
): ClairicEvidenceText => {
  let state = "";
  const sources: ClairicEvidenceText["sources"][number][] = [];
  for (const item of items) {
    if (item.kind === "source_url" || item.kind === "creator") {
      continue;
    }
    if (sources.length > 0) {
      state += "\n\n";
    }
    const start = state.length;
    state += item.value;
    sources.push({ end: state.length, item, start });
  }
  return { sources, state };
};

export type ClairicSpanEncoding = "unicode-code-points" | "utf16-code-units";

const codeUnitOffset = (
  text: string,
  offset: number,
  encoding: ClairicSpanEncoding
): number | null => {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return null;
  }
  if (encoding === "utf16-code-units") {
    if (offset > 0 && (text.codePointAt(offset - 1) ?? 0) > 65_535) {
      return null;
    }
    return offset <= text.length ? offset : null;
  }
  let units = 0;
  let points = 0;
  for (const point of text) {
    if (points === offset) {
      return units;
    }
    units += point.length;
    points += 1;
  }
  return points === offset ? units : null;
};

/** Encoding must come from an observed provider contract, never a guessed offset. */
export const resolveClairicEvidenceSpan = (input: {
  readonly evidence: ClairicEvidenceText;
  readonly returnedStateText: string;
  readonly encoding: ClairicSpanEncoding;
  readonly value: string;
  readonly span: readonly [number, number];
}) => {
  if (input.returnedStateText !== input.evidence.state) {
    return null;
  }
  const start = codeUnitOffset(
    input.returnedStateText,
    input.span[0],
    input.encoding
  );
  const end = codeUnitOffset(
    input.returnedStateText,
    input.span[1],
    input.encoding
  );
  if (
    start === null ||
    end === null ||
    start >= end ||
    input.returnedStateText.slice(start, end) !== input.value
  ) {
    return null;
  }
  const wordCharacter = /[\p{L}\p{N}\p{M}]/u;
  const prefix = input.returnedStateText.slice(0, start);
  const suffix = input.returnedStateText.slice(end);
  const previous = [...prefix].at(-1) ?? "";
  const following = [...suffix][0] ?? "";
  const first = [...input.value][0] ?? "";
  const last = [...input.value].at(-1) ?? "";
  if (
    (wordCharacter.test(previous) && wordCharacter.test(first)) ||
    (wordCharacter.test(last) && wordCharacter.test(following))
  ) {
    return null;
  }
  const source = input.evidence.sources.find(
    (candidate) => start >= candidate.start && end <= candidate.end
  );
  return source === undefined
    ? null
    : {
        end: end - source.start,
        evidenceId: source.item.evidenceId,
        start: start - source.start,
        value: input.value,
      };
};
