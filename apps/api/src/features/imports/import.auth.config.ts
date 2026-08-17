import { Config, Data, Effect, Redacted, Schema } from "effect";

import { ImportPrincipal } from "./import-intent.js";
import type { ConfiguredImportPrincipal } from "./import.auth.js";

const RequiredSecret = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

const RawConfiguredImportPrincipal = Schema.Struct({
  actorId: ImportPrincipal.fields.actorId,
  householdScopeId: ImportPrincipal.fields.householdScopeId,
  token: RequiredSecret,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

const RawConfiguredImportPrincipalRegistry = Schema.fromJsonString(
  Schema.NonEmptyArray(RawConfiguredImportPrincipal)
);

/** Safe startup failure for an invalid configured-principal registry. */
export class ImportConfiguredPrincipalsConfigError extends Data.TaggedError(
  "ImportConfiguredPrincipalsConfigError"
) {
  override readonly message =
    "The import configured-principal registry is invalid.";
}

/** Decode the server-only bearer registry once without retaining raw secrets. */
export const ImportConfiguredPrincipalsConfig: Effect.Effect<
  readonly ConfiguredImportPrincipal[],
  ImportConfiguredPrincipalsConfigError | Config.ConfigError
> = Config.redacted("MEAL_PLANNER_IMPORT_CONFIGURED_PRINCIPALS_JSON").pipe(
  Effect.flatMap((registryJson) =>
    Schema.decodeUnknownEffect(RawConfiguredImportPrincipalRegistry)(
      Redacted.value(registryJson)
    ).pipe(
      Effect.mapError(() => new ImportConfiguredPrincipalsConfigError()),
      Effect.map((entries) =>
        entries.map(
          ({
            actorId,
            householdScopeId,
            token,
          }): ConfiguredImportPrincipal => ({
            principal: ImportPrincipal.make({ actorId, householdScopeId }),
            token: Redacted.make(token),
          })
        )
      )
    )
  )
);
