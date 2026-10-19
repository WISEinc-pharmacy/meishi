// =============================================================================
// 営業活動記録（activities）の語彙と保存ペイロードの正本
//   設計正本: wise/AI_sales_ren/DESIGN.md「Step 3: データ設計」
//   ブラウザ（index.html の <script type="module">）と
//   Nodeのハーネス（test_activity_payload.mjs）の両方から import する。
//   DOM・Firebase SDK に依存しない純粋関数だけを置く（憲法14条: 正本一元化）。
// =============================================================================

/**
 * 活動の種別（6値）。正本＝営業管理スプシ「使い方（はじめに）」タブ §4「記録する行動（活動）」
 *   訪問／電話／同行／メール／その他 ＋ 今回追加の 資料送付
 *   「同行」＝クロージング担当（渡邉さん・新井さん）が舛田さんと同行して面談すること
 *   「面談」は活動ではなくステージ（②決裁者面談）なので種別には入れない（2026-10-19 訂正）
 */
export const ACTIVITY_KINDS = ['訪問', '電話', '同行', 'メール', '資料送付', 'その他'];

/** ステージ（7値）。施設台帳Q列と同じ語彙＝名刺カードの status もこの7値に統一した */
export const STAGES = ['①あいさつ', '②決裁者面談', '③統括商談', '成約', '取引開始', '検討中', '見送り'];

/**
 * 旧ステータス → 新ステージ 対応表（2026-10-19 語彙統一）
 *   旧: 初回接触 / 商談中 / 見積提出 / 受注 / 失注 / 保留（名刺カードの name="status"）
 *   新: 上記 STAGES の7値
 * 既存データは書き換えていないので、表示・編集時に normalizeStage() で読み替える。
 */
export const LEGACY_STATUS_MAP = {
  '初回接触': '①あいさつ',
  '商談中': '②決裁者面談',
  '見積提出': '③統括商談',
  '受注': '成約',
  '失注': '見送り',
  '保留': '検討中'
};

/**
 * 施設の識別子（facilities のドキュメントID）を施設名から作る。
 *   2026-10-19 追補2: 施設IDは一意ではない（同一電話の別棟で衝突・電話未取得の9件は空）ため、
 *   同一性の根拠は施設台帳B列「施設名（正式名称・重複不可）」とする。
 *   前後空白を除去し、FirestoreのドキュメントIDに使えない '/' を全角スラッシュへ置き換える。
 */
