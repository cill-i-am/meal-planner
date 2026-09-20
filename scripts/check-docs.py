#!/usr/bin/env python3
"""Check repository Markdown links, record metadata and instruction entrypoints.

Dependency-free and read-only. Examples inside fenced/inline code are not links.
External URLs are deliberately not fetched. This verifies structure, not whether
an agent read a page or whether a documented product claim is true.
"""
from __future__ import annotations

import argparse
import html
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote, urlsplit

EXCLUDED = {".git", "node_modules", "dist", "coverage", ".alchemy", ".wrangler"}
STATUSES = {"proposed", "ready", "active", "blocked", "done", "cancelled"}
TOPICS = {
    "ASYNC_AND_WORKFLOWS", "BOUNDARIES_AND_PARSING", "CLOUDFLARE_ARCHITECTURE",
    "DATA_FLOW_AND_STATE", "DESIGNING_MODULES", "DOMAIN_MODELING", "EFFECT",
    "ERROR_HANDLING", "FEATURE_SLICE_ARCHITECTURE", "OBSERVABILITY",
    "TESTING_AND_VERIFICATION", "TYPESCRIPT_CONTRACTS", "VOCABULARY",
}


def prose(source: str) -> str:
    """Blank code fences/comments while retaining offsets for diagnostics."""
    lines = source.splitlines(keepends=True)
    output: list[str] = []
    fence = ""
    length = 0
    for line in lines:
        match = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            if re.match(r"^ {0,3}" + re.escape(fence) + "{" + str(length) + r",}\s*$", line):
                fence = ""
            output.append("\n" if line.endswith("\n") else "")
        elif match:
            fence, length = match[1][0], len(match[1])
            output.append("\n" if line.endswith("\n") else "")
        else:
            output.append(line)
    result = "".join(output)
    return re.sub(r"<!--[\s\S]*?-->", lambda m: "\n" * m[0].count("\n"), result)


def slug(label: str) -> str:
    label = re.sub(r"<[^>]*>", "", label)
    label = html.unescape(label).strip().lower()
    label = "".join(c for c in label if c in "-_ " or unicodedata.category(c)[0] not in "PS")
    return label.replace(" ", "-")


def anchors(source: str) -> set[str]:
    content = prose(source)
    found: set[str] = set()
    for m in re.finditer(r"(?m)^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$", content):
        base = slug(m[1]); value = base; suffix = 0
        while value in found:
            suffix += 1; value = f"{base}-{suffix}"
        found.add(value)
    # Explicit anchors used by a few tool reference pages.
    found.update(m[1] for m in re.finditer(r"\b(?:id|name)=[\"']([^\"']+)[\"']", content))
    return found


def links(source: str) -> list[tuple[int, str]]:
    """Read inline links/images and reference definitions (including wrapped labels)."""
    content = prose(source)
    # Inline code is not a Markdown link. Leave text inside link labels intact.
    content = re.sub(r"(`+)([^`]|(?!\1)`)*?\1", lambda m: " " * len(m[0]), content)
    results: list[tuple[int, str]] = []
    for m in re.finditer(r"(?m)^ {0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))", content):
        results.append((content.count("\n", 0, m.start()) + 1, m[1] or m[2]))
    # Scan destinations after a closing label. Balanced parentheses allow URL paths.
    for m in re.finditer(r"(?<!\\)\]\(\s*", content):
        start = m.end(); i = start
        if i >= len(content):
            continue
        if content[i] == "<":
            end = content.find(">", i + 1)
            if end < 0:
                continue
            target = content[i + 1:end]
        else:
            depth = 0
            while i < len(content):
                c = content[i]
                if c == "\\" and i + 1 < len(content):
                    i += 2; continue
                if c == "(": depth += 1
                if c == ")":
                    if depth == 0: break
                    depth -= 1
                if c.isspace() and depth == 0: break
                i += 1
            target = content[start:i]
        results.append((content.count("\n", 0, m.start()) + 1, target))
    return results


def markdown_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.md") if not (set(p.relative_to(root).parts) & EXCLUDED))


