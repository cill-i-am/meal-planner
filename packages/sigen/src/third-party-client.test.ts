import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  thirdPartyStatic,
  thirdPartyDynamic,
} from "./__fixtures__/remaining.js";
import { StationId } from "./model.js";
import { makeThirdPartyClient } from "./third-party-client.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("fixture-only");
type CardFixture = readonly Readonly<Record<string, unknown>>[];
const read = (fixed: CardFixture, changing: CardFixture) =>
  makeThirdPartyClient((path) =>
    Effect.succeed(path.includes("static-info") ? fixed : changing)
  ).thirdPartyDevices(id, token);
describe("third-party card inventory", () => {
  it("keeps generator placeholders and missing dynamic readings explicit", async () => {
    const result = await Effect.runPromise(
      read(thirdPartyStatic, thirdPartyDynamic)
    );
    expect(result.cards).toMatchObject([
      {
        controllable: null,
        displayValue: "",
        placeholder: true,
        providerManualSwitch: 0,
        telemetryAvailable: true,
        title: "GENERATOR",
      },
    ]);
    const missing = await Effect.runPromise(read(thirdPartyStatic, []));
    expect(missing.cards).toMatchObject([
      { displayValue: null, placeholder: true, telemetryAvailable: false },
    ]);
    expect(result.cards[0]).not.toHaveProperty("stationId");
  });
  it.each([
    {
      changing: thirdPartyDynamic,
      fixed: [{ ...thirdPartyStatic[0], stationId: 54_321 }],
    },
    {
      changing: [{ ...thirdPartyDynamic[0], id: 10 }],
      fixed: thirdPartyStatic,
    },
    {
      changing: thirdPartyDynamic,
      fixed: [...thirdPartyStatic, ...thirdPartyStatic],
    },
    {
      changing: [...thirdPartyDynamic, ...thirdPartyDynamic],
      fixed: thirdPartyStatic,
    },
  ])(
    "rejects cross-station, duplicate and orphan telemetry",
    async ({ fixed, changing }) => {
      expect(
        await Effect.runPromise(read(fixed, changing).pipe(Effect.result))
      ).toMatchObject({ _tag: "Failure" });
    }
  );
});
