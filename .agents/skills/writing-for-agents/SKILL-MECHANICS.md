# Skill mechanics in Codex

The skill-specific branch of [writing-for-agents](SKILL.md) covers invocation and
routing. Use the installed skill-creator guidance for Codex metadata and validation.

## Invocation

Every SKILL.md needs a name and a discriminating description. Automatic discovery
is the default. Preserve a skill's existing invocation policy; create a new
explicit-only skill only when the user requests that behavior.

Codex stores invocation policy in `agents/openai.yaml`:

```yaml
policy:
  allow_implicit_invocation: false
```

False makes the skill explicit-only. It remains available through a user request
or an explicit route that reads its SKILL.md. Do not use Claude's
`disable-model-invocation` frontmatter to configure Codex. A routed dependency can
be loaded with the host's skill capability or read directly from its known path;
do not invent a Skill tool or require the user to invoke each dependency manually.

## References and routers

Shared reference belongs in one discoverable file. Link it from each consumer and
load it when relevant. Split a skill when it has an independently useful trigger,
not merely to move paragraphs into more files. Pstack already owns this repo's
execution route; additional skills supply methods rather than a competing router.
