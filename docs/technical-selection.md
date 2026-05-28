# Technical Selection

## 1. Decision Summary

MVP は Electron + TypeScript + React + SQLite + macOS Keychain の構成で実装する。

| Area | Selection | Reason |
| --- | --- | --- |
| Desktop shell | Electron | Google Meet Web 版との互換性、Chromium、media API、画面共有対応を優先 |
| UI | React + TypeScript | Electron と相性がよく、設定/予定一覧 UI を短期間で作りやすい |
| Package manager | pnpm | lockfile を `pnpm-lock.yaml` に一本化し、依存解決を高速化 |
| Build | Vite + electron-builder | 開発体験と macOS 配布物作成のバランスがよい |
| Test | Vitest | Vite/TypeScript/React と統合しやすい |
| Lint | Oxlint | TypeScript/React/Vitest の高速 lint と arrow-only 補助 |
| Format | Biome | formatter と import 整理を一元化 |
| Error handling | neverthrow | 失敗し得る domain/service/adapter 層を `Result` / `ResultAsync` で型付け |
| Calendar API | Google Calendar API REST | Meet URL と予定メタデータを取得できる公式 API |
| OAuth | Google OAuth 2.0 Desktop app + loopback redirect | Google の Desktop app 推奨パターン |
| Token storage | macOS Keychain via `keytar` | refresh token を平文保存しない |
| Local state | SQLite | 起動済みイベント、設定、同期キャッシュを堅牢に保存 |
| Notifications | Electron Notification / macOS UserNotifications | 初期実装は Electron API、配布時は署名済み macOS 通知要件を検証 |
| Auto launch | Electron `app.setLoginItemSettings` | macOS ログイン時起動をアプリ内設定化 |

## 2. Alternatives Considered

### Electron

Pros:

- Chromium 同梱により Google Meet Web 版と相性がよい。
- `persist:` session で Chrome/Safari とは別の Google ログイン状態を維持できる。
- `desktopCapturer`, `getDisplayMedia`, media permission 周辺の実装実績が多い。
- macOS/Windows/Linux への将来展開も可能。

Cons:

- アプリサイズとメモリ使用量が大きい。
- Chromium/Electron の定期更新が必須。
- macOS の署名、notarization、権限設定を正しく扱う必要がある。

Decision:

- 採用。Meet レンダリングの互換性が最優先であり、Tauri/WKWebView よりリスクが低い。

### Tauri / WKWebView

Pros:

- 軽量。
- macOS ネイティブ感が出やすい。

Cons:

- Google Meet の対応ブラウザとしての安定性が不明確。
- camera/microphone/screen share と Google Meet Web の組み合わせにリスクがある。
- セッションや権限の挙動が Chromium より読みづらい。

Decision:

- MVP では不採用。将来、Meet 表示を外部ブラウザに逃がす設計なら候補になる。

### Native Swift App + WKWebView

Pros:

- macOS 統合、Keychain、通知、Login Item は最も自然。
- 配布サイズが小さい。

Cons:

- Meet Web の互換性リスクが高い。
- Google OAuth/Calendar は問題ないが、Meet レンダリングが主目的なので不利。

Decision:

- 不採用。ただし Electron で macOS 権限や通知に限界が出た場合、ネイティブ helper の追加は検討する。

### Calendar Push Notifications

Pros:

- API 呼び出し量を減らし、予定変更に早く反応できる。

Cons:

- Google Calendar API の push は HTTPS callback receiver が必要。
- ローカル Mac アプリ単体では常時到達可能な HTTPS endpoint を用意しづらい。

Decision:

- MVP では polling。将来 SaaS/relay server を用意する場合に push へ拡張する。

Reference:

- https://developers.google.com/workspace/calendar/api/guides/push

## 3. Selected Stack

### Runtime

- Electron latest stable
- Node.js LTS
- TypeScript strict mode
- pnpm
- Vitest
- Oxlint
- Biome
- neverthrow

### App Layers

- Main process
  - OAuth callback server
  - Calendar sync scheduler
  - Meet window manager
  - Notification manager
  - Settings persistence
  - Keychain access

- Renderer process
  - Dashboard
  - Settings
  - Account connection state
  - Upcoming Meet list

- Meet window
  - Dedicated BrowserWindow
  - Persistent `persist:meet` session
  - Locked navigation policy

### Libraries

- `electron`
- `electron-builder`
- `vite`
- `react`
- `typescript`
- `vitest`
- `oxlint`
- `@biomejs/biome`
- `neverthrow`
- `googleapis` or small typed REST client
- `keytar`
- `better-sqlite3`
- `zod`
- `date-fns` or `luxon`

### Implementation Rules

- Project-owned TS/TSX code uses arrow functions only.
- Biome enforces `complexity.useArrowFunction = "error"`.
- Oxlint enforces `func-style = ["error", "expression", { "allowArrowFunctions": true }]`.
- A small AST-based check blocks top-level function declarations, function expressions, object/class methods, getters, and setters in project-owned code.
- Domain logic returns `Result<T, AppError>`.
- Async external I/O adapters return `ResultAsync<T, AppError>` and use `ResultAsync.fromPromise`.
- Renderer and IPC boundaries receive serializable API results instead of raw `Result` objects.

## 4. OAuth Technical Choice

Use Desktop app OAuth with PKCE and loopback redirect.

Required behavior:

- Open system browser to Google authorization endpoint.
- Listen on `127.0.0.1:{randomPort}` for the redirect.
- Exchange authorization code for access token and refresh token.
- Store refresh token in Keychain.
- Store access token only in memory or short-lived encrypted local state.
- Revoke token and delete Keychain item on sign out.

Rationale:

- Google OAuth policy disallows directing authorization requests to embedded user-agents controlled by the developer.
- Google documents loopback IP redirect as recommended for macOS/Linux/Windows desktop apps.

References:

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2/policies

## 5. Meet Rendering Choice

Use Electron `BrowserWindow` with persistent session partition.

Required `webPreferences` baseline:

```ts
{
  partition: "persist:meet",
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  preload: undefined
}
```

Navigation rules:

- Allow:
  - `https://meet.google.com/*`
  - `https://accounts.google.com/*`
  - Google auth/static domains required by Meet
- Open externally:
  - Help links
  - Calendar links
  - Non-Meet docs/attachments
- Block:
  - Unknown custom protocols
  - File URLs
  - Untrusted HTTP URLs

Reference:

- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/structures/web-preferences

## 6. Risk Assessment

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Google Meet changes browser support or blocks Electron UA | High | Track Electron stable, optionally use standard Chrome-like UA, add fallback "open in browser" |
| OAuth verification required for production | Medium | Minimize scopes, prepare privacy policy and app home page |
| Calendar polling misses last-minute changes | Medium | Short polling near event start, manual refresh, future push relay |
| Screen sharing fails due to macOS permission | High | Add correct entitlements/Info.plist, onboarding checks |
| Meet session expires | Medium | Detect Google login page, surface "Meet login required" state |
| App opens wrong/old Meet event | High | Use event ID + updated timestamp + start time; cancel obsolete timers |
| Duplicate launches | Medium | Persist launch records per event occurrence |

## 7. Final Recommendation

Build the first version as a local-first Electron app.

The core product value is not a new Meet implementation; it is reliable orchestration:

- Calendar reads are official API based.
- OAuth stays policy-compliant by using the system browser.
- Meet rendering uses Chromium in a dedicated persistent app session.
- No server is required for MVP.
- A future relay server can add push notifications without changing the desktop app core.
