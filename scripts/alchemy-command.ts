import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Alchemy commands exposed by the repository's guarded operator scripts. */
type AlchemyCommand = "deploy" | "destroy" | "plan";

/** Process boundary used by the command guard after validation succeeds. */
type AlchemyRunner = (
  command: AlchemyCommand,
  args: readonly string[]
) => number;

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

/**
 * Validate an operator command before handing it to the Alchemy process.
 *
 * @returns The child-process exit code when validation succeeds.
 */
export const runAlchemyCommand = (
  command: AlchemyCommand,
  args: readonly string[],
  runner: AlchemyRunner
): number => {
  const [firstArgument] = args;
  const normalizedArgs = firstArgument === "--" ? args.slice(1) : args;
  const requiresExplicitTarget = command === "deploy" || command === "destroy";
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

  return runner(command, normalizedArgs);
};

const runAlchemyProcess: AlchemyRunner = (command, args) => {
  const alchemyCli = fileURLToPath(
    import.meta.resolve("alchemy/bin/alchemy.js")
  );
  const sourceLoader = fileURLToPath(
    new URL("node-next-source-loader.js", import.meta.url)
  );
  const result = spawnSync(
    process.execPath,
    ["--import", sourceLoader, alchemyCli, command, ...args],
    {
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
