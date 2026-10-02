# Repository Instructions

## Working Approach

- Use current source, tests, executable configuration, dependency manifests, and component contracts as evidence. Resolve conflicting sources explicitly and update stale documentation.
- When `.codegraph/` exists, use CodeGraph for initial navigation and relationship discovery, then verify against current files. Fall back to text search when the index is incomplete or stale.
- Prefer the simplest correct solution. Reuse existing code and dependencies; keep changes coherent and preserve unrelated work.
- Check `.agents/skills/` for relevant repository skills before changing their subject areas.

## Architecture and Contracts

- Keep system image construction, server behavior, and dashboard presentation separate. Update affected callers, tests, configuration, and documentation together when changing a boundary.
- Keep the frontend coupled to public backend contracts, not backend internals. Read `documents/README.md` for maintained component references.
- Treat APIs, persisted data, operator configuration, and image formats as explicit contracts. Define compatibility deliberately; remove obsolete implementations instead of retaining unrequested adapters.
- Reject unsupported data without silently erasing it. Preserve authentication, account isolation, data integrity, and artifact verification when refactoring.
- Generate derived files through the designated workflow and keep its inputs, outputs, and checks consistent.
- Preserve supported hardware targets. Distinguish emulated tests from physical-device validation.

## Implementation and Verification

- Follow the current toolchain and nearby conventions unless the task intentionally changes them. Prefer focused modules over speculative abstractions.
- Keep UI changes consistent with shared components and design tokens, responsive, accessible, and stable during loading and feedback.
- Review authoritative upstream guidance for substantial integrations or upgrades. Keep dependency manifests, lockfiles, licenses, and required notices consistent.
- Reuse existing tests. Add coverage for important behavior at risk, including permissions, failure handling, and persistence. Do not add tests merely to mirror implementation details.
- Start with focused checks and broaden verification according to the change's impact. Use repository workflows, inspect affected UI when possible, and run `git diff --check`.
- Report checks actually performed, failures, and unverified targets. A successful build is not evidence of successful boot or real hardware operation.

## Working Directory and Git

- Work in the current checkout. Start a new task branch from the current branch using `codex/<short-kebab-case-description>`; continue an ongoing task on its existing branch. Do not create git worktrees.
- Preserve existing uncommitted changes. Use Git for source history and recovery; do not create duplicate source snapshots or rollback archives unless requested. Product data backup and recovery mechanisms are unaffected.
- Do not stage, commit, amend, reset, rebase, push, or open a pull request unless explicitly requested. Authorized task-branch creation is the exception. Leave changes available for review.
- When a pull request is requested, target the repository configured as `origin` unless directed otherwise, and pass `--repo` explicitly. Describe the final behavior and validation, not the conversation history.

## Instruction Maintenance

- Write project documentation and code comments in English; retain localized interface text and Unicode test fixtures.
- Keep these instructions concise, in English, and limited to durable project rules. Put feature specifications and implementation details in maintained component documentation or source.
- Remove superseded guidance instead of accumulating history. Do not record secrets, personal information, debugging notes, or task progress here.
