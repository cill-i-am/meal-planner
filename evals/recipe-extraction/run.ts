import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { Schema } from "effect";

import { withHistoricalGrounding } from "./historical-grounding.js";
import {
  PersistedExtractionRun,
  acceptanceSha256,
  corpusSha256,
  evidenceSha256,
  grounderSha256,
  readCorpus,
  readRun,
  unavailableMeasurements,
} from "./model.js";
import { compareRuns, scoreRun } from "./score.js";
import { corpusManifest } from "./validate.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    baseline: { type: "string" },
    candidate: { type: "string" },
    "historical-grounder": { type: "string" },
    out: { type: "string" },
    outputs: { type: "string" },
    split: { default: "dev", type: "string" },
    strategy: { default: "unmeasured", type: "string" },
  },
});
const split = Schema.decodeUnknownSync(
  Schema.Literals(["dev", "holdout", "all"])
)(values.split);
const corpus = readCorpus();
const [command] = positionals;
let result: unknown;
if (command === "validate") {
  result = corpusManifest();
} else if (command === "template") {
  result = Schema.decodeUnknownSync(PersistedExtractionRun)({
    acceptanceSha256: acceptanceSha256(),
    corpusSha256: corpusSha256(corpus),
    corpusVersion: corpus.version,
    descriptor: {
      model: "unmeasured",
      provider: "unmeasured",
      version: "unmeasured",
    },
    execution: "scripted_fixture",
    grounderRevision: "replace-with-git-revision",
    grounderSha256: grounderSha256(),
    outputs: corpus.cases
      .filter((item) => split === "all" || item.split === split)
      .map((item) => ({
        caseId: item.id,
        evidenceSha256: evidenceSha256(item),
        failureCode: null,
        measurements: unavailableMeasurements,
        rawCandidate: null,
        rawProviderResponse: null,
        status: "skipped",
      })),
    runId: "unmeasured-template",
    schemaVersion: 1,
    strategy: values.strategy,
  });
} else if (command === "score" && values.outputs !== undefined) {
  const run = readRun(values.outputs);
  result =
    values["historical-grounder"] === undefined
      ? scoreRun(corpus, run, split)
      : await withHistoricalGrounding(
          values["historical-grounder"],
          (grounding) => scoreRun(corpus, run, split, grounding)
        );
} else if (
  command === "compare" &&
  values.baseline !== undefined &&
  values.candidate !== undefined
) {
  const baseline = readRun(values.baseline);
  const candidate = readRun(values.candidate);
  const compare = (grounding?: Parameters<typeof scoreRun>[3]) =>
    compareRuns(
      scoreRun(corpus, baseline, split, grounding),
      scoreRun(corpus, candidate, split, grounding)
    );
  result =
    values["historical-grounder"] === undefined
      ? compare()
      : await withHistoricalGrounding(values["historical-grounder"], compare);
} else {
  throw new Error(
    "Use validate | template [--strategy name] | score --outputs run.json | compare --baseline run.json --candidate run.json; optional --split dev|holdout|all --out report.json"
  );
}
const json = `${JSON.stringify(result, null, 2)}\n`;
if (values.out === undefined) {
  process.stdout.write(json);
} else {
  writeFileSync(values.out, json, { flag: "wx" });
}
