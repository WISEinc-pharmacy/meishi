// =============================================================================
// 活動記録フォームの保存ペイロード検証ハーネス
//   実行: node wise/meishi/test_activity_payload.mjs
//   Firestore SDK（db.collection().add() と FieldValue.serverTimestamp()）をモックし、
//   index.html の saveActivity() と同じ呼び出し方で組み立てたペイロードを捕捉して実測する。
//   あわせて index.html / firestore.rules を静的に検査し、
//   「アプリが本当にこの関数を通って activities に書くか」「既存の match ブロックが無改変か」も確認する。
// =============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildActivityPayload, facilityKeyOf, ACTIVITY_KINDS, STAGES, LEGACY_STATUS_MAP, normalizeStage
} from './activity_payload.js';

// 施設台帳の実データ132件（2026-10-19 export_facilities_seed.mjs 実測）
const SEED = JSON.parse(readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)),
    '../eigyo_kanri/tel_lookup_20261014/facilities_seed_20261019.json'), 'utf8'));

const HERE = path.dirname(fileURLToPath(import.meta.url)); // cwd非依存（INC-366）
const read = f => readFileSync(path.join(HERE, f), 'utf8');

let pass = 0, fail = 0;
const ok  = (name, cond, detail='') => { (cond ? pass++ : fail++);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// ---- Firestore SDK モック ---------------------------------------------------
const SERVER_TS = { __sentinel: 'serverTimestamp' };
const firebase = { firestore: { FieldValue: { serverTimestamp: () => SERVER_TS } } };
const captured = [];
const db = {
  collection: (name) => ({
    add: async (data) => { captured.push({ collection: name, data }); return { id: 'mock-doc-id' }; }
  })
};

/** index.html の saveActivity() と同じ経路でペイロードを組み立て、モックFirestoreへ書く */
async function saveActivityLikeApp(formInput) {
  const payload = buildActivityPayload(formInput, {
    serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('activities').add(payload);
  return payload;
}

const USER = { email: 'masuda@wise-jmco.com', name: '舛田' };
const hasUndefined = (o) => JSON.stringify(o, (k, v) => (v === undefined ? '__UNDEF__' : v)).includes('__UNDEF__');

console.log('=== 活動記録ペイロード検証（' + new Date().toISOString().slice(0, 19) + '）===\n');

// ---- ケース1: 通常（名刺1人＋手入力1人） -----------------------------------
const p1 = await saveActivityLikeApp({
  facilityKey: facilityKeyOf('ななほしクリニック柏'), facilityName: 'ななほしクリニック柏', facilityId: '9952',
  date: '2026-10-20', kind: '訪問',
  attendees: [
    { cardId: 'card_abc', name: '佐藤 太郎', title: '事務長' },
    { name: '鈴木 花子', title: '看護師長' },
    { name: '', title: '空行は捨てる' }
  ],
  stage: '②決裁者面談', nextAction: '来週あらためて管理者へ説明', nextActionDate: '2026-10-27',
  memo: '在宅の受け入れに前向き', user: USER
});

ok('1. syncState.status が pending', p1.syncState.status === 'pending', JSON.stringify(p1.syncState));
ok('2. createdBy.email が入っている', !!p1.createdBy.email, JSON.stringify(p1.createdBy));
ok('3. facilityKey（施設名の正規化＝ドキュメントID）が入っている',
   p1.facilityKey === 'ななほしクリニック柏', p1.facilityKey);
ok('   facilityName も必ず入る', p1.facilityName === 'ななほしクリニック柏', p1.facilityName);
ok('   施設IDは表示用の属性として同居（一意性は前提にしない）', p1.facilityId === '9952', String(p1.facilityId));
ok('5. ステージが7値のいずれか', STAGES.includes(p1.stage), p1.stage);
ok('6. 種別が6値のいずれか', ACTIVITY_KINDS.includes(p1.kind), p1.kind + ' / 正本=' + ACTIVITY_KINDS.join('・'));
ok('   会った人の整形（空行を捨て2人）', p1.attendees.length === 2, JSON.stringify(p1.attendees));
ok('   手入力の人に cardId キーを作らない', !('cardId' in p1.attendees[1]), JSON.stringify(p1.attendees[1]));
ok('   createdAt にサーバ時刻が入る', p1.createdAt === SERVER_TS);
ok('   undefined がペイロードに混入しない', !hasUndefined(p1));
ok('   モックFirestoreの宛先が activities', captured[0].collection === 'activities', captured[0].collection);

// ---- ケース2: 会った人0人 ---------------------------------------------------
const p2 = await saveActivityLikeApp({
  facilityKey: facilityKeyOf('特養 つなぐ苑'), facilityName: '特養 つなぐ苑', date: '2026-10-19', kind: '電話',
  attendees: [], stage: '①あいさつ', nextAction: '', nextActionDate: '', memo: '不在・折返し待ち', user: USER
});
ok('4. 会った人0人でも保存ペイロードが成立する',
   Array.isArray(p2.attendees) && p2.attendees.length === 0 && p2.syncState.status === 'pending' && !!p2.facilityKey,
   'attendees=' + JSON.stringify(p2.attendees));
ok('   会った人0人でもFirestoreへ到達（2件目）', captured.length === 2 && captured[1].data === p2);

// ---- ケース3: 種別6値すべてが通る（訂正後の語彙） ---------------------------
let kindsOk = true, kindsLog = [];
for (const k of ACTIVITY_KINDS) {
  const p = buildActivityPayload({ facilityName: 'テスト施設', date: '2026-10-19', kind: k, attendees: [], stage: '成約', user: USER });
  if (p.kind !== k) kindsOk = false;
  kindsLog.push(k);
}
ok('7. 種別6値すべて通る', kindsOk && ACTIVITY_KINDS.length === 6, kindsLog.join('/'));
ok('   「面談」は種別として拒否される（ステージへ移動した語）', (() => {
  try { buildActivityPayload({ facilityName: 'テスト施設', date: '2026-10-19', kind: '面談', attendees: [], stage: '成約', user: USER }); return false; }
  catch (e) { return /種別が不正/.test(e.message); }
})());
ok('   「同行」が種別に含まれる', ACTIVITY_KINDS.includes('同行'));

// ---- ケース4: 旧ステータス語彙の読み替え -----------------------------------
const mapOk = Object.entries(LEGACY_STATUS_MAP).every(([o, n]) => normalizeStage(o) === n && STAGES.includes(n));
ok('8. 旧ステータス6値がすべて7値へ読み替わる', mapOk,
   Object.entries(LEGACY_STATUS_MAP).map(([o, n]) => o + '→' + n).join(' / '));
ok('   未知・空のステージでも7値に落ちる（画面を壊さない）',
   STAGES.includes(normalizeStage('')) && STAGES.includes(normalizeStage('なにかの旧値')));
const p4 = buildActivityPayload({ facilityName: 'テスト施設', date: '2026-10-19', kind: '同行', attendees: [], stage: '商談中', user: USER });
ok('   フォームに旧値が来ても保存値は7値', p4.stage === '②決裁者面談', p4.stage);

// ---- ケース5: 必須の欠落は保存前に止まる -----------------------------------
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
ok('9. 施設未選択は保存前に止まる（facilityKey 必須）',
   throws(() => buildActivityPayload({ date: '2026-10-19', kind: '訪問', stage: '成約', user: USER }),
          /施設が選ばれていません（facilityKey は必須）/));

// ---- ケース6: 実データ132件での施設キー検証（追補2）-------------------------
ok('14. 種データ132件を読めた', SEED.length === 132, SEED.length + '件');
const dupId = {};
SEED.forEach(f => { const id = String(f.facilityId || ''); if (id) (dupId[id] = dupId[id] || []).push(f.name); });
const collided = Object.entries(dupId).filter(([, names]) => names.length > 1);
ok('    施設IDが一意でないことを実データで確認（キーに使えない）', collided.length > 0,
   collided.map(([id, n]) => id + '=' + n.join('/')).join(' , '));
const keys = SEED.map(f => facilityKeyOf(f.name));
ok('15. 同じ施設IDの別施設が別キーになる', (() => {
  const pairs = [['GHオアシスA', 'GHオアシスB'], ['なごみの家', 'なごみの里']];
  return pairs.every(([a, b]) => {
    const fa = SEED.find(f => f.name === a), fb = SEED.find(f => f.name === b);
    return fa && fb && fa.facilityId === fb.facilityId && facilityKeyOf(fa.name) !== facilityKeyOf(fb.name);
  });
})(), 'GHオアシスA/B・なごみの家/里 とも 施設IDは同一・キーは別');
ok('    施設キーが132件すべて一意', new Set(keys).size === 132, new Set(keys).size + '/132');
const noTel = SEED.filter(f => !String(f.facilityId || '').trim());
const pNoId = await saveActivityLikeApp({
  facilityKey: facilityKeyOf(noTel[0].name), facilityName: noTel[0].name, facilityId: noTel[0].facilityId || '',
  date: '2026-10-19', kind: '訪問', attendees: [{ name: '窓口の方', title: '' }], stage: '①あいさつ', user: USER
});
ok('16. 施設IDが空の施設でも保存できる（電話未取得' + noTel.length + '件）',
   !!pNoId.facilityKey && !('facilityId' in pNoId) && pNoId.syncState.status === 'pending',
   noTel[0].name + ' → key=' + pNoId.facilityKey);
const noKp = SEED.filter(f => !(f.keypersons || []).length).length;
ok('    キーパーソン0人の施設' + noKp + '件でも「会った人」を手入力で足せる',
   pNoId.attendees.length === 1 && !('cardId' in pNoId.attendees[0]), JSON.stringify(pNoId.attendees));
ok('   ログイン情報が無いと止まる（rules の createdBy.email 要件）',
   throws(() => buildActivityPayload({ facilityName: 'テスト施設', date: '2026-10-19', kind: '訪問', stage: '成約' }), /ログイン/));
ok('   日付が不正だと止まる',
   throws(() => buildActivityPayload({ facilityName: 'テスト施設', date: '2026/10/19', kind: '訪問', stage: '成約', user: USER }), /日付/));

// ---- 静的検査: アプリが本当にこの経路を通るか -------------------------------
const html = read('index.html');
ok('10. index.html が activity_payload.js を import している', /import \* as ActivityPayload from '\.\/activity_payload\.js'/.test(html));
ok('    index.html が buildActivityPayload を呼んでいる', /api\.buildActivityPayload\(/.test(html));
ok('    index.html が activities へ add している', /db\.collection\('activities'\)\.add\(payload\)/.test(html));
ok('    活動タブが存在する', /data-tab="activity"/.test(html) && /id="tab-activity"/.test(html));
ok('    名刺フォームに施設選択がある（facilityKey）', /name="facilityKey"/.test(html));
ok('    名刺の保存に facilityKey と facilityName が入る', /rec\.facilityKey=/.test(html) && /rec\.facilityName=/.test(html));
ok('    活動履歴の検索キーが facilityKey', /where\('facilityKey','==',fkey\)/.test(html));
ok('    ブラウザ側も共有の facilityKeyOf を使う', /m\.facilityKeyOf\(n\)/.test(html));
ok('    名刺の status が7値に揃っている', STAGES.every(s => html.includes('<option>' + s + '</option>') || html.includes('<option>' + s + '</option>'.trim())));
ok('    旧値→新値の対応表がコメントで残っている', /初回接触→①あいさつ/.test(html));
ok('    施設0件のメッセージがある', /施設リストはまだ同期されていません/.test(html));
ok('    禁止表記「柏店」「足立店」を含まない', !/柏店|足立店/.test(html));

// ---- 静的検査: firestore.rules ---------------------------------------------
const rules = read('firestore.rules');
const bak = read('firestore.rules.bak-20261019');
function block(src, name) { // match /<name>/... のブロック本体を波かっこを数えて抜き出す
  const i = src.indexOf('match /' + name + '/'); if (i < 0) return null;
  const eol = src.indexOf('\n', i);
  const j = src.lastIndexOf('{', eol); // 行末の開き波かっこ（パスの {id} ではない方）
  if (j < i) return null;
  let d = 0;
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
  return null;
}
for (const name of ['cards', 'cardImages', 'users', 'config']) {
  ok('11. 既存 match /' + name + '/ が1文字も変わっていない', block(rules, name) === block(bak, name));
}
const fac = block(rules, 'facilities'), act = block(rules, 'activities');
ok('12. facilities: read=isSignedIn / write=false', !!fac && /allow read: if isSignedIn\(\);/.test(fac) && /allow write: if false;/.test(fac));
ok('13. activities: create は pending かつ本人メール必須',
   !!act && /request\.resource\.data\.syncState\.status == 'pending'/.test(act) && /request\.resource\.data\.createdBy\.email == em\(\)/.test(act));
ok('    activities: update は作成者本人かつ syncState 不変', !!act && /request\.resource\.data\.syncState == resource\.data\.syncState/.test(act));
ok('    activities: delete は admin のみ', !!act && /allow delete: if isAdmin\(\);/.test(act));
ok('    ヘルパを新規定義していない（isSignedIn/em/isAdmin の定義は各1回）',
   (rules.match(/function isSignedIn\(\)/g) || []).length === 1 &&
   (rules.match(/function em\(\)/g) || []).length === 1 &&
   (rules.match(/function isAdmin\(\)/g) || []).length === 1);

// ---- 捕捉したペイロード（1件目）を実物として表示 ----------------------------
console.log('\n--- モックFirestoreが受け取ったペイロード（ケース1）---');
console.log(JSON.stringify(captured[0], (k, v) => (v === SERVER_TS ? '<serverTimestamp>' : v), 2));

console.log(`\n=== 結果: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
