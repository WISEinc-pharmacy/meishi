# meishi（名刺管理ツール）

## 概要
営業がスマホで名刺を撮影 → Gemini Visionで項目を自動抽出 → 確認・修正してFirestoreに保存する、全営業共有の名刺台帳。スマホ・PC両対応。

## 技術スタック
- Frontend: 単一HTML（`index.html`）, GitHub Pages配信
- DB: Firestore直接アクセス（**専用プロジェクト `wise-meishi`**。患者DBと分離）
- 認証: Firebase Auth（Google OAuth、`wise-meishi`）
- 画像保管: **Firestoreに直接保存**（Storage/Blaze不使用）。一覧用サムネ(~220px)は `cards` ドキュメントに `thumb` として、原本(~1024px)は `cardImages/{id}` に分離保存し一覧クエリを軽く保つ。
- 文字抽出: Gemini Vision API（model `gemini-2.5-flash`）。キーは Firestore `config/gemini` から読込・ソースに含めない

## 設計判断
- **患者DBと同居させない**：患者データは最機微（3省2ガイドライン・罰金リスク）。名刺=第三者PIIは別プロジェクト `wise-meishi` に隔離し、認証・権限・監査・コンプラ責任分界を独立させる。
- **画像はFirestore直接保存（Storage不使用）**：新規プロジェクトのStorageはBlaze課金紐付けが必須。名刺画像は圧縮済で小さく、Firestore無料枠(Spark)に収まるため課金カード登録なしで運用。将来 枚数が万単位 or Drive閲覧が必要になれば Storage/Drive へ移行。
- **Geminiは無料枠でOK**：名刺は会社の連絡先＝患者データと機微度のレイヤーが異なる、との判断。コードはキーをFirestoreから読むため無料/有料の切替は後戻りコストなし。

## 公開URL
https://wiseinc-pharmacy.github.io/meishi/

## 機能
- スマホ撮影 → AI自動抽出（氏名・会社・部署・役職・電話・携帯・メール・住所・URL）
- 確認・修正画面で保存（保存前に重複候補を警告）
- 検索・一覧閲覧（会社名・氏名・部署）
- 営業フォロー管理（ステータス／次アクション日／メモ）
- 重複チェック（氏名＋会社 または メール）
- CSV出力

## 権限
- 全営業で共有（Firebase Authログイン必須）。**閲覧は全ログインユーザー / 登録・編集・削除は director(admin) のみ**
- ロール `admin`（=director）以外は自動で `viewer`（閲覧専用）として自己登録。UI上も非adminには登録タブを出さず、Firestoreルールでも書き込みを admin に限定（二重防御）
- 将来 編集者を増やす場合は、director がコンソールで対象ユーザーの `users/{uid}.role` を `admin` に変更

## 個人情報の扱い（第三者PII）
- 対象: 営業が収集した名刺情報（取引先の連絡先＝第三者PII）。患者データとは機微度の層が異なる。
- 保管: Firestore（`wise-meishi`、認証ユーザーのみread／director書込）。患者DBとはプロジェクト分離。
- 保持・削除: 不要になった名刺は director が削除。保持期間の上限ルールは運用で別途定める（未確定）。
- Gemini送信: 名刺画像のみ送信しOCR抽出に使用。**無料枠はGoogleの製品改善に使われ得る**点を許容（名刺の機微度として可）。学習させたくない場合は「課金有効なキーに差し替える」ことで対応（設定フラグではなく課金キーで担保）。
- ガバナンス: 全社の個人情報・クラウド台帳（`wise/security_governance/`）へ `wise-meishi` を追記するか要確認（責任分界・暗号化・監査の記載）。

## ファイル構成
- `index.html` — アプリ本体
- `firestore.rules` — Firestoreセキュリティルール（cards / cardImages / users / config）

## セットアップ（コンソール作業・全て完了で稼働）
1. Firebaseプロジェクト `wise-meishi` 作成・Webアプリ登録 → `firebaseConfig` を index.html に反映（済）
2. Authentication で Google ログイン有効化＋承認済みドメインに `wiseinc-pharmacy.github.io` を追加
3. Firestore 作成（asia-northeast1）→ `firestore.rules` を Rules タブに貼り付けて公開
4. Gemini APIキー発行（無料・Google AI Studio）→ Firestore `config/gemini` の `apiKey` に保存
5. 初回ログイン後、`users/{uid}` の `role` を `admin` に変更（最初の管理者）

## 更新履歴
- 2026-06-18 初版作成。画像はFirestore直接保存方式（Storage不使用）に決定
