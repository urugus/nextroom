# Repository Guidelines

## Project Structure & Module Organization

NextRoom is an Electron + Vite + React desktop app for macOS. Main code lives in `src/main`
with feature folders such as `calendar`, `meet`, `oauth`, `scheduler`, `http`, `adapters`,
and `updater`. Renderer code is in `src/renderer/src`, preload code in `src/preload`, and
shared IPC/types/errors in `src/shared`. Tests under `tests` mirror source areas, for
example `tests/calendar`. Assets are in `assets`, notes in `docs`, and scripts in `scripts`.

## Build, Test, and Development Commands

Use pnpm.

- `pnpm dev`: start Electron/Vite development.
- `pnpm build`: create the production build in `out`.
- `pnpm test`: run Vitest once.
- `pnpm lint`: run Oxlint and arrow-function checks.
- `pnpm format`: format with Biome.
- `pnpm check`: run Biome, Oxlint, arrow checks, Vitest, and TypeScript.
- `pnpm ci`: run `pnpm check` and build.
- `pnpm dist:mac`: build Apple Silicon `.dmg` and `.zip`.

## Coding Style & Naming Conventions

Write TypeScript/TSX with 2-space indentation, double quotes, semicolons, trailing commas,
and a 100-character line width. Biome enforces formatting and imports. TypeScript must use
arrow functions; `scripts/assert-arrow-functions.mjs` and Oxlint enforce this. Avoid `any`;
model external data with Zod or explicit types. Use
`neverthrow` `Result` / `ResultAsync` in domain, service, and adapter code where operations
can fail, then serialize errors at IPC/UI boundaries.

## Testing Guidelines

Tests use Vitest, Testing Library, and jsdom. Add tests under the relevant mirrored folder
in `tests`, using `*.test.ts` or `*.test.tsx`. Prefer focused unit tests for services,
adapters, schedulers, and IPC conversion. Run `pnpm test` locally and `pnpm check` before
larger handoffs.

## Commit & Pull Request Guidelines

Recent history uses short imperative English commits for maintenance, such as
`Bump version to 0.1.12`, and concise Japanese feature commits are also present. Keep commits
focused. Pull requests should describe the user-visible change, list validation commands,
link issues, and include screenshots or recordings for renderer UI changes. When creating a
PR from Codex app, open it in the in-app browser after creation. Request
Copilot review immediately, then inspect review comments and fix any valid findings before
handoff. For releases, keep `package.json` `version` and Git tags aligned as `v${version}`.

## Agent Workflow

For moderately complex tasks, use a second opinion: Claude should ask Codex for review, and
Codex should ask Claude. Treat the response as review input and apply valid findings before
handoff.

## Security & Configuration Tips

OAuth tokens are stored through macOS Keychain; do not commit secrets, tokens, generated
release artifacts, `out`, `dist`, or local environment files. Keep
`build.appId` stable because it affects signing, Keychain identity, and updates.
