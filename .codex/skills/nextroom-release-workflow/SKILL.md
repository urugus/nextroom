---
name: nextroom-release-workflow
description: End-to-end NextRoom development and release workflow. Use when Codex is asked to plan, implement, review, create a PR, request Copilot review, address review/CI feedback, force/admin-merge after CI passes, or bump package version and create/push matching release tags for this repository.
---

# NextRoom Release Workflow

Use this skill for substantial NextRoom changes that should go from plan to merged PR and release
version/tag updates. Follow repo instructions in `AGENTS.md` first; this skill adds the project
workflow details that are easy to forget.

## Core Rules

- Think in English and reply in Japanese.
- Keep unrelated dirty work intact. Inspect `git status --short --branch` before staging,
  committing, rebasing, or switching branches.
- For moderately complex work, get a second opinion from Claude before handoff:
  - Before implementation: ask Claude to review the plan.
  - After implementation: ask Claude to review the current diff.
  - Apply only valid, in-scope findings.
- Run validation before creating or updating PRs:
  - `pnpm check`
  - `pnpm build` when the change can affect packaged Electron/Vite output or release behavior.
- When creating PRs, open the PR in the Codex in-app browser and keep the URL visible.
- Do not merge until required checks pass. If branch protection blocks normal merge and the user
  asked for force/admin merge, use `gh pr merge ... --admin`.

## Development Flow

1. **Plan**
   - Inspect relevant code, tests, docs, and current Git state.
   - Produce a decision-complete implementation plan when the task is non-trivial.
   - Ask Claude to review the plan with a prompt that includes the intended scope and asks for
     correctness/security/testability issues.

2. **Implement**
   - Create a `codex/<topic>` branch from the intended base, usually `origin/main`.
   - If user changes are already dirty, stash or carefully move only the relevant files; never
     revert unrelated work.
   - Implement narrowly using existing project patterns.
   - Add/update focused tests under `tests/` mirroring the source area.

3. **Review and Fix**
   - Run `pnpm check`; run `pnpm build` for Electron/Vite/release-impacting changes.
   - Ask Claude to review uncommitted or PR diff. Request file/line findings and no file edits.
   - Fix actionable findings, then rerun validation.

## PR Flow

1. Confirm the diff against `origin/main` includes only intended files.
2. Commit with a short imperative commit message.
3. Push the branch.
4. Create a PR with a Japanese title/body. If no PR template exists, use:

```markdown
# 背景

- <背景>

# 概要

- <変更点>

# 確認方法

- <実行したコマンド>
```

5. Open the PR in the in-app browser.
6. Request Copilot review when possible:

```bash
gh api repos/urugus/nextroom/pulls/<pr>/requested_reviewers \
  -X POST \
  -f 'reviewers[]=copilot-pull-request-reviewer'
```

If GitHub rejects the request because the reviewer is not a collaborator, report that clearly and
continue.

7. Wait for CI:

```bash
gh pr checks <pr> --watch
```

8. Inspect reviews/comments:

```bash
gh pr view <pr> --json comments,reviews,reviewRequests
```

Address valid findings, push updates, and re-check CI.

9. Merge after CI passes.
   - Feature/fix PRs: prefer squash merge and branch deletion.
     `gh pr merge <pr> --squash --delete-branch --admin`
   - If the PR contains a release/version commit that must remain the target of an annotated tag,
     use merge commit instead of squash.
     `gh pr merge <pr> --merge --admin`

## Version and Tag Flow

Use this after a feature PR is merged and the user asks to update version/tag.

1. Ensure local `main` and `origin/main` are current:

```bash
git fetch origin
git checkout main
git pull --ff-only
```

2. Inspect current version and tags:

```bash
node -p "require('./package.json').version"
git tag --list 'v*' --sort=-version:refname
```

3. Bump the next patch version unless the user specifies a different version.
4. Stage only `package.json` for the release commit.
5. Commit and tag:

```bash
git commit -m "Bump version to <version>"
git tag -a "v<version>" -m "v<version>"
```

6. Push the tag. Try pushing `main` only if repository rules allow it. In this repo, direct `main`
   push is usually rejected, so create a release PR from `codex/release-<version>`.
7. For the release PR:
   - Use a concise Japanese PR body.
   - Wait for `Verify`, `Verify pinned actions`, and release checks such as `Build macOS release`.
   - Merge with `--merge --admin` so the tagged version commit stays in `main` history.
8. Fetch after merge and verify:

```bash
git fetch origin
git ls-remote --tags origin "v<version>^{}"
gh pr view <release-pr> --json state,mergedAt,mergeCommit
```

## Handoff Checklist

Report:

- PR URL(s) and merge state.
- CI status.
- Version and tag created, including tag target commit.
- Any failed Copilot review request or other blocker.
- Any unrelated dirty files intentionally left untouched.
