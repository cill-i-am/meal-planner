"""Behavioral fixture tests for the public documentation-checking interface."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "check-docs.py"
SPEC = importlib.util.spec_from_file_location("docs_check", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class DocumentationCheckTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def errors(self):
        return CHECKER.check(self.root)[0]

    def test_local_file_and_directory_links_pass(self):
        self.write("README.md", "[Page](docs/page.md) and [directory](docs/)\n")
        self.write("docs/page.md", "# Page\n[Home](../README.md)\n")
        self.assertEqual(self.errors(), [])

    def test_missing_target_names_origin_and_link(self):
        self.write("README.md", "# Root\n\n[Missing](docs/absent.md)\n")
        self.assertEqual(self.errors(), ["README.md:3: missing target: docs/absent.md"])

    def test_missing_anchor_fails(self):
        self.write("README.md", "[Missing](#not-here)\n# Here\n")
        self.assertIn("missing heading: #not-here", self.errors()[0])

    def test_duplicate_and_explicit_anchors(self):
        self.write("README.md", "[A](#same-1) [B](#custom)\n# Same\n# Same\n<a id='custom'></a>\n")
        self.assertEqual(self.errors(), [])

    def test_heading_slug_handles_code_and_punctuation(self):
        self.write("README.md", "[A](#runtime-foo--accepted-2026-09-19)\n## Runtime `foo` — accepted 2026-09-19\n")
        self.assertEqual(self.errors(), [])

    def test_heading_with_closing_hashes_and_unicode(self):
        self.write("README.md", "[A](#café-rules)\n## Café rules ##\n")
        self.assertEqual(self.errors(), [])

    def test_fenced_and_inline_examples_are_not_links(self):
        self.write("README.md", "`[example](absent.md)`\n```markdown\n[bad](absent.md)\n```\n~~~md\n[bad](absent.md)\n~~~\n")
        self.assertEqual(self.errors(), [])

    def test_link_after_code_fence_is_checked(self):
        self.write("README.md", "````md\n```\n[example](absent.md)\n````\n[real](missing.md)\n")
        self.assertEqual(len(self.errors()), 1)
        self.assertIn("missing target: missing.md", self.errors()[0])

    def test_html_comments_are_not_links(self):
        self.write("README.md", "<!-- [hidden](absent.md) -->\n")
        self.assertEqual(self.errors(), [])

    def test_reference_definition_target_is_checked(self):
        self.write("README.md", "Use [the guide][guide].\n\n[guide]: docs/absent.md\n")
        self.assertEqual(len(self.errors()), 1)

    def test_multiline_label_and_encoded_space(self):
        self.write("README.md", "[Wrapped\nlabel](docs/a%20b.md#the-heading)\n")
        self.write("docs/a b.md", "# The heading\n")
        self.assertEqual(self.errors(), [])

    def test_angle_target_and_optional_title(self):
        self.write("README.md", '[one](<a b.md>) [two](a%20b.md "Title")\n')
        self.write("a b.md", "# Hello\n")
        self.assertEqual(self.errors(), [])

    def test_parentheses_in_filename_and_link_label(self):
        self.write("README.md", "[Function](docs/call(x).md)\n")
        self.write("docs/call(x).md", "# Example\n")
        self.assertEqual(self.errors(), [])

    def test_image_and_query_target(self):
        self.write("README.md", "![Sample](image.png?v=1)\n")
        (self.root / "image.png").write_bytes(b"fixture")
        self.assertEqual(self.errors(), [])

    def test_external_links_are_not_fetched(self):
        self.write("README.md", "[Web](https://invalid.invalid/a) [Mail](mailto:example@invalid.invalid)\n")
        self.assertEqual(self.errors(), [])

    def test_repository_escape_is_rejected(self):
        self.write("README.md", "[Escape](../outside.md)\n")
        self.assertIn("escapes repository", self.errors()[0])

    def test_dependency_and_generated_directories_are_excluded(self):
        self.write("node_modules/foo/README.md", "[Broken](absent.md)\n")
        self.write("README.md", "# Actual source\n")
        self.assertEqual(self.errors(), [])

    def test_empty_repository_does_not_require_project_guidance(self):
        self.assertEqual(CHECKER.check(self.root), ([], 0))

    def test_cli_failure_returns_nonzero_and_specific_diagnostic(self):
        self.write("README.md", "[Missing](missing.md)\n")
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing target: missing.md", result.stderr)
        self.assertIn("Checked 1 Markdown files", result.stdout)


if __name__ == "__main__":
    unittest.main()
