import { Schema } from "effect";

import { StationId, Timestamp } from "./model.js";

export const ThirdPartyDevices = Schema.Struct({
  cards: Schema.Array(
    Schema.Struct({
      controllable: Schema.NullOr(Schema.Boolean),
      displayValue: Schema.NullOr(
        Schema.String.check(Schema.isMaxLength(1024))
      ),
      hasSwitch: Schema.NullOr(Schema.Boolean),
      loadPath: Schema.NullOr(Schema.Int),
      name: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
      placeholder: Schema.Boolean,
      providerBelongType: Schema.NullOr(Schema.Int),
      providerCommunicationStatus: Schema.NullOr(Schema.Int),
      providerId: Schema.Int,
      providerManualSwitch: Schema.NullOr(Schema.Int),
      providerOperationMode: Schema.NullOr(Schema.Int),
      providerStartControlType: Schema.NullOr(Schema.Int),
      providerType: Schema.Int,
      telemetryAvailable: Schema.Boolean,
      title: Schema.String.check(Schema.isMaxLength(256)),
    })
  ).check(Schema.isMaxLength(128)),
  fetchedAt: Timestamp,
  stationId: StationId,
});