export function facilityKeyOf(name) {
  let s = String(name == null ? '' : name).trim().replace(/\//g, '／');
  // FirestoreのドキュメントIDは最大1500バイト。超える施設名は安全側で切り詰める
  const enc = new TextEncoder();
  while (enc.encode(s).length > 1500) s = s.slice(0, -1);
  return s;
}

/** ステージ表示用のCSSクラス（①等の記号をクラス名に出さないASCIIスラッグ） */
const STAGE_SLUG = {
  '①あいさつ': 'st-s1',
  '②決裁者面談': 'st-s2',
  '③統括商談': 'st-s3',
  '成約': 'st-win',
  '取引開始': 'st-act',
  '検討中': 'st-hold',
  '見送り': 'st-lost'
};

/** 旧値・空値・未知の値を7値のいずれかへ寄せる（未知は ①あいさつ 扱い・画面を壊さない） */
export function normalizeStage(v) {
  const s = (v == null ? '' : String(v)).trim();
  if (STAGES.includes(s)) return s;
  if (LEGACY_STATUS_MAP[s]) return LEGACY_STATUS_MAP[s];
  return STAGES[0];
}

/** ステージ→CSSクラス名 */
export function stageClass(v) {
  return STAGE_SLUG[normalizeStage(v)] || 'st-s1';
}

/** YYYY-MM-DD 形式か */
export function isDateString(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * 会った人の整形。
 * ・名刺から選んだ人は {cardId, name, title}
 * ・名刺に無い人は {name, title}（cardIdキーは付けない＝Firestoreにundefinedを入れない）
 * ・氏名が空の行は捨てる
 * ・0人でも空配列を返す（会った人0人でも保存できることが要件）
 */
export function normalizeAttendees(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    if (!a) continue;
    const name = String(a.name == null ? '' : a.name).trim();
    if (!name) continue;
    const item = { name, title: String(a.title == null ? '' : a.title).trim() };
    const cardId = String(a.cardId == null ? '' : a.cardId).trim();
    if (cardId) item.cardId = cardId;
    out.push(item);
  }
  return out;
}

/**
 * activities へ保存する1件分のペイロードを組み立てる（純粋関数）。
 *
 * @param {object} input
 *   facilityKey    施設キー＝施設名の正規化（必須・facilities のドキュメントID）
 *   facilityName   施設名（facilityKey 省略時はここから作る）
 *   facilityId     施設ID（任意の属性。一意ではない＝追補2）
 *   date           'YYYY-MM-DD'（必須）
 *   kind           ACTIVITY_KINDS のいずれか
 *   attendees      [{cardId?, name, title}]（0人可）
 *   stage          STAGES のいずれか（旧値は正規化）
 *   nextAction     次アクション（テキスト）
 *   nextActionDate 次アクション期日 'YYYY-MM-DD' or ''
 *   memo           メモ
 *   user           {email, name}（必須・rules が createdBy.email == 認証メール を要求）
 * @param {object} opts
 *   serverTimestamp  サーバ時刻を返す関数（ブラウザは FieldValue.serverTimestamp）
 * @returns {object} Firestore へそのまま add() できるオブジェクト
 */
export function buildActivityPayload(input, opts = {}) {
  const i = input || {};
  const serverTimestamp = typeof opts.serverTimestamp === 'function' ? opts.serverTimestamp : () => null;

  // 施設の同定キー＝施設名を正規化したもの（facilities のドキュメントID）。
  // facilityKey が来なければ施設名から作る。施設IDは一意でないのでキーに使わない（追補2）。
  const facilityName = String(i.facilityName == null ? '' : i.facilityName).trim();
  const facilityKey = facilityKeyOf(i.facilityKey || facilityName);
  if (!facilityKey) throw new Error('施設が選ばれていません（facilityKey は必須）');

  const date = String(i.date == null ? '' : i.date).trim();
  if (!isDateString(date)) throw new Error('日付が不正です（YYYY-MM-DD）: ' + date);

  const kind = String(i.kind == null ? '' : i.kind).trim();
  if (!ACTIVITY_KINDS.includes(kind)) throw new Error('種別が不正です: ' + kind);

  const email = String((i.user && i.user.email) || '').trim();
  if (!email) throw new Error('ログイン情報が取れません（createdBy.email は必須）');

  const nextActionDate = String(i.nextActionDate == null ? '' : i.nextActionDate).trim();
  if (nextActionDate && !isDateString(nextActionDate)) {
    throw new Error('次アクション期日が不正です（YYYY-MM-DD）: ' + nextActionDate);
  }

  const payload = {
    facilityKey,
    facilityName,
    date,
    kind,
    attendees: normalizeAttendees(i.attendees),
    stage: normalizeStage(i.stage),
    nextAction: String(i.nextAction == null ? '' : i.nextAction).trim(),
    nextActionDate,
    memo: String(i.memo == null ? '' : i.memo).trim(),
    createdBy: { email, name: String((i.user && i.user.name) || email).trim() },
    createdAt: serverTimestamp(),
    // 連〈れん〉が巡回して拾う同期状態。rules が create 時 pending を必須にしている。
    syncState: { status: 'pending', sheetRow: null, syncedAt: null, error: null }
  };
  // 施設ID（電話下4桁）は表示・突合の補助情報。重複・空があるので一意性は前提にしない
  const facilityId = String(i.facilityId == null ? '' : i.facilityId).trim();
  if (facilityId) payload.facilityId = facilityId;
  return payload;
}
