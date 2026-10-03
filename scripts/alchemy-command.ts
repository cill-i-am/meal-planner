import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Alchemy commands exposed by the repository's guarded operator scripts. */
type AlchemyCommand = "deploy" | "destroy" | "plan" | "dev";

/** Process boundary used by the command guard after validation succeeds. */
type AlchemyRunner = (
  command: AlchemyCommand,
  args: readonly string[]
) => number;

type D1Preflight = (
  target: string,
  stage: string,
  profile: string,
  evidence: string
) => number;

const runD1Preflight: D1Preflight = (target, stage, profile, evidence) => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("alchemy-d1-preflight.ts", import.meta.url)),
      "verify",
      "--target",
      target,
      "--stage",
      stage,
      "--profile",
      profile,
      "--evidence",
      evidence,
    ],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit" }
  );
  if (result.error !== undefined || result.status === null) {
    throw new Error("D1 release preflight did not complete");
  }
  return result.status;
};

const readOption = (
  args: readonly string[],
  option: string
): string | undefined => {
  for (const [index, argument] of args.entries()) {
    if (argument.startsWith(`${option}=`)) {
      const value = argument.slice(option.length + 1);
      return value.length === 0 ? undefined : value;
    }

    if (argument === option) {
      const value = args[index + 1];
      return value === undefined || value.startsWith("--") ? undefined : value;
    }
  }

  return undefined;
};

const countOption = (args: readonly string[], option: string): number =>
  args.filter(
    (argument) => argument === option || argument.startsWith(`${option}=`)
  ).length;

const deployTarget = (args: readonly string[]) => {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const name = argument?.split("=")[0];
    if (
      name === undefined ||
      !["--stage", "--profile", "--d1-target", "--d1-evidence"].includes(name)
    ) {
      throw new Error(
        "deploy accepts only --stage, --profile, --d1-target and --d1-evidence; alternate stack files and overrides are not allowed"
      );
    }
    if (!argument?.includes("=")) {
      index += 1;
    }
  }
  const target = readOption(args, "--d1-target");
  if (target === undefined || countOption(args, "--d1-target") !== 1) {
    throw new Error("deploy requires exactly one --d1-target file");
  }
  const evidence = readOption(args, "--d1-evidence");
  if (
    evidence === undefined ||
    !/^[a-f0-9]{64}$/u.test(evidence) ||
    countOption(args, "--d1-evidence") !== 1
  ) {
    throw new Error("deploy requires exactly one --d1-evidence digest");
  }
  return { evidence, target };
};

const nativeDevArguments = (args: readonly string[]): readonly string[] => {
  const stage = readOption(args, "--stage");
  const defaultStage = `dev_${userInfo()
    .username.toLowerCase()
    .replaceAll(/[^a-z0-9_-]/gu, "_")}`;
  if (
    stage !== undefined &&
    (!/^dev_[a-z0-9_-]+$/u.test(stage) || countOption(args, "--stage") !== 1)
  ) {
    throw new Error("dev requires an isolated dev_<name> stage");
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const name = argument?.split("=")[0];
    if (
      name === undefined ||
      ![
        "--stage",
        "--profile",
        "--env-file",
        "--include",
        "--exclude",
        "--force",
      ].includes(name)
    ) {
      throw new Error(
        "dev accepts only --stage, --profile, --env-file, --include, --exclude and --force"
      );
    }
    if (name !== "--force" && !argument?.includes("=")) {
      if (args[index + 1] === undefined || args[index + 1]?.startsWith("--")) {
        throw new Error(`${name} requires a value`);
      }
      index += 1;
    }
  }
  return [
    fileURLToPath(new URL("../alchemy.run.ts", import.meta.url)),
    ...args,
    ...(stage === undefined ? ["--stage", defaultStage] : []),
  ];
};

/**
 * Validate an operator command before handing it to the Alchemy process.
 *
 * @returns The child-process exit code when validation succeeds.
 */
