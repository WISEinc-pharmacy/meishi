import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  buildCardFields,
  cardEmails,
  classifyReadError,
  csvColumns,
  findEmailDuplicates,
  formatReceivedDate,
  matchesSearch,
  normalizeEmail,
  normalizeExtracted,
  todayYmd
} from './card_fields.js';

function testTodayYmd() {
  assert.equal(todayYmd(new Date(2026, 0, 2, 23, 59)), '2026-01-02');
}

function testNormalizeEmail() {
  assert.equal(normalizeEmail('  Work@Example.COM '), 'work@example.com');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(123), '');
}

function testCardEmails() {
  assert.deepEqual(cardEmails(null), []);
  assert.deepEqual(cardEmails({ email: ' A@EXAMPLE.com ', emailPersonal: 'a@example.com' }), ['a@example.com']);
  assert.deepEqual(cardEmails({ email: 'work@example.com' }), ['work@example.com']);
}

function testMatchesSearch() {
  const legacy = { name: '山田 太郎', company: 'ワイズ', email: 'work@example.com' };
  assert.equal(matchesSearch(legacy, 'wise'), false);
  assert.equal(matchesSearch(legacy, 'WORK@EXAMPLE'), true);
  assert.equal(matchesSearch({ emailPersonal: 'Private@Example.com' }, 'private@'), true);
  assert.equal(matchesSearch(null, ''), true);
}

function testFindEmailDuplicates() {
  const cards = [
    { id: 'legacy', email: 'WORK@example.com' },
    { id: 'personal', emailPersonal: 'Private@Example.com' },
    { id: 'other', email: 'other@example.com', emailPersonal: null }
  ];
  assert.deepEqual(findEmailDuplicates(cards, { email: ' work@EXAMPLE.com ' }).map(c => c.id), ['legacy']);
  assert.deepEqual(findEmailDuplicates(cards, { emailPersonal: 'PRIVATE@example.COM' }).map(c => c.id), ['personal']);
  assert.deepEqual(findEmailDuplicates(cards, { email: 'private@example.com', excludeId: 'personal' }), []);
  assert.equal(findEmailDuplicates([{ email: 'no-id@example.com' }], { email: 'NO-ID@example.com' }).length, 1);
  assert.deepEqual(findEmailDuplicates(cards, { email: '', emailPersonal: null }), []);
}

function testBuildCardFields() {
  const now = new Date(2026, 2, 4, 8, 0);
  assert.deepEqual(
    buildCardFields({ email: ' work@example.com ', emailPersonal: ' private@example.com ', receivedDate: '' }, { now }),
    { email: 'work@example.com', emailPersonal: 'private@example.com', receivedDate: '2026-03-04' }
  );
  assert.equal(buildCardFields({ receivedDate: '' }, { existing: { id: '1' }, now }).receivedDate, '');
  assert.equal(buildCardFields({ receivedDate: ' 2025-12-31 ' }, { now }).receivedDate, '2025-12-31');
}

function testFormatReceivedDate() {
  assert.equal(formatReceivedDate('2026-03-04'), '2026-03-04');
  assert.equal(formatReceivedDate('2026-3-4'), '');
  assert.equal(formatReceivedDate(null), '');
}

function testCsvColumns() {
  const columns = csvColumns();
  const keys = columns.map(([key]) => key);
  assert.equal(keys[keys.indexOf('email') + 1], 'emailPersonal');
  assert.equal(keys[keys.indexOf('status') - 1], 'receivedDate');
  const existingKeys = ['name', 'kana', 'company', 'department', 'title', 'email', 'phone', 'mobile', 'address', 'url', 'status', 'nextActionDate', 'memo', 'createdByName'];
  assert.deepEqual(keys.filter(key => existingKeys.includes(key)), existingKeys);
}

function testNormalizeExtracted() {
  assert.deepEqual(normalizeExtracted({ email: ' work@example.com ' }), { email: 'work@example.com', emailPersonal: '' });
  assert.deepEqual(
    normalizeExtracted({ email: 'work@example.com', emailPersonal: 'private@example.com' }),
    { email: 'work@example.com', emailPersonal: 'private@example.com' }
  );
  assert.deepEqual(
    normalizeExtracted({ email: 'Same@Example.com', emailPersonal: ' same@example.COM ' }),
    { email: 'Same@Example.com', emailPersonal: '' }
  );
}

function testClassifyReadError() {
  assert.equal(classifyReadError(new Error('Gemini 400')).kind, 'key_invalid');
  assert.equal(classifyReadError(new Error('Gemini 403')).kind, 'key_invalid');
  assert.deepEqual(classifyReadError(new Error('Gemini 402')), {
    kind: 'quota_exhausted',
    message: 'AI読み取りの利用残高が切れています。管理者に連絡してください。今回は手入力してください'
  });
  assert.deepEqual(classifyReadError(new Error('Gemini 429')), {
    kind: 'rate_limited',
    message: 'AI読み取りの利用上限に達しました。しばらく待ってからもう一度お試しください。急ぐ場合は手入力してください'
  });
  assert.equal(classifyReadError(new Error('Gemini 500')).kind, 'other');
  assert.equal(classifyReadError(new Error('unrelated')).kind, 'other');
  assert.equal(classifyReadError(undefined).kind, 'other');
  assert.equal(classifyReadError({}).kind, 'other');
}

function testInlineScriptSyntax() {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const conflictMarkers = ['<'.repeat(7), '='.repeat(7), '>'.repeat(7)];
  const conflictLine = new RegExp(`^(?:${conflictMarkers.join('|')})(?: .*)?$`, 'm');
  assert.equal(conflictLine.test(html), false, '競合マーカーが残っています');

  const moduleScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => /\btype\s*=\s*["']module["']/i.test(attrs))
    .map(([, , source]) => source);
  assert.equal(moduleScripts.length, 1);
  const moduleChecked = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
    input: moduleScripts[0], encoding: 'utf8'
  });
  assert.equal(moduleChecked.status, 0, moduleChecked.stderr || moduleChecked.stdout);

  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc\s*=|\btype\s*=\s*["']module["']/i.test(attrs))
    .map(([, , source]) => source);
  assert.equal(scripts.length, 1);
  const checked = spawnSync(process.execPath, ['--check', '-'], { input: scripts[0], encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
}

try {
  testTodayYmd();
  testNormalizeEmail();
  testCardEmails();
  testMatchesSearch();
  testFindEmailDuplicates();
  testBuildCardFields();
  testFormatReceivedDate();
  testCsvColumns();
  testNormalizeExtracted();
  testClassifyReadError();
  testInlineScriptSyntax();
  console.log('ALL PASS');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
