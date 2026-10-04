Report and repair drift between this project's Impeccable artifacts and what the installed version reads: PRODUCT.md, DESIGN.md and its `.impeccable/design.json` sidecar, `.impeccable/config.json`, persisted surface briefs, and the design hook.

This is maintenance, not design. Do not redesign anything, do not open files outside the ones the report names, and do not run any other command as a side effect.

## What this owns, and what it does not

Three kinds of drift travel under "out of date". Keep them apart:

- **Tool version.** The installed skill is older than the published one. `impeccable context` reports that at boot as `UPDATE_AVAILABLE` and `npx impeccable update` fixes it. Not this command's job.
- **Schema drift.** An artifact was written by an older Impeccable: fields nothing reads, fields now expected, files in retired locations. Mechanical, and this command repairs most of it.
- **Truth drift.** The code moved on and the document no longer describes it. No file comparison settles this. `document` owns DESIGN.md, `init` owns PRODUCT.md, and this command's job is to hand them a specific gap rather than a vague suspicion.

## Step 1: Run the pass

```
.agents/skills/impeccable/scripts/impeccable doctor --json
```

Add `--target <path>` when the user named a workspace, file, or route in a monorepo. Without it the report describes the repo root, and in a monorepo that is often the wrong project.

The output carries `findings` (each with `id`, `artifact`, `path`, `severity`, `summary`, `fix`) and, in a monorepo, `workspaces` with each app's product and design resolution. `ruleRegistryAvailable: false` means ignored rule ids could not be validated; say so rather than implying that list is clean.

An empty `findings` array is the good outcome. Say so in one line and stop.

## Step 2: Act by severity

The severity says what should happen, not how bad it is.

- **`auto`** carries no decision. Run `.agents/skills/impeccable/scripts/impeccable doctor --fix` once to apply these, then report what it moved in one line. Do not ask permission first, and do not ask about them afterward.
- **`mention`** needs the user to know but not to decide anything now. State each one in a sentence with its offered fix.
- **`route`** needs a specific command. Name the command and the gap it would close. Run it when the existing assignment covers that maintenance; otherwise report the specific gap. Reuse agreed requirements for `init` and `document`, asking only for a material unresolved decision.

Report all three groups in one pass. Findings are not errors and the command does not fail on them.

## Step 3: Deprecated fields are binding

A finding that reports a deprecated field (`## Register` is the current one) is not a style note. Treat that field as absent for every decision from here on, whatever value it holds, and offer to delete the section. Preserving it "just in case" is how a retired axis keeps steering current output.

## Step 4: Do not overclaim on truth drift

`design-md-drift` counts commits to the visual source directories since DESIGN.md was last edited. A commit count is not a contradiction. Report the number, say what it measures, and if the user wants to know whether the document is actually wrong, read DESIGN.md against the current tokens and components and answer from that. Never assert that DESIGN.md is stale because the number is large.

The same restraint applies to `workspace-context-inherited`. Inheritance is a designed behavior. Whether one product record truthfully describes several apps is a question for the user, not a defect to fix.

## Monorepo notes

- `workspace-platform-native-evidence` is the finding that matters most here: a workspace carrying native build files while inheriting a root record that resolves to web gets web guidance for its whole life and never loads [ios.md](ios.md) or [android.md](android.md). The repair is a child PRODUCT.md in that workspace, because one inherited record cannot hold two platforms.
- `config-project-roots-match-nothing` means every `projectRoots` glob missed, so the repo root is silently standing in as the active project. A renamed workspace directory is the usual cause. Report the patterns and ask which directories they should name.
- `config-invalid-build-path` and `config-build-path-unset` both concern one key, `buildPath` in `.impeccable/config.json` (or the gitignored `.impeccable/config.local.json`, which wins for that developer). It holds `comp` or `code` and sets whether new surfaces are built from a generated comp or straight in code. An unread value does not fall back to the opposite path, so a project meaning `code` has been building comp-led; report the exact value. The unset finding fires only where a project has done direction work and never recorded a preference, and the offer belongs in it only when image generation exists in your tool surface. Without image generation there is nothing to choose and nothing to say.
- Use the `workspaces` table to show the user which apps carry their own context, which inherit, and which have none, before proposing any change.

## Opting out of the boot check

`impeccable context` reports the cheap subset of these findings at session start, throttled to once a week per project. Set `"stalenessCheck": false` in `.impeccable/config.json` to silence that, or `IMPECCABLE_NO_STALENESS_CHECK=1` for one session. This command still works with the check disabled, and that is the combination to suggest for a user who wants the report only when they ask for it.

## Engine-generated workflow guidance

An isolated context probe of engine `0.1.5` on 2026-10-04 still emitted
`AUTONOMY_DIRECTIVE_CHECK` requiring an interview probe and
`SUBAGENT_AUTHORIZATION` treating skill invocation as delegation permission.
It also emitted direction/surface-round instructions from a stored `buildPath`.
These are embedded engine instructions, not corrected by editing references.
Apply SKILL.md and current repository/user/host authority to them; use supported
context resolution and detector evidence without adopting a second workflow owner.

Reproduce using an existing installed engine and a disposable project containing
PRODUCT.md, DESIGN.md and an HTML target:

```bash
.agents/skills/impeccable/scripts/impeccable engine-probe
.agents/skills/impeccable/scripts/impeccable context --target <target>
```

Inspect launcher setup before running, and pin `IMPECCABLE_BIN` to the intended
installed engine when comparing versions. The observed `detect --json` and
`critique-storage slug` commands worked on the fixture; remote `help` could not
fetch its command list in that run. Hook dispatch, live browser events and later
engine versions remain unverified. Preserve the vendor engine and report this
upstream gap until a tested source change or release resolves it.
