import { Config, Effect, Option, Redacted, Schema, SchemaIssue } from "effect";

import {
  TescoAuthCookieHeaderValue,
  TescoAuthorizationValue,
} from "./auth/auth.model.js";
import type {
  TescoAuthCookieHeader,
  TescoAuthorization,
} from "./auth/auth.model.js";

const ConfigText = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

export const TescoLocale = ConfigText.pipe(
  Schema.check(Schema.isPattern(/^[a-z]{2}-[A-Z]{2}$/u)),
  Schema.brand("TescoLocale")
);
export type TescoLocale = typeof TescoLocale.Type;

export const TescoRegion = ConfigText.pipe(
  Schema.check(Schema.isPattern(/^[A-Z]{2}$/u)),
  Schema.brand("TescoRegion")
);
export type TescoRegion = typeof TescoRegion.Type;

export const TescoApiKeyValue = ConfigText.pipe(
  Schema.brand("TescoApiKeyValue")
);
export type TescoApiKeyValue = typeof TescoApiKeyValue.Type;
export type TescoApiKey = Redacted.Redacted<TescoApiKeyValue>;

export const TescoHeaderValue = ConfigText.pipe(
  Schema.brand("TescoHeaderValue")
);
export type TescoHeaderValue = typeof TescoHeaderValue.Type;

export interface TescoAuthBootstrapConfig {
  readonly initialAuthorization: TescoAuthorization;
  readonly initialCookieHeader: TescoAuthCookieHeader;
}

export interface TescoSoftLoginConfig {
  readonly locale: TescoLocale;
  readonly signInUrl: URL;
  readonly refreshFromUrl: URL;
}

export interface TescoCatalogueConfig {
  readonly mangoUrl: URL;
  readonly suggestionUrl: URL;
  readonly locale: TescoLocale;
  readonly region: TescoRegion;
  readonly mangoApiKey: TescoApiKey;
  readonly transactionPurpose: TescoHeaderValue | null;
  readonly releaseBranch: TescoHeaderValue | null;
}

export interface TescoConfig {
  readonly authBootstrap: TescoAuthBootstrapConfig;
  readonly softLogin: TescoSoftLoginConfig;
  readonly catalogue: TescoCatalogueConfig;
}

const TescoEnvironmentVariables = [
  "TESCO_AUTH_COOKIE_HEADER",
  "TESCO_AUTH_REFRESH_FROM_URL",
  "TESCO_AUTHORIZATION",
  "TESCO_LOCALE",
  "TESCO_MANGO_API_KEY",
  "TESCO_MANGO_URL",
  "TESCO_REGION",
  "TESCO_RELEASE_BRANCH",
  "TESCO_SOFT_REFRESH_SIGN_IN_URL",
  "TESCO_SUGGESTION_URL",
  "TESCO_TRANSACTION_PURPOSE",
] as const;

export type TescoEnvironmentVariable =
  (typeof TescoEnvironmentVariables)[number];

const tescoEnvironmentVariables = new Set<string>(TescoEnvironmentVariables);

export interface TescoConfigIssue {
  readonly environmentVariable: TescoEnvironmentVariable;
  readonly reason: "invalid" | "missing";
}

export class TescoConfigError {
  readonly _tag = "TescoConfigError" as const;
  readonly issues: readonly TescoConfigIssue[];
  readonly message: string;

  constructor(issues: readonly TescoConfigIssue[]) {
    this.issues = issues;
    this.message =
      issues.length === 0
        ? "Invalid Tesco configuration"
        : `Invalid Tesco configuration: ${issues
            .map(
              ({ environmentVariable, reason }) =>
                `${environmentVariable} ${reason}`
            )
            .join(", ")}`;
  }
}

const optionalSchemaConfig = <A, I>(
  schema: Schema.Codec<A, I>,
  name: string
) => {
  const checkedResult: Config.Config<A | null> = Config.option(
    Config.schema(schema, name)
  ).pipe(Config.map(Option.getOrNull));
  return checkedResult;
};

const redactedSchemaConfig = <A, I>(
  schema: Schema.Codec<A, I>,
  name: string
) => {
  const checkedResult: Config.Config<Redacted.Redacted<A>> = Config.schema(
    schema,
    name
  ).pipe(Config.map(Redacted.make));
  return checkedResult;
};

