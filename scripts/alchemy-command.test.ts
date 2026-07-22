import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runAlchemyCommand } from "./alchemy-command.js";

describe("Alchemy command guard", () => {
  it("loads NodeNext source imports before planning without cloud state", () => {
    const script = fileURLToPath(
      new URL("alchemy-command.ts", import.meta.url)
    );
    const fixture = fileURLToPath(
      new URL("fixtures/alchemy-stack-loader.ts", import.meta.url)
    );
    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", script, "plan", fixture, "--stage", "loader-test"],
      { encoding: "utf-8" }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Plan: no changes");
  });

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
