#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'activity_payload.js'), 'utf8');
const payload = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(here, 'firestore.rules'), 'utf8');

let failed = 0;
function check(title, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${title}`);
  if (!condition) failed++;
}

const facilities = [
  { name: '医療法人 ワイズ病院', tel: '03-1234-5678' },
  { name: '東葛クリニック', tel: '04-9999-0000' },
];

const phoneHit = payload.findFacilityDuplicates('別名の施設', '０３（１２３４）５６７８', facilities);
check('電話番号は全角・記号を除去して全体一致を検出する', phoneHit.phoneMatches.length === 1 && phoneHit.phoneMatches[0].name === '医療法人 ワイズ病院');

const nameHit = payload.findFacilityDuplicates('ワイズ 病院', '03-0000-0000', facilities);
check('電話不一致でも正規化した施設名の相互部分一致を検出する', nameHit.phoneMatches.length === 0 && nameHit.nameMatches.length === 1);

const noSuffixMatch = payload.findFacilityDuplicates('別施設', '00-0000-5678', facilities);
check('電話番号の下4桁だけでは一致にしない', noSuffixMatch.phoneMatches.length === 0);

const regularScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=|\btype\s*=\s*["']module["']/i.test(m[1]));
let scriptOk = regularScripts.length > 0;
try { for (const m of regularScripts) new Function(m[2]); } catch { scriptOk = false; }
check('index.html の埋め込み通常スクリプトが構文解析できる', scriptOk);
check('新規施設UIに必須4項目と固定4エリアがある',
  /name="newFacilityName"[^>]*required/.test(html)
  && /name="newFacilityPhone"[^>]*required/.test(html)
  && /name="newFacilityArea"[^>]*required/.test(html)
  && /name="newFacilityKubun"[^>]*required/.test(html)
  && ['東葛', '城北', '西東京', '外来'].every((v) => html.includes(`<option>${v}</option>`)));
check('facilities のクライアント書込禁止を維持する', /match \/facilities\/\{id\}[\s\S]*?allow write: if false;/.test(rules));
check('facility_requests の create/update 状態ガードがある',
  /match \/facility_requests\/\{id\}/.test(rules)
  && /request\.resource\.data\.status == 'pending'/.test(rules)
  && /request\.resource\.data\.status == resource\.data\.status/.test(rules));

if (failed) process.exitCode = 1;
else console.log('全検証PASS');
