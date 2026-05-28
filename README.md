# NextRoom

Google Calendar の予定に連動し、Google Meet を専用 Mac デスクトップアプリ内の独立ブラウザセッションで起動するアプリです。

## Documents

- [要件定義](docs/requirements.md)
- [技術選定](docs/technical-selection.md)
- [詳細設計](docs/detailed-design.md)

## Recommended MVP

- Electron + TypeScript + React
- pnpm
- Vitest
- Oxlint
- Biome
- neverthrow
- Google OAuth 2.0 Desktop app flow
- Google Calendar API polling
- Meet 専用 `persist:meet` session
- macOS Keychain token storage
- macOS notifications

## Commands

- `pnpm dev`: Electron/Vite の開発起動
- `pnpm build`: Electron/Vite の production build
- `pnpm dist:mac`: macOS 配布用の `.dmg` と `.zip` をローカル生成
- `pnpm release:mac`: GitHub Release へ macOS 配布物を公開
- `pnpm test`: Vitest test suite
- `pnpm lint`: Oxlint と arrow-only 検査
- `pnpm format`: Biome formatter
- `pnpm check`: Biome、Oxlint、arrow-only、Vitest、TypeScript をまとめて検証
- `pnpm ci`: `pnpm check` と production build をまとめて検証

## Release

GitHub Releases を公式配布元にする。`v0.1.0` のような `v*` タグを push すると、`.github/workflows/release.yml` が macOS 用の `.dmg` と `.zip` を作成し、GitHub Release に添付する。

公開前に GitHub repository secrets へ以下を設定する。

- `MACOS_CERTIFICATE`: Developer ID Application 証明書の `.p12` を base64 化した値
- `MACOS_CERTIFICATE_PASSWORD`: `.p12` のパスワード
- `APPLE_API_KEY`: App Store Connect API key の `.p8` 内容
- `APPLE_API_KEY_ID`: App Store Connect API key ID
- `APPLE_API_ISSUER`: App Store Connect issuer ID

`package.json` の `build.appId` は署名、Keychain、将来の自動更新に影響するため、公開後は変更しない。所有ドメインに基づく Bundle ID に変える場合は、初回の一般公開前に行う。

## Key Product Decision

Google Meet を独自実装するのではなく、Electron 同梱 Chromium で Google Meet Web 版を表示する。Calendar API の OAuth は外部ブラウザで行い、Meet 画面用の Google ログイン状態は Electron の永続セッションに分離して保持する。

## Implementation Style

プロジェクトが書く TypeScript/TSX は arrow function のみを許容する。失敗し得る domain/service/adapter 層の処理は `neverthrow` の `Result` / `ResultAsync` を返し、UI/IPC 境界では serializable な `{ ok: true, value } | { ok: false, error }` に変換する。
