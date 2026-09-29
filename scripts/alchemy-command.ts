import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Alchemy commands exposed by the repository's guarded operator scripts. */
type AlchemyCommand = "deploy" | "destroy" | "plan";

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
type FreshPreflight = (
  account: string,
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

const runFreshPreflight: FreshPreflight = (
  account,
  stage,
  profile,
  evidence
) => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("alchemy-d1-preflight.ts", import.meta.url)),
      "fresh-verify",
      "--account",
      account,
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
    throw new Error("Fresh D1 release preflight did not complete");
  }
  return result.status;
};

const runResumePreflight: D1Preflight = (target, stage, profile, evidence) => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("alchemy-d1-preflight.ts", import.meta.url)),
      "resume-verify",
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
    throw new Error("Resumed D1 release preflight did not complete");
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

const freshDeployTarget = (args: readonly string[]) => {
  const freshAccount = readOption(args, "--fresh-account");
  const freshEvidence = readOption(args, "--fresh-evidence");
  if (
    freshAccount === undefined &&
    freshEvidence === undefined &&
    countOption(args, "--fresh-account") === 0 &&
    countOption(args, "--fresh-evidence") === 0
  ) {
    return null;
  }
  if (
    countOption(args, "--d1-target") > 0 ||
    countOption(args, "--d1-evidence") > 0 ||
    countOption(args, "--resume-target") > 0 ||
    countOption(args, "--resume-evidence") > 0
  ) {
    throw new Error(
      "Fresh and existing D1 deployment modes are mutually exclusive"
    );
  }
  if (
    freshAccount === undefined ||
    !/^[a-f0-9]{32}$/u.test(freshAccount) ||
    countOption(args, "--fresh-account") !== 1
  ) {
    throw new Error("fresh deploy requires exactly one --fresh-account ID");
  }
  if (
    freshEvidence === undefined ||
    !/^[a-f0-9]{64}$/u.test(freshEvidence) ||
    countOption(args, "--fresh-evidence") !== 1
  ) {
    throw new Error(
      "fresh deploy requires exactly one --fresh-evidence digest"
    );
  }
  return {
    account: freshAccount,
    evidence: freshEvidence,
    mode: "fresh",
  } as const;
};

const resumeDeployTarget = (args: readonly string[]) => {
  const target = readOption(args, "--resume-target");
  const evidence = readOption(args, "--resume-evidence");
  if (
    target === undefined &&
    evidence === undefined &&
    countOption(args, "--resume-target") === 0 &&
    countOption(args, "--resume-evidence") === 0
  ) {
    return null;
  }
  if (
    countOption(args, "--d1-target") > 0 ||
    countOption(args, "--d1-evidence") > 0 ||
    countOption(args, "--fresh-account") > 0 ||
    countOption(args, "--fresh-evidence") > 0
  ) {
    throw new Error(
      "Resume and other D1 deployment modes are mutually exclusive"
    );
  }
  if (target === undefined || countOption(args, "--resume-target") !== 1) {
    throw new Error("resume deploy requires exactly one --resume-target file");
  }
  if (
    evidence === undefined ||
    !/^[a-f0-9]{64}$/u.test(evidence) ||
    countOption(args, "--resume-evidence") !== 1
  ) {
    throw new Error(
      "resume deploy requires exactly one --resume-evidence digest"
    );
  }
  return { evidence, mode: "resume", target } as const;
};

const deployTarget = (args: readonly string[]) => {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const name = argument?.split("=")[0];
    if (
      name === undefined ||
      ![
        "--stage",
        "--profile",
        "--d1-target",
        "--d1-evidence",
        "--fresh-account",
        "--fresh-evidence",
        "--resume-target",
        "--resume-evidence",
      ].includes(name)
    ) {
      throw new Error(
        "deploy accepts only --stage, --profile and one guarded D1 evidence mode; alternate stack files and overrides are not allowed"
      );
    }
    if (!argument?.includes("=")) {
      index += 1;
    }
  }
  const fresh = freshDeployTarget(args);
  if (fresh !== null) {
    return fresh;
  }
  const resumed = resumeDeployTarget(args);
  if (resumed !== null) {
    return resumed;
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
  return { evidence, mode: "existing", target } as const;
};

const validateSharedOptions = (
  command: AlchemyCommand,
  args: readonly string[]
): string | undefined => {
  const requiresExplicitTarget = command === "deploy" || command === "destroy";
  const stage = readOption(args, "--stage");
  if (args.includes("--")) {
    throw new Error("unexpected argument separator");
  }
  if (
    args.some(
      (argument) => argument === "--yes" || argument.startsWith("--yes=")
    )
  ) {
    throw new Error("--yes is not allowed by Meal Planner operator scripts");
  }
  if (requiresExplicitTarget && stage === undefined) {
    throw new Error(`${command} requires an explicit --stage`);
  }
  if (requiresExplicitTarget && countOption(args, "--stage") !== 1) {
    throw new Error(`${command} accepts exactly one --stage`);
  }
  if (requiresExplicitTarget && readOption(args, "--profile") === undefined) {
    throw new Error(`${command} requires an explicit --profile`);
  }
  if (requiresExplicitTarget && countOption(args, "--profile") !== 1) {
    throw new Error(`${command} accepts exactly one --profile`);
  }
  if (command === "destroy" && stage === "prod") {
    throw new Error("refusing to destroy the prod stage");
  }
  return stage;
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
  preflight: D1Preflight = runD1Preflight,
  freshPreflight: FreshPreflight = runFreshPreflight,
  resumePreflight: D1Preflight = runResumePreflight
): number => {
  const [firstArgument] = args;
  const normalizedArgs = firstArgument === "--" ? args.slice(1) : args;
  const stage = validateSharedOptions(command, normalizedArgs);

  if (command === "deploy") {
    const target = deployTarget(normalizedArgs);
    const profile = readOption(normalizedArgs, "--profile");
    if (stage === undefined || profile === undefined) {
      throw new Error("deploy target is incomplete");
    }
    let status: number;
    if (target.mode === "fresh") {
      status = freshPreflight(target.account, stage, profile, target.evidence);
    } else if (target.mode === "resume") {
      status = resumePreflight(target.target, stage, profile, target.evidence);
    } else {
      status = preflight(target.target, stage, profile, target.evidence);
    }
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

const runAlchemyProcess: AlchemyRunner = (command, args) => {
  const alchemyCli = fileURLToPath(
    import.meta.resolve("alchemy/bin/alchemy.js")
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", alchemyCli, command, ...args],
    {
      cwd:
        command === "deploy"
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
  value === "deploy" || value === "destroy" || value === "plan";

const [, entrypoint, command] = process.argv;
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  try {
    if (!isAlchemyCommand(command)) {
      throw new Error("expected one of: plan, deploy, destroy");
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
