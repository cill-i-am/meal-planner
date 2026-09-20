# Make and verify a documentation change

Learn the repository's documentation path without provider credentials or an
application install. Start at the repository root with Python 3 and a clean
working tree (or an isolated checkout).

First, run `python3 scripts/check-docs.py`. A successful result reports the
checked documents with no errors.

Create a temporary file named `docs/tutorials/local-link-exercise.md` containing:

```markdown
# Local link exercise

[Documentation map](../README.md)
```

Run the checker again. The relative link resolves to the docs map and passes.
Change its target to `../missing-page.md` and rerun. The checker must exit nonzero
and identify the missing target in your exercise file. Restore `../README.md`;
the same command passes again.

Delete the temporary exercise file. Run `git status --short` and
`git diff --check`; the exercise should leave no tracked changes. You have now
followed a documentation link, observed a real failing check and repaired it.
For a real change, update its [owning record](../reference/documentation.md), verify
it and include only the intended diff. This exercise does not test application
behavior or establish that a coding agent read a document.
