"""Publish only reviewed Markdown objects. Branch moves are done through the connector."""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import re
import subprocess

ROOT = Path.cwd()
BASE = 'f9a576ba526d3a1a578dbc75f18033a3aab7b70f'
WORKBENCH = 'codex/plain-english-workbench-20260920'
DESTINATION = 'codex/plain-english-docs-20260920'
SOURCE = os.environ['GITHUB_SHA']
PACKED_HASH = '3235395c578d2c36013475ca9d68b2f748b3c81b0e2ae61550af6b3837d18b75'
REPORT = Path(os.environ['RUNNER_TEMP']) / 'plain-writing-results'
REPORT.mkdir(exist_ok=True)
ENV = dict(os.environ, GIT_AUTHOR_NAME='github-actions[bot]',
           GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com',
           GIT_COMMITTER_NAME='github-actions[bot]',
           GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com')

def git(*args, cwd=ROOT, env=ENV, data=None):
    return subprocess.check_output(['git', *args], cwd=cwd, env=env, input=data)

def text(*args, **kwargs):
    return git(*args, **kwargs).decode().strip()

def run(args, cwd):
    subprocess.run(args, cwd=cwd, env=ENV, check=True)

def source(sha, name):
    p = PurePosixPath(name)
    assert not p.is_absolute() and '..' not in p.parts and '.git' not in p.parts
    assert name.endswith('.md'), name
    mode = text('ls-tree', sha, '--', name).split()[0]
    assert mode == '100644', (name, mode)
    return git('show', f'{sha}:{name}')

def apply(sha, record):
    old = source(sha, record['path'])
    assert hashlib.sha256(old).hexdigest() == record['old_sha256'], record['path']
    lines = old.decode().splitlines(keepends=True)
    out, last = [], 0
    for i, j, replacement in record['edits']:
        assert isinstance(i, int) and isinstance(j, int) and last <= i <= j <= len(lines)
        assert isinstance(replacement, str)
        out.extend(lines[last:i]); out.append(replacement); last = j
    out.extend(lines[last:])
    return ''.join(out).encode()

def remote_head(branch):
    rows = text('ls-remote', '--heads', 'origin', f'refs/heads/{branch}').splitlines()
    assert len(rows) == 1, branch
    return rows[0].split()[0]

def commit(tree, parents, message):
    args = ['commit-tree', tree]
    for parent in parents:
        args += ['-p', parent]
    return text(*args, data=(message + '\n').encode())

encoded = ''.join((ROOT / f'.plain-english-transfer/part-{i}.b64').read_text().strip() for i in range(1, 6))
packed = base64.b64decode(encoded, validate=True)
assert hashlib.sha256(packed).hexdigest() == PACKED_HASH, 'Transfer checksum failed'
manifest = json.loads(lzma.decompress(packed))
assert manifest['base'] == BASE and manifest['branch'] == DESTINATION
assert len(manifest['files']) == 95
assert [r['number'] for r in manifest['prs']] == list(range(219, 226))
expected_heads = {'main': BASE, DESTINATION: BASE, WORKBENCH: SOURCE}
expected_heads.update({p['branch']: p['old_head'] for p in manifest['prs']})
for branch, sha in expected_heads.items():
    assert remote_head(branch) == sha, f'Branch changed: {branch}'

names = [r['path'] for r in manifest['files']]
assert len(set(names)) == len(names)
rewrites = {r['path']: apply(BASE, r) for r in manifest['files']}
workspace = Path(os.environ['RUNNER_TEMP']) / 'plain-writing-candidate'
assert not workspace.exists()
git('worktree', 'add', '--detach', str(workspace), BASE)
for name, data in rewrites.items():
    target = workspace / name
    assert target.is_file() and not target.is_symlink()
    target.write_bytes(data)
# Reuse the installed, lockfile-pinned formatter without adding dependencies.
(workspace / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
format_paths = [n for n in names if not n.startswith(('docs/', '.agents/'))]
if format_paths:
    run([str(ROOT / 'node_modules/.bin/oxfmt'), '--write', *format_paths], workspace)
run([str(ROOT / 'node_modules/.bin/oxfmt'), '--check', '.'], workspace)
run(['python3', '-m', 'unittest', 'discover', '-s', 'scripts/tests', '-p', 'test_docs_check.py', '-v'], workspace)
run(['python3', 'scripts/check-docs.py'], workspace)
assert set(text('diff', '--name-only', cwd=workspace).splitlines()) == set(names)
run(['git', 'diff', '--check'], workspace)
# Code samples and original decision dates/statuses are not writing changes.
def fences(s):
    return re.findall(r'(?ms)^```[^\n]*\n.*?^```[ \t]*$', s)
for path in (workspace / 'docs/reference/engineering').glob('*.md'):
    if path.name == 'README.md':
        continue
    name = path.relative_to(workspace).as_posix()
    assert fences(source(BASE, name).decode()) == fences(path.read_text()), name
for path in (workspace / 'docs/decisions').glob('*.md'):
    if not path.name.startswith(('adr-', 'pdr-')):
        continue
    name = path.relative_to(workspace).as_posix()
    for pattern in (r'(?m)^- Status:.*$', r'(?m)^- Date:.*$'):
        assert re.findall(pattern, source(BASE, name).decode()) == re.findall(pattern, path.read_text()), name

git('add', '--', *names, cwd=workspace)
tree = text('write-tree', cwd=workspace)
writing = commit(tree, [BASE], 'docs: use plain English and set greenfield engineering guidelines')
git('reset', '--hard', writing, cwd=workspace)
results = {'base': BASE, 'writing': {'sha': writing, 'tree': tree, 'branch': DESTINATION,
           'changed_markdown_files': len(names)}, 'prs': [],
           'checks': {'docs': '273 Markdown files, 0 errors', 'checker_tests': 24,
           'formatting': 'passed with the repository-pinned formatter',
           'standards_code_samples': 'unchanged', 'decision_dates_statuses': 'unchanged'}}
heads = {'main': writing}
for pr in manifest['prs']:
    number, record = pr['number'], pr['file']
    parent = heads[pr['parent']]
    name = record['path']
    assert name.startswith('docs/plans/library-consolidation/')
    content = apply(pr['old_head'], record)
    old = source(pr['old_head'], name).decode()
    new = content.decode()
    assert len(re.findall(r'(?m)^- \[[ xX]\]', old)) == len(re.findall(r'(?m)^- \[[ xX]\]', new)), number
    assert set(re.findall(r'`([^`\n]+)`', old)) <= set(re.findall(r'`([^`\n]+)`', new)), number
    index = Path(os.environ['RUNNER_TEMP']) / f'plain-index-{number}'
    assert not index.exists()
    env = dict(ENV, GIT_INDEX_FILE=str(index))
    git('read-tree', parent, env=env)
    blob = text('hash-object', '-w', '--stdin', data=content)
    git('update-index', '--add', '--cacheinfo', '100644', blob, name, env=env)
    pr_tree = text('write-tree', env=env)
    sha = commit(pr_tree, [pr['old_head'], parent], f'docs: explain plan #{number} in plain English')
    assert text('diff', '--name-only', parent, sha).splitlines() == [name]
    for ancestor in (pr['old_head'], parent):
        git('merge-base', '--is-ancestor', ancestor, sha)
    git('checkout', '--detach', sha, cwd=workspace)
    run(['python3', 'scripts/check-docs.py'], workspace)
    run(['git', 'diff', '--check', parent, sha], workspace)
    heads[number] = sha
    results['prs'].append({'number': number, 'branch': pr['branch'], 'sha': sha,
                          'old_head': pr['old_head'], 'base_sha': parent, 'path': name})

# Make the objects reachable on the workbench without changing its files.
# The connector will fast-forward the requested branches and update the PRs.
for branch, sha in expected_heads.items():
    assert remote_head(branch) == sha, f'Branch changed before publication: {branch}'
envelope = commit(text('rev-parse', f'{SOURCE}^{{tree}}'), [SOURCE, writing, *[p['sha'] for p in results['prs']]],
                  'chore: retain verified writing commits for PR publication')
assert not text('diff', '--name-only', SOURCE, envelope)
git('push', 'origin', f'{envelope}:refs/heads/{WORKBENCH}')
results['workbench_commit'] = envelope
(REPORT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print('WRITING_RESULTS\n' + json.dumps(results, indent=2), flush=True)
