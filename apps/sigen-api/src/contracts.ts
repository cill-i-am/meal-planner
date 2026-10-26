import {
  ConnectionStatus,
  EmptyInput,
  EnergyFlow,
  OperatingMode,
  Station,
  StationInput,
  failure,
} from "@meal-planner/sigen";
import type { SigenFailure, StationId } from "@meal-planner/sigen";
import { Context, Effect, Schema, flow } from "effect";

export class SigenCapabilities extends Context.Service<
  SigenCapabilities,
  {
    readonly health: Effect.Effect<typeof ConnectionStatus.Type, SigenFailure>;
    readonly station: (
      id: StationId
    ) => Effect.Effect<typeof Station.Type, SigenFailure>;
    readonly energyFlow: (
      id: StationId
    ) => Effect.Effect<typeof EnergyFlow.Type, SigenFailure>;
    readonly operatingMode: (
      id: StationId
    ) => Effect.Effect<typeof OperatingMode.Type, SigenFailure>;
  }
>()("SigenCapabilities") {}

const operation = <
  I extends Schema.Codec<unknown, unknown>,
  O extends Schema.Codec<unknown, Readonly<Record<string, Schema.Json>>>,
>(
  name: string,
  description: string,
  input: I,
  output: O,
  run: (
    value: I["Type"]
  ) => Effect.Effect<O["Type"], SigenFailure, SigenCapabilities>
) => ({
  description,
  execute: flow(
    Schema.decodeUnknownEffect(input, { onExcessProperty: "error" }),
    Effect.mapError(() => failure("InvalidInput")),
    Effect.flatMap(
      (
        value
      ): Effect.Effect<
        Readonly<Record<string, Schema.Json>>,
        SigenFailure,
        SigenCapabilities
      > =>
        run(value).pipe(
          Effect.flatMap((result) =>
            Schema.encodeUnknownEffect(output)(result).pipe(
              Effect.mapError(() => failure("SchemaMismatch"))
            )
          )
        )
    )
  ),
  input,
  name,
  output,
});

export const operations = [
  operation(
    "connection_status",
    "Inspect connection health and renewal count. Credentials are never returned.",
    EmptyInput,
    ConnectionStatus,
    () => SigenCapabilities.use((service) => service.health)
  ),
  operation(
    "get_station",
    "Read the explicitly enrolled station and its equipment capabilities.",
    StationInput,
    Station,
    (input) =>
      SigenCapabilities.use((service) => service.station(input.stationId))
  ),
  operation(
    "get_energy_flow",
    "Read power in watts and battery SOC. Empty provider timestamps mean unknown freshness; fetch time does not prove device freshness.",
    StationInput,
    EnergyFlow,
    (input) =>
      SigenCapabilities.use((service) => service.energyFlow(input.stationId))
  ),
  operation(
    "get_operating_mode",
    "Read the provider mode and profile IDs, preserving unfamiliar modes.",
    StationInput,
    OperatingMode,
    (input) =>
      SigenCapabilities.use((service) => service.operatingMode(input.stationId))
  ),
];

export const jsonSchema = (schema: Schema.Top) => {
  const doc = Schema.toJsonSchemaDocument(schema);
  return { ...doc.schema, $defs: doc.definitions };
};
export const openApi = {
  components: {
    securitySchemes: { owner: { scheme: "bearer", type: "http" } },
  },
  info: { title: "Private mySigen API", version: "0.1.0" },
  openapi: "3.1.0",
  paths: Object.fromEntries(
    operations.map((op) => [
      `/v1/${op.name}`,
      {
        post: {
          description: op.description,
          operationId: op.name,
          requestBody: {
            content: { "application/json": { schema: jsonSchema(op.input) } },
            required: true,
          },
          responses: {
            "200": {
              content: {
                "application/json": { schema: jsonSchema(op.output) },
              },
              description: "Verified response contract",
            },
            "400": { description: "Invalid input" },
            "401": { description: "Client authentication required" },
            "403": {
              description: "Permission denied or browser origin refused",
            },
            "429": { description: "Rate limited" },
            "503": {
              description: "Provider failure or reauthentication required",
            },
          },
        },
      },
    ])
  ),
  security: [{ owner: [] }],
};
