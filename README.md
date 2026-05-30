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
- `pnpm dist:mac`: Apple Silicon Mac 配布用の `.dmg` と `.zip` をローカル生成
- `pnpm release:mac`: GitHub Release へ Apple Silicon Mac 配布物を公開
- `pnpm test`: Vitest test suite
- `pnpm lint`: Oxlint と arrow-only 検査
- `pnpm format`: Biome formatter
- `pnpm check`: Biome、Oxlint、arrow-only、Vitest、TypeScript をまとめて検証
- `pnpm ci`: `pnpm check` と production build をまとめて検証

## Release

GitHub Releases を公式配布元にする。`package.json` の `version` を唯一のバージョン元にし、Git タグは必ず `v${version}` 形式にする。`v0.1.0` のような `v*` タグを push すると、`.github/workflows/release.yml` が Apple Silicon Mac 用の `.dmg` と `.zip` を作成し、GitHub Release に添付する。Intel Mac は配布対象外とする。

リリース手順:

1. `package.json` の `version` を次の配布バージョンへ更新する。
2. `pnpm run check` と `pnpm run build` を通す。
3. バージョン更新を commit する。
4. `git tag -a v0.1.0 -m "Release v0.1.0"` のように annotated tag を作成する。
5. `git push origin main` と `git push origin v0.1.0` を実行する。

タグ名と `package.json` の `version` が一致しない場合、release workflow は失敗する。

`package.json` の `build.appId` は署名、Keychain、将来の自動更新に影響するため、公開後は変更しない。所有ドメインに基づく Bundle ID に変える場合は、初回の一般公開前に行う。

## Homebrew

NextRoom のアプリ内更新は macOS の自己置換 updater ではなく、Homebrew cask に委譲する。署名・公証なしでも Gatekeeper に止められにくいように、アプリは `~/Applications` 配置を前提にする。GitHub Release の更新有無だけを確認し、更新が見つかった場合は detached background process で次の固定コマンド相当を実行する。

```sh
brew update
brew upgrade --cask --appdir="$HOME/Applications" nextroom
osascript -e 'quit app "NextRoom"' >/dev/null 2>&1 || true
open -n "$HOME/Applications/NextRoom.app"
```

このため、NextRoom は Homebrew cask として `~/Applications` にインストールされている必要がある。未インストールの場合、アプリ内更新は `Homebrew was not found` または cask 未導入のエラーを表示する。更新ログは `~/Library/Application Support/NextRoom/homebrew-update.log` に出力する。

tap は別リポジトリ `urugus/homebrew-tap` で管理する想定。

```sh
brew tap urugus/tap
brew install --cask --appdir="$HOME/Applications" urugus/tap/nextroom
brew upgrade --cask --appdir="$HOME/Applications" nextroom
```

## Key Product Decision

Google Meet を独自実装するのではなく、Electron 同梱 Chromium で Google Meet Web 版を表示する。Calendar API の OAuth は外部ブラウザで行い、Meet 画面用の Google ログイン状態は Electron の永続セッションに分離して保持する。

## Implementation Style

プロジェクトが書く TypeScript/TSX は arrow function のみを許容する。失敗し得る domain/service/adapter 層の処理は `neverthrow` の `Result` / `ResultAsync` を返し、UI/IPC 境界では serializable な `{ ok: true, value } | { ok: false, error }` に変換する。
