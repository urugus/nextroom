# NextRoom Requirements

## 1. Purpose

Google Calendar の予定に含まれる Google Meet を検出し、ユーザーの Mac 上で Meet 専用デスクトップアプリとして自動起動する。既存の Chrome/Safari とは別のブラウザセッションを使い、会議参加をカレンダー予定に連動させる。

## 2. Product Scope

### In Scope

- Google アカウント連携
- Google Calendar から予定を取得
- Google Meet URL 付き予定の検出
- 会議開始前の通知
- 会議開始時の Meet 専用ウィンドウ起動
- 設定した時刻での Meet 自動入室
- Electron 内の Chromium で Google Meet Web 版を表示
- Meet 表示用セッションの永続化
- カメラ、マイク、画面共有の権限処理
- macOS ログイン時の自動起動
- トークンの macOS Keychain 保存

### Out of Scope for MVP

- Google Meet の独自ネイティブ実装
- Google Meet の独自 UI 実装
- 会議作成、予定編集、招待者管理
- 複数 Google アカウント同時利用
- Windows/Linux 対応
- SaaS サーバーによる全ユーザーの Calendar push 管理
- Google Meet の録画、文字起こし、会議内容解析

## 3. User Stories

1. ユーザーとして、初回セットアップで Google Calendar へのアクセスを許可したい。
2. ユーザーとして、今日の Meet 付き予定をアプリで確認したい。
3. ユーザーとして、会議開始前に通知を受け取りたい。
4. ユーザーとして、開始時刻になったら Meet 専用ウィンドウを自動で開いてほしい。
5. ユーザーとして、必要な場合は指定分前に Meet へ自動入室してほしい。
6. ユーザーとして、Chrome/Safari のログイン状態とは別に Meet に参加したい。
7. ユーザーとして、一度ログインした Meet セッションは次回以降も維持してほしい。
8. ユーザーとして、自動起動の有効/無効、通知タイミング、自動オープン有無、自動入室有無を設定したい。

## 4. Functional Requirements

### FR-1 Google OAuth

- アプリは Google OAuth 2.0 の Desktop app flow を使用する。
- 認証画面は埋め込み WebView ではなく、システム既定ブラウザで開く。
- 認可コードの受け取りは loopback IP redirect を使う。
- `offline` access を要求し、refresh token を取得する。
- refresh token は macOS Keychain に保存する。

References:

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2/policies
- https://developer.apple.com/documentation/security/keychain-services

### FR-2 Calendar Sync

- 対象カレンダーは初期版では `primary` のみとする。
- 取得対象は現在時刻から先 24 時間を基本とする。
- 取得条件は `singleEvents=true`, `orderBy=startTime`, `timeMin`, `timeMax` を使う。
- 同期周期は通常 60 秒、会議開始 10 分以内は 15 秒に短縮する。
- ネットワークエラー時は指数バックオフし、最後に取得済みの予定を表示し続ける。

References:

- https://developers.google.com/workspace/calendar/api/v3/reference/events/list

### FR-3 Meet Detection

Meet URL は次の優先順位で検出する。

1. `conferenceData.entryPoints[]` の `entryPointType=video`
2. `hangoutLink`
3. `description` と `location` 内の `https://meet.google.com/...`

Google Meet 判定は `conferenceData.conferenceSolution.key.type=hangoutsMeet` または URL ホスト `meet.google.com` を基本とする。

References:

- https://developers.google.com/workspace/calendar/api/v3/reference/events

### FR-4 Launch Scheduling

- 会議開始 N 分前に通知する。初期値は 1 分前。
- 自動起動が有効な場合、開始 N 秒前または開始時刻に Meet ウィンドウを開く。初期値は開始 0 秒前。
- 自動入室が有効な場合、開始 N 秒前または開始時刻に Meet の入室操作を実行する。初期値は無効、タイミングは開始 0 秒前。
- 自動入室タイミングは Meet ウィンドウを開くタイミングより前に設定できない。
- 別の Meet ウィンドウが開いている場合、自動入室は対象ウィンドウが閉じた後に実行する。
- 同一イベントは一度だけ自動起動する。
- 予定が変更またはキャンセルされた場合、未実行の起動予定を更新または削除する。
- 既に同じ Meet URL のウィンドウが開いている場合は、新規作成せず既存ウィンドウを前面に出す。

