// 名刺の追加フィールドを index.html と Node テストで共有する純関数群。

export function todayYmd(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeEmail(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export function cardEmails(card) {
  if (!card) return [];
  return [...new Set([card.email, card.emailPersonal].map(normalizeEmail).filter(Boolean))];
}

export function matchesSearch(card, q) {
  const needle = q == null ? '' : String(q).trim().toLowerCase();
  if (!needle) return true;
  const source = card || {};
  return [source.name, source.kana, source.company, source.department, source.title, ...cardEmails(source)]
    .some(v => String(v == null ? '' : v).toLowerCase().includes(needle));
}

export function findEmailDuplicates(cards, { email, emailPersonal, excludeId } = {}) {
  const targets = new Set([email, emailPersonal].map(normalizeEmail).filter(Boolean));
  if (!targets.size || !Array.isArray(cards)) return [];
  return cards.filter(card => card && (excludeId == null || card.id !== excludeId) && cardEmails(card).some(v => targets.has(v)));
}

export function buildCardFields(form, { existing, now } = {}) {
  const source = form || {};
  const clean = v => typeof v === 'string' ? v.trim() : '';
  let receivedDate = clean(source.receivedDate);
  if (!receivedDate && !existing) receivedDate = todayYmd(now);
  return {
    email: clean(source.email),
    emailPersonal: clean(source.emailPersonal),
    receivedDate
  };
}

export function formatReceivedDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

export function csvColumns() {
  return [
    ['name', '氏名'],
    ['kana', 'フリガナ'],
    ['company', '会社名'],
    ['department', '部署'],
    ['title', '役職'],
    ['email', 'メール（会社用）'],
    ['emailPersonal', 'メール（個人用）'],
    ['phone', '電話'],
    ['mobile', '携帯'],
    ['address', '住所'],
    ['url', 'URL'],
    ['receivedDate', '名刺取得日'],
    ['status', 'ステータス'],
    ['nextActionDate', '次アクション日'],
    ['memo', 'メモ'],
    ['createdByName', '登録者']
  ];
}

export function normalizeExtracted(data) {
  const source = data || {};
  const email = typeof source.email === 'string' ? source.email.trim() : '';
  let emailPersonal = typeof source.emailPersonal === 'string' ? source.emailPersonal.trim() : '';
  if (normalizeEmail(email) && normalizeEmail(email) === normalizeEmail(emailPersonal)) emailPersonal = '';
  return { email, emailPersonal };
}

export function classifyReadError(err) {
  const detail = err && typeof err.message === 'string' ? err.message : '';
  if (/Gemini 40[03]\b/.test(detail)) {
    return {
      kind: 'key_invalid',
      message: 'AI読み取りキーが無効/期限切れの可能性があります。右上「AI読み取りキー」から再登録してください'
    };
  }
  if (/Gemini 402\b/.test(detail)) {
    return {
      kind: 'quota_exhausted',
      message: 'AI読み取りの利用残高が切れています。管理者に連絡してください。今回は手入力してください'
    };
  }
  if (/Gemini 429\b/.test(detail)) {
    return {
      kind: 'rate_limited',
      message: 'AI読み取りの利用上限に達しました。しばらく待ってからもう一度お試しください。急ぐ場合は手入力してください'
    };
  }
  return { kind: 'other', message: 'AI読み取りに失敗。手入力してください' };
}
