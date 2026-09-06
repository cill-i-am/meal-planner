import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runAlchemyCommand } from "./alchemy-command.js";

describe("Alchemy command guard", () => {
  const deployArgs = [
    "--stage",
    "fixture",
    "--profile",
    "fixture",
    "--d1-target",
    "/tmp/d1-target.json",
    "--d1-evidence",
    "a".repeat(64),
  ];

  it("runs fresh D1 verification before the canonical deployment and strips evidence arguments", () => {
    const calls: unknown[] = [];
    expect(
      runAlchemyCommand(
        "deploy",
        deployArgs,
        (command, args) => {
          calls.push({ args, command });
          return 17;
        },
        (...args) => {
          calls.push(args);
          return 0;
        }
      )
    ).toBe(17);
    expect(calls).toEqual([
      ["/tmp/d1-target.json", "fixture", "fixture", "a".repeat(64)],
      {
        args: [
          fileURLToPath(new URL("../alchemy.run.ts", import.meta.url)),
          "--stage",
          "fixture",
          "--profile",
          "fixture",
        ],
        command: "deploy",
      },
    ]);
  });

  it("never starts Alchemy after evidence drift, missing recovery or a failed preflight", () => {
    let invoked = false;
    expect(
      runAlchemyCommand(
        "deploy",
        deployArgs,
        () => {
          invoked = true;
          return 0;
        },
        () => 1
      )
    ).toBe(1);
    expect(invoked).toBe(false);
  });

  it("does not fall back to deployment when the preflight cannot start", () => {
    let invoked = false;
    expect(() =>
      runAlchemyCommand(
        "deploy",
        deployArgs,
        () => {
          invoked = true;
          return 0;
        },
        () => {
          throw new Error("preflight process failed");
        }
      )
    ).toThrow("preflight process failed");
    expect(invoked).toBe(false);
  });

  it.each([
    "another-stack.ts",
    "--env-file=.env.other",
    "--adopt",
    "--force",
    "--dry-run",
    "--profile=second",
    "--d1-target=other.json",
    "--d1-evidence=bad",
  ])("rejects deploy override %s before preflight or Alchemy", (extra) => {
    let invoked = false;
    expect(() =>
      runAlchemyCommand(
        "deploy",
        [...deployArgs, extra],
        () => {
          invoked = true;
          return 0;
        },
        () => {
          invoked = true;
          return 0;
        }
      )
    ).toThrow();
    expect(invoked).toBe(false);
  });

  it("requires frozen target and reviewed evidence", () => {
    const runner = () => {
      throw new Error(`must not reach runner for ${deployArgs.join(" ")}`);
    };
    expect(() =>
      runAlchemyCommand(
        "deploy",
        ["--stage=fixture", "--profile=fixture"],
        runner
      )
    ).toThrow("--d1-target");
    expect(() =>
      runAlchemyCommand(
        "deploy",
        ["--stage=fixture", "--profile=fixture", "--d1-target=target.json"],
        runner
      )
    ).toThrow("--d1-evidence");
  });

  it("transforms NodeNext source imports before planning without cloud state", () => {
    const script = fileURLToPath(
      new URL("alchemy-command.ts", import.meta.url)
    );
    const fixture = fileURLToPath(
      new URL("fixtures/alchemy-stack-loader.ts", import.meta.url)
    );
    const tsx = fileURLToPath(
      new URL("../node_modules/.bin/tsx", import.meta.url)
    );
    const result = spawnSync(
      tsx,
      [script, "plan", fixture, "--stage", "loader-test"],
      { encoding: "utf-8" }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Plan: no changes");
  }, 15_000);

  it("rejects deploy without an explicit stage before invoking Alchemy", () => {
    let invoked = false;

    expect(() =>
      runAlchemyCommand("deploy", ["--profile", "sandbox"], () => {
        invoked = true;
        return 0;
      })
    ).toThrowError("deploy requires an explicit --stage");
    expect(invoked).toBe(false);
  });

  it("rejects deploy without an explicit profile before invoking Alchemy", () => {
    let invoked = false;

    expect(() =>
      runAlchemyCommand("deploy", ["--stage", "dev_cillian"], () => {
        invoked = true;
        return 0;
      })
    ).toThrowError("deploy requires an explicit --profile");
    expect(invoked).toBe(false);
  });

  it("rejects destroy without an explicit stage before invoking Alchemy", () => {
    let invoked = false;

    expect(() =>
      runAlchemyCommand("destroy", ["--profile=sandbox"], () => {
        invoked = true;
        return 0;
      })
    ).toThrowError("destroy requires an explicit --stage");
    expect(invoked).toBe(false);
  });

  it("refuses to destroy the production stage before invoking Alchemy", () => {
    let invoked = false;

    expect(() =>
      runAlchemyCommand(
        "destroy",
        ["--stage=prod", "--profile=production"],
        () => {
          invoked = true;
          return 0;
        }
      )
    ).toThrowError("refusing to destroy the prod stage");
    expect(invoked).toBe(false);
  });

  it("rejects non-interactive approval before invoking Alchemy", () => {
    let invoked = false;

    expect(() =>
      runAlchemyCommand("plan", ["--stage", "dev_cillian", "--yes"], () => {
        invoked = true;
        return 0;
      })
    ).toThrowError("--yes is not allowed by Meal Planner operator scripts");
    expect(invoked).toBe(false);
  });

  it("forwards an approved preview destroy target unchanged", () => {
    const args = ["--stage", "pr-42", "--profile", "ci"] as const;
    let received:
      | { readonly args: readonly string[]; readonly command: string }
      | undefined;

    const exitCode = runAlchemyCommand(
      "destroy",
      args,
      (command, childArgs) => {
        received = { args: childArgs, command };
        return 17;
      }
    );

    expect(exitCode).toBe(17);
    expect(received).toEqual({ args, command: "destroy" });
  });

  it("removes pnpm's argument separator before validation and forwarding", () => {
    let received: readonly string[] | undefined;

    runAlchemyCommand(
      "destroy",
      ["--", "--stage", "pr-42", "--profile", "ci"],
      (_command, args) => {
        received = args;
        return 0;
      }
    );

    expect(received).toEqual(["--stage", "pr-42", "--profile", "ci"]);
  });

  it("rejects an extra argument separator before invoking Alchemy", () => {
    let invoked = false;

    expect(() =>
      runAlchemyCommand(
        "destroy",
        ["--", "--", "--stage", "pr-42", "--profile", "ci"],
        () => {
          invoked = true;
          return 0;
        }
      )
    ).toThrowError("unexpected argument separator");
    expect(invoked).toBe(false);
  });

  it("rejects ambiguous duplicate destroy stages before invoking Alchemy", () => {
    let invoked = false;

    expect(() =>
      runAlchemyCommand(
        "destroy",
        ["--stage", "pr-42", "--stage=prod", "--profile", "ci"],
        () => {
          invoked = true;
          return 0;
        }
      )
    ).toThrowError("destroy accepts exactly one --stage");
    expect(invoked).toBe(false);
  });
});