const RawTescoConfigDefinition = Config.all({
  authCookieHeader: redactedSchemaConfig(
    TescoAuthCookieHeaderValue,
    "TESCO_AUTH_COOKIE_HEADER"
  ),
  authRefreshFromUrl: Config.URL("TESCO_AUTH_REFRESH_FROM_URL"),
  authorization: redactedSchemaConfig(
    TescoAuthorizationValue,
    "TESCO_AUTHORIZATION"
  ),
  locale: Config.schema(TescoLocale, "TESCO_LOCALE"),
  mangoApiKey: redactedSchemaConfig(TescoApiKeyValue, "TESCO_MANGO_API_KEY"),
  mangoUrl: Config.URL("TESCO_MANGO_URL"),
  region: Config.schema(TescoRegion, "TESCO_REGION"),
  releaseBranch: optionalSchemaConfig(TescoHeaderValue, "TESCO_RELEASE_BRANCH"),
  softRefreshSignInUrl: Config.URL("TESCO_SOFT_REFRESH_SIGN_IN_URL"),
  suggestionUrl: Config.URL("TESCO_SUGGESTION_URL"),
  transactionPurpose: optionalSchemaConfig(
    TescoHeaderValue,
    "TESCO_TRANSACTION_PURPOSE"
  ),
});

const TescoConfigDefinition: Config.Config<TescoConfig> =
  RawTescoConfigDefinition.pipe(
    Config.map((raw) => {
      const checkedResult: TescoConfig = {
        authBootstrap: {
          initialAuthorization: raw.authorization,
          initialCookieHeader: raw.authCookieHeader,
        },
        catalogue: {
          locale: raw.locale,
          mangoApiKey: raw.mangoApiKey,
          mangoUrl: raw.mangoUrl,
          region: raw.region,
          releaseBranch: raw.releaseBranch,
          suggestionUrl: raw.suggestionUrl,
          transactionPurpose: raw.transactionPurpose,
        },
        softLogin: {
          locale: raw.locale,
          refreshFromUrl: raw.authRefreshFromUrl,
          signInUrl: raw.softRefreshSignInUrl,
        },
      };
      return checkedResult;
    })
  );

const issueEnvironmentVariable: (
  issue: SchemaIssue.Issue
) => TescoEnvironmentVariable | undefined = (issue) => {
  if (issue._tag === "Pointer") {
    const environmentVariable = issue.path.find(
      (segment): segment is TescoEnvironmentVariable =>
        Schema.is(Schema.String)(segment) &&
        tescoEnvironmentVariables.has(segment)
    );

    {
      const checkedResult: TescoEnvironmentVariable | undefined =
        environmentVariable ?? issueEnvironmentVariable(issue.issue);
      return checkedResult;
    }
  }

  if (issue._tag === "Filter" || issue._tag === "Encoding") {
    const checkedResult: TescoEnvironmentVariable | undefined =
      issueEnvironmentVariable(issue.issue);
    return checkedResult;
  }

  if (issue._tag === "Composite" || issue._tag === "AnyOf") {
    const checkedResult: TescoEnvironmentVariable | undefined = issue.issues
      .map(issueEnvironmentVariable)
      .find((environmentVariable) => environmentVariable !== undefined);
    return checkedResult;
  }

  {
    const checkedResult: TescoEnvironmentVariable | undefined = undefined;
    return checkedResult;
  }
};

const issueReason: (issue: SchemaIssue.Issue) => TescoConfigIssue["reason"] = (
  issue
) => {
  if (
    issue._tag === "Pointer" ||
    issue._tag === "Filter" ||
    issue._tag === "Encoding"
  ) {
    const checkedResult: TescoConfigIssue["reason"] = issueReason(issue.issue);
    return checkedResult;
  }

  if (issue._tag === "Composite" || issue._tag === "AnyOf") {
    const checkedResult: TescoConfigIssue["reason"] = issue.issues.some(
      (child) => issueReason(child) === "missing"
    )
      ? "missing"
      : "invalid";
    return checkedResult;
  }

  if (issue._tag === "MissingKey") {
    const checkedResult: TescoConfigIssue["reason"] = "missing";
    return checkedResult;
  }

  if (issue._tag === "InvalidType" && !SchemaIssue.hasInput(issue)) {
    const checkedResult: TescoConfigIssue["reason"] = "missing";
    return checkedResult;
  }

  {
    const checkedResult: TescoConfigIssue["reason"] =
      SchemaIssue.hasInput(issue) && issue.input === undefined
        ? "missing"
        : "invalid";
    return checkedResult;
  }
};

const toTescoConfigError = (error: Config.ConfigError) => {
  if (!Schema.isSchemaError(error.cause)) {
    const checkedResult: TescoConfigError = new TescoConfigError([]);
    return checkedResult;
  }

  const environmentVariable = issueEnvironmentVariable(error.cause.issue);
  {
    const checkedResult: TescoConfigError = new TescoConfigError(
      environmentVariable === undefined
        ? []
        : [
            {
              environmentVariable,
              reason: issueReason(error.cause.issue),
            },
          ]
    );
    return checkedResult;
  }
};

export const loadTescoConfig: Effect.Effect<TescoConfig, TescoConfigError> =
  TescoConfigDefinition.pipe(Effect.mapError(toTescoConfigError));
