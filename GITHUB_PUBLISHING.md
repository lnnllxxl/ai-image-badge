# GitHub公開手順

このフォルダーは **AI IMAGE BADGE v0.13.1** の公開用ソースです。APIキー、学習画像、教育ラベル、仮想環境、依存パッケージ、作業キャッシュ、過去の配布物は含めません。

## ライセンス

プロジェクト本体はMIT Licenseです。ルートの `LICENSE` を削除せず公開します。第三者コンポーネントには `THIRD_PARTY_NOTICES.md` と `third_party/` 内の各ライセンスが適用されます。

## 大容量モデル

次の実行時モデルは拡張機能の動作に必要です。

- `model/model.onnx`
- `model/distilled-vit-q4.onnx`
- `model/capcheck-vit-q4.onnx`

`.gitattributes` で `model/*.onnx` をGit LFS対象にしています。GitHubへブラウザーから直接アップロードせず、Git LFSを導入したGitまたはGitHub Desktopを使用してください。clone側も事前に `git lfs install` を実行する必要があります。取得後、3つのONNXが小さなポインターファイルではなくモデル実体であることを確認します。

## 新規リポジトリへの公開例

PowerShellでこのフォルダーへ移動し、次の順に実行します。

```powershell
git lfs install
git init -b main
git add .
git lfs ls-files
git status
git commit -m "Release v0.13.1"
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

`git lfs ls-files` に3つのONNXモデルが表示されることを確認してからpushしてください。cloneする側もGit LFSを導入し、必要なら `git lfs pull` を実行します。

## 動作確認

Node.jsを利用できる環境で次を実行します。依存パッケージを再構築する場合はpnpmも使用します。

```powershell
npm run check
```

## セキュリティ監査レポート

公開用ソースには、v0.12.0一般配布版を対象とする `SECURITY_AUDIT_claude.md` を本文の変更なしで含め、`README.md` からリンクしています。GitHub公開セットの `03_AUDIT` にも同じレポートを同梱します。

Claudeによる静的レビューのレポートと、パッケージ構成を機械的に検査した `GITHUB_AUDIT_REPORT.txt` は別の資料です。AIによるレビューは、独立した専門家による監査や安全性の保証を意味しません。

## 一般版の配布

一般利用者には、GitHub Releasesへ次の一般版ZIPだけを添付します。管理者版、教育UI、学習ツール、管理者用ソースはGitHub公開対象に含めません。

- `ai-image-badge-release-v0.13.1.zip`

GitHub公開セットの `02_GITHUB_RELEASE_ASSETS` に、一般版ZIPとSHA-256一覧をまとめます。GitHubのリポジトリ本体ではなく、リポジトリ画面の **Releases** から新しいリリースを作り、一般版ZIPだけを添付してください。

ZIPのままChromeへ読み込むことはできません。利用者はZIPを展開し、`chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」から展開後のフォルダーを選択します。

## 公開してはいけないもの

- OpenAI APIキー、アクセストークン、秘密鍵
- 教育・学習に使った画像やラベルJSON
- `.venv`、`node_modules`、Pythonキャッシュ
- `work`、`outputs` などのローカル作業フォルダー
- 学習済みカスタムモデルとPyTorchチェックポイント（公開権利を確認した場合を除く）
- 管理者版マニフェスト、管理者用バックグラウンドコード、教育UI、教育データ処理、学習ツール

OpenAI APIキーはコードや配布ZIPへ埋め込まず、各利用者が拡張機能の設定画面から入力します。

## 継続的インテグレーションと脆弱性報告

`.github/workflows/ci.yml` はmainへのpushとPull RequestでGit LFSモデルを取得し、`npm run check` によるJavaScript構文確認を実行します。自動テスト一式は公開用リポジトリに含めず、公開前に開発環境で実行します。脆弱性の報告手順は `SECURITY.md` に記載しています。
