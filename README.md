# meishi（名刺管理ツール）

## 概要
営業がスマホで名刺を撮影 → Gemini Visionで項目を自動抽出 → 確認・修正してFirestoreに保存する、全営業共有の名刺台帳。スマホ・PC両対応。

## 技術スタック
- Frontend: 単一HTML（`index.html`）, GitHub Pages配信
- DB: Firestore直接アクセス（**専用プロジェクト `wise-meishi`**。患者DBと分離）
- 認証: Firebase Auth（Google OAuth、`wise-meishi`）
- 画像保管: Firebase Storage（名刺原本）
- 文字抽出: Gemini Vision API（キーは Firestore `config/gemini` から読込・ソースに含めない）

## 設計判断
- **患者DBと同居させない**：患者データは最機微（3省2ガイドライン・罰金リスク）。名刺=第三者PIIは別プロジェクトに隔離し、認証・権限・監査・コンプラ責任分界を独立させる。
- **Geminiは有料枠キー**：無料枠は入力が学習に使われ得る。名刺は第三者の個人情報のため、課金有効なプロジェクトのキーで「学習不使用」を担保（この使用量なら請求は実質0円）。

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
- 全営業で共有（Firebase Authログイン必須）
- ロール: admin / editor / viewer（Firestoreルールで制御、社員管理ツールと同方式）

## ファイル構成
- `index.html` — アプリ本体
- `firestore.rules` — Firestoreセキュリティルール（`meishi` コレクション用）

## セットアップ（要・コンソール作業）
1. `wise-patientdb` で Firebase Storage を有効化（バケット未作成なら作成）
2. Gemini APIキーを `wise-ai-integration` で発行 → HTTPリファラー制限（`wiseinc-pharmacy.github.io`）→ Firestore `config/gemini` に保存
3. `firestore.rules` を `wise-patientdb` にデプロイ（既存ルールへ `meishi` を追記）

## 更新履歴
- 2026-06-18 初版作成（スキャフォールド）