export const runAlchemyCommand = (
  command: AlchemyCommand,
  args: readonly string[],
  runner: AlchemyRunner,
  preflight: D1Preflight = runD1Preflight
): number => {
  const [firstArgument] = args;
  const normalizedArgs = firstArgument === "--" ? args.slice(1) : args;
  const requiresExplicitTarget = ["deploy", "destroy"].includes(command);
  const stage = readOption(normalizedArgs, "--stage");

  if (normalizedArgs.includes("--")) {
    throw new Error("unexpected argument separator");
  }

  if (
    normalizedArgs.some(
      (argument) => argument === "--yes" || argument.startsWith("--yes=")
    )
  ) {
    throw new Error("--yes is not allowed by Meal Planner operator scripts");
  }

  if (requiresExplicitTarget && stage === undefined) {
    throw new Error(`${command} requires an explicit --stage`);
  }

  if (requiresExplicitTarget && countOption(normalizedArgs, "--stage") !== 1) {
    throw new Error(`${command} accepts exactly one --stage`);
  }

  if (
    requiresExplicitTarget &&
    readOption(normalizedArgs, "--profile") === undefined
  ) {
    throw new Error(`${command} requires an explicit --profile`);
  }

  if (
    requiresExplicitTarget &&
    countOption(normalizedArgs, "--profile") !== 1
  ) {
    throw new Error(`${command} accepts exactly one --profile`);
  }

  if (command === "destroy" && stage === "prod") {
    throw new Error("refusing to destroy the prod stage");
  }

  if (command === "dev") {
    return runner(command, nativeDevArguments(normalizedArgs));
  }

  if (command === "deploy") {
    const { target, evidence } = deployTarget(normalizedArgs);
    const profile = readOption(normalizedArgs, "--profile");
    if (stage === undefined || profile === undefined) {
      throw new Error("deploy target is incomplete");
    }
    const status = preflight(target, stage, profile, evidence);
    if (status !== 0) {
      return status;
    }
    return runner(command, [
      fileURLToPath(new URL("../alchemy.run.ts", import.meta.url)),
      "--stage",
      stage,
      "--profile",
      profile,
    ]);
  }

  return runner(command, normalizedArgs);
};

/** Stable, ignored application secrets for native local development; no cloud credentials. */
const localEnvironmentFile = () => {
  const path = fileURLToPath(new URL("../.dev.vars", import.meta.url));
  if (!existsSync(path)) {
    writeFileSync(
      path,
      [
        `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
        `MEAL_PLANNER_IMPORT_API_TOKEN=${randomBytes(48).toString("base64url")}`,
        `MEAL_PLANNER_IMPORT_ACTOR_ID=${randomBytes(32).toString("hex")}`,
        `MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID=${randomBytes(32).toString("hex")}`,
        "MEAL_PLANNER_EMAIL_DELIVERY_ENABLED=true",
        "MEAL_PLANNER_PRIVATE_DISCOVERY_CONFIG=",
        "",
      ].join("\n"),
      { flag: "wx", mode: 0o600 }
    );
  }
  return path;
};

const runAlchemyProcess: AlchemyRunner = (command, args) => {
  const alchemyCli = fileURLToPath(
    new URL("cli.js", import.meta.resolve("alchemy/bin/alchemy.js"))
  );
  const commandArgs =
    command === "dev" && readOption(args, "--env-file") === undefined
      ? [...args, "--env-file", localEnvironmentFile()]
      : args;
  const result = spawnSync(
    process.execPath,
    [alchemyCli, command, ...commandArgs],
    {
      cwd:
        command === "deploy" || command === "dev"
          ? fileURLToPath(new URL("../", import.meta.url))
          : process.cwd(),
      stdio: "inherit",
    }
  );

  if (result.error !== undefined) {
    throw new Error("failed to start the Alchemy CLI", { cause: result.error });
  }

  if (result.status === null) {
    throw new Error("Alchemy CLI exited without a status code");
  }

  return result.status;
};

const isAlchemyCommand = (value: string | undefined): value is AlchemyCommand =>
  value === "deploy" ||
  value === "destroy" ||
  value === "plan" ||
  value === "dev";

const [, entrypoint, command] = process.argv;
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  try {
    if (!isAlchemyCommand(command)) {
      throw new Error("expected one of: dev, plan, deploy, destroy");
    }

    process.exitCode = runAlchemyCommand(
      command,
      process.argv.slice(3),
      runAlchemyProcess
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown command guard failure";
    process.stderr.write(`Meal Planner Alchemy guard: ${message}\n`);
    process.exitCode = 1;
  }
}
