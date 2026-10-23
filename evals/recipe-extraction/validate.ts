import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Schema } from "effect";

import {
  readCorpus,
  evidenceSha256,
  corpusSha256,
  grounderSha256,
  scorerSha256,
} from "./model.js";
import type { ExtractionCorpus } from "./model.js";
import { recipeFacts, witnessForFact } from "./score.js";

export const validateCorpus = (corpus: ExtractionCorpus) => {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const item of corpus.cases) {
    if (ids.has(item.id)) {
      throw new Error(`Duplicate case: ${item.id}`);
    }
    ids.add(item.id);
    const hash = evidenceSha256(item);
    if (hashes.has(hash)) {
      throw new Error(`Duplicate frozen evidence across cases: ${item.id}`);
    }
    hashes.add(hash);
    const evidenceIds = new Set(
      item.allEvidence.map((evidence) => evidence.evidenceId)
    );
    if (
      evidenceIds.size !== item.allEvidence.length ||
      new Set(item.availableEvidenceIds).size !==
        item.availableEvidenceIds.length ||
      item.availableEvidenceIds.some((id) => !evidenceIds.has(id))
    ) {
      throw new Error(`Invalid evidence selection: ${item.id}`);
    }
    for (const witness of item.witnesses) {
      const source = item.allEvidence.find(
        (evidence) => evidence.evidenceId === witness.evidenceId
      );
      if (!source?.value.includes(witness.quote)) {
        throw new Error(`Witness is not verbatim: ${item.id} ${witness.path}`);
      }
    }
    const facts = recipeFacts(item.expected);
    for (const fact of facts) {
      if (witnessForFact(item, fact) === undefined) {
        throw new Error(`Expected fact lacks witness: ${item.id} ${fact.path}`);
      }
    }
    for (const qualifier of item.qualifiers) {
      const fact = facts.find((entry) => entry.path === qualifier.path);
      if (
        fact === undefined ||
        !Schema.is(Schema.String)(fact.value) ||
        qualifier.phrases.some(
          (phrase) =>
            !String(fact.value).toLowerCase().includes(phrase.toLowerCase())
        )
      ) {
        throw new Error(
          `Invalid qualifier oracle: ${item.id} ${qualifier.path}`
        );
      }
    }
    if (
      item.provenance.kind !== "synthetic" &&
      (item.provenance.capturedAt === null ||
        item.provenance.sourceReference === null)
    ) {
      throw new Error(`Capture provenance missing: ${item.id}`);
    }
  }
  return {
    caseCount: corpus.cases.length,
    corpusVersion: corpus.version,
    dev: corpus.cases.filter((item) => item.split === "dev").length,
    expectationReview: corpus.expectationReview,
    holdout: corpus.cases.filter((item) => item.split === "holdout").length,
  };
};

export const corpusManifest = () => ({
  ...validateCorpus(readCorpus()),
  acceptanceSha256: createHash("sha256")
    .update(readFileSync(new URL("acceptance.v1.json", import.meta.url)))
    .digest("hex"),
  corpusFileSha256: createHash("sha256")
    .update(readFileSync(new URL("corpus.v1.json", import.meta.url)))
    .digest("hex"),
  corpusSha256: corpusSha256(readCorpus()),
  evidence: readCorpus().cases.map((item) => ({
    caseId: item.id,
    evidenceSha256: evidenceSha256(item),
    split: item.split,
  })),
  grounderSha256: grounderSha256(),
  scorerSha256: scorerSha256(),
});