def check(root: Path, *, repository_contract: bool = True) -> tuple[list[str], int]:
    root = root.resolve()
    errors: list[str] = []
    files = markdown_files(root)
    contents = {p: p.read_text(encoding="utf-8") for p in files}
    cache: dict[Path, set[str]] = {}
    for path, source in contents.items():
        name = path.relative_to(root).as_posix()
        for line, raw in links(source):
            raw = html.unescape(raw)
            if not raw or raw.startswith("//"):
                continue
            try:
                url = urlsplit(raw)
            except ValueError:
                errors.append(f"{name}:{line}: invalid link {raw!r}"); continue
            if url.scheme:
                continue
            decoded = unquote(url.path)
            target = (root / decoded.lstrip("/") if decoded.startswith("/") else path.parent / decoded).resolve() if decoded else path
            if not target.is_relative_to(root):
                errors.append(f"{name}:{line}: link escapes repository: {raw}"); continue
            if not target.exists():
                errors.append(f"{name}:{line}: missing target: {raw}"); continue
            if url.fragment and target.is_file() and target.suffix == ".md":
                if target not in cache:
                    cache[target] = anchors(contents.get(target, target.read_text(encoding="utf-8")))
                if unquote(url.fragment) not in cache[target]:
                    errors.append(f"{name}:{line}: missing heading: {raw}")
        if name.startswith("docs/plans/") and path.name != "_template.md" and (path.name != "README.md" or re.search(r"(?m)^Status:", source)):
            status = re.search(r"(?m)^Status: (\S+)", source)
            owner = re.search(r"(?m)^Owner: (\S.*)$", source)
            if not status or status[1] not in STATUSES:
                errors.append(f"{name}: missing/invalid plan Status")
            if not owner:
                errors.append(f"{name}: missing plan Owner")
    ids: dict[str, str] = {}
    for path, source in contents.items():
        if path.parent != root / "docs/decisions" or path.name in {"README.md", "_template.md"}:
            continue
        match = re.match(r"# ((?:ADR|PDR)-\d+)\b", source)
        if not match:
            errors.append(f"{path.relative_to(root)}: missing decision identifier"); continue
        identifier = match[1]
        if identifier in ids:
            errors.append(f"duplicate decision {identifier}: {ids[identifier]} and {path.relative_to(root)}")
        ids[identifier] = str(path.relative_to(root))
    if repository_contract:
        required = ["AGENTS.md", "docs/README.md", "docs/reference/engineering/README.md", ".agents/skills/coding-standards/SKILL.md", "apps/web/PRODUCT.md", "apps/web/DESIGN.md"]
        required += [f"docs/reference/engineering/{topic}.md" for topic in sorted(TOPICS)]
        for name in required:
            if not (root / name).is_file(): errors.append(f"missing retained entrypoint/reference: {name}")
        for name in ["docs/agents/execution-policy.md", "docs/agents/repository-workflow.md", "docs/reference/delivery-policy.md"]:
            if (root / name).exists(): errors.append(f"retired workflow policy restored: {name}")
        # Check routes, not wording. A successful check does not prove agent attention.
        routes = {"AGENTS.md": "docs/reference/engineering/README.md", ".agents/skills/coding-standards/SKILL.md": "docs/reference/engineering/README.md"}
        for start, expected in routes.items():
            p = root / start
            if p.exists():
                destinations = {(p.parent / unquote(urlsplit(link).path)).resolve() for _, link in links(p.read_text()) if not urlsplit(link).scheme}
                if root / expected not in destinations: errors.append(f"{start}: missing engineering-standards route")
        index = root / "docs/reference/engineering/README.md"
        if index.exists():
            destinations = {(index.parent / unquote(urlsplit(link).path)).resolve() for _, link in links(index.read_text()) if not urlsplit(link).scheme}
            for topic in sorted(TOPICS):
                if index.parent / f"{topic}.md" not in destinations:
                    errors.append(f"{index.relative_to(root)}: missing topic route: {topic}")
    return errors, len(files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    errors, count = check(args.root)
    for error in errors: print(error, file=sys.stderr)
    print(f"Checked {count} Markdown files; {len(errors)} errors.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