### FR-5 Meet Browser Window

- Meet ウィンドウは Electron `BrowserWindow` で実装する。
- Meet 用セッションは `persist:meet` partition を使い、Cookie とログイン状態を維持する。
- Calendar OAuth 用の認証処理と Meet 表示セッションは分離する。
- Meet URL 以外へのトップレベル遷移は原則ブロックまたは外部ブラウザへ逃がす。
- Google ログイン、accounts.google.com、必要な Google 静的リソースは許可リストで扱う。

References:

- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/structures/web-preferences
- https://www.electronjs.org/docs/api/browser-window

### FR-6 Media Permissions

- カメラとマイクの使用許可を Electron/macOS 双方で処理する。
- macOS の `Info.plist` に `NSCameraUsageDescription` と `NSMicrophoneUsageDescription` を設定する。
- 画面共有は Electron の `desktopCapturer` / `getDisplayMedia` に対応する。
- 初回権限要求時は、Meet 参加に必要な権限であることをアプリ内で説明する。

References:

- https://www.electronjs.org/docs/latest/api/system-preferences
- https://www.electronjs.org/docs/latest/api/desktop-capturer

### FR-7 macOS Integration

- ログイン時起動を設定できる。
- メニューバー常駐または Dock アプリとして動作できる。
- 通知許可をユーザー操作の文脈で要求する。
- 通知クリックで該当 Meet を開く。

References:

- https://developer.apple.com/documentation/UserNotifications/asking-permission-to-use-notifications

## 5. Non-Functional Requirements

### Reliability

- Calendar API 障害時でも直近取得済み予定は維持する。
- アプリ再起動後も OAuth token と Meet session が復元される。
- 起動処理は idempotent にし、同じ会議を重複起動しない。

### Security

- Google OAuth は埋め込み user-agent で実行しない。
- refresh token は平文ファイルに保存しない。
- renderer で Node.js を有効化しない。
- `contextIsolation=true`, `sandbox=true`, `nodeIntegration=false` を基本設定にする。
- 外部リンクは既定ブラウザで開く。
- IPC は allowlist 方式で最小限にする。

### Privacy

- 予定データはローカル保存を最小限にする。
- ログには予定本文、参加者メール、Meet URL の full code を出さない。
- 設定画面に「Calendar データはローカル処理のみ」と明示する。

### Performance

- 通常時の Calendar API 呼び出しは 60 秒以上の間隔を保つ。
- 起動時は 3 秒以内に次の Meet 予定を表示する。
- Meet ウィンドウ以外の renderer は軽量に保つ。

### Compatibility

- 対象 OS: macOS 13 Ventura 以降を推奨。
- CPU: Apple Silicon と Intel の Universal build。
- Meet 表示は Electron 同梱 Chromium に依存するため、Electron の定期アップデートを前提とする。

## 6. Acceptance Criteria for MVP

1. 初回起動時に Google OAuth を外部ブラウザで開始できる。
2. OAuth 完了後、Calendar API で primary calendar の今後 24 時間の予定を取得できる。
3. Meet 付き予定だけを抽出し、アプリ上に表示できる。
4. Meet 付き予定の開始前に macOS 通知を表示できる。
5. 自動起動 ON の場合、開始時刻に Electron の専用ウィンドウで Meet URL を開ける。
6. アプリ再起動後も Calendar API token が維持される。
7. アプリ再起動後も Meet Web セッションが維持される。
8. カメラ/マイク権限が Meet 内で利用できる。
9. 同一予定を重複して自動起動しない。
10. OAuth、token 保存、Meet session、Calendar polling のエラー状態が UI で確認できる。
