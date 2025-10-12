# node-wolframscript

Node.js から WolframScript を呼び出すための小さなサーバ／UI プロジェクトです。

概要

このリポジトリは Koa ベースのサーバを提供し、内部で `wolframscript` の REPL を起動してコマンドを実行します。ブラウザ向けの簡易 UI（`public/root.html`）も同梱しています。

前提条件

- Node.js 18 以上（ESM / NodeNext 解決を利用）
- Wolfram Engine / Mathematica に含まれる `wolframscript` が PATH にあること

クイックスタート

1. 依存パッケージをインストール

```bash
npm install
```

2. TypeScript をビルドしてサーバを起動

```bash
npm run build
npm run start
```

デフォルトではポート 3000 で待ち受けます。別ポートで起動する場合は `PORT` 環境変数を指定してください。

```bash
# macOS / Linux (zsh)
PORT=3001 npm run start
```

開発

- 変更後は `npm run build` で再ビルドしてください。
- `dev` スクリプトは `dist/index.js` を Node の watch モードで実行します（Node v18 以上推奨）。

ブラウザ UI

- 静的ページ: `public/root.html`
- サーバが提供する主なエンドポイント:
  - `GET /` → ブラウザ UI を返す
  - `POST /wolfram/exec` → wolframscript にコマンドを投げて結果を返す

注意点・今後の改善案

- 早期移行のために一部で簡易的な型（`any`）や簡易宣言を使っています。型を厳密化することで保守性が向上します。
- ブラウザ向けコードをより快適に開発するには Vite や Rollup 等のバンドラ／開発サーバを導入して `src/root.ts` を最適化して配信するアプローチが有効です。

ライセンス

MIT

## 開発用モック (MOCK_MODE)

サーバは `wolframscript` が見つからない場合に mock レスポンダを使用します。開発時は以下の環境変数でモードを切り替えられます:

- `MOCK_MODE=base64`（デフォルト）: 画像や音声を Base64 で返します。ブラウザで直接レンダリングできるので可視化に便利です。
- `MOCK_MODE=text`: レスポンスを `MOCK_RESULT: <cmd>` のようなテキストにして返します。クライアントはこの場合 `<pre>` で安全に表示します。

PowerShell での単発テスト例:

```powershell
$env:MOCK_MODE='base64'; node scripts\test-vector-mock.cjs

$env:MOCK_MODE='text'; node scripts\test-vector-mock.cjs
```

## トラブルシューティング（抜粋）

- ポート競合やサーバが起動しない場合は既存の node を停止して再起動してください:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath node -ArgumentList 'dist/index.js' -WorkingDirectory $PWD -WindowStyle Hidden
```

- ブラウザで古いスクリプトが読み込まれている場合は強制リロード (Ctrl+F5) を行ってください。
