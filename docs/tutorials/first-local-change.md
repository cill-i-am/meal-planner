# Make and verify a documentation change

Try the documentation checker without provider credentials or an application
install. You need Python 3 and a clean working tree or a separate checkout.
Start at the repository root.

1. Run `python3 scripts/check-docs.py`. It should report the documents checked
   and no errors.
2. Create `docs/tutorials/local-link-exercise.md` with this content:

   ```markdown
   # Local link exercise

   [Documentation map](../README.md)
   ```

3. Run the checker again. The link points to the docs map and should pass.
4. Change the link target to `../missing-page.md` and run the checker. It should
   exit with a nonzero status and name the missing target in your exercise file.
5. Restore `../README.md` and check again. The same command should pass.
6. Delete the exercise file. Run `git status --short` and `git diff --check`.
   There should be no tracked changes from the exercise.

You have checked a real link, seen a failure and fixed it. For an actual change,
update the [page that owns the information](../reference/documentation.md), check
it and include only the intended changes in the PR. This exercise does not test
the application or prove that an agent read a document.
