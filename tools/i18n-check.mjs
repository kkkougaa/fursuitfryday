/* i18n-check.mjs — 번역 사전 점검 (의존성 없음)
 *   node tools/i18n-check.mjs
 *
 * 키 개수만 맞춰서는 놓치는 것들을 잡는다:
 *   ① ko / ja 짝이 어긋난 키
 *   ② 일본어 칸에 한글이 남은 키 (옮겨 붙이고 번역을 안 한 것)
 *   ③ ko 와 ja 값이 완전히 같고 한글인 키 (같은 이유)
 *   ④ 자리표시자({n},{name})가 어긋난 키 — 런타임에 조용히 깨진다
 *   ⑤ 코드가 쓰는데 사전에 없는 키
 *   ⑥ 사전에 있는데 코드가 안 쓰는 키
 *
 * ⑥은 오탐이 나기 쉽다. 코드가 키를 손으로 잇는 경우가 있어서
 * (`t('accent.' + k)`) 그 접두사를 찾아 예외로 둔다. 세 단 키
 * (chip.unset.event)도 함께 센다.
 */
import { readFileSync, readdirSync } from 'node:fs';

const JS = new URL('../js/', import.meta.url);
const files = readdirSync(JS).filter(f => f.endsWith('.js'));
const dict = readFileSync(new URL('i18n.js', JS), 'utf8');

/* ---------- 사전 읽기 ---------- */
const block = lang => {
  const m = dict.match(new RegExp(`\\n  ${lang}:\\s*\\{([\\s\\S]*?)\\n  \\},`));
  if (!m) throw new Error(`${lang} 블록을 못 찾았습니다`);
  return m[1];
};
const parse = body => {
  const out = new Map();
  const re = /^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm;
  let m;
  while ((m = re.exec(body)) !== null) out.set(m[1], m[2]);
  return out;
};
const ko = parse(block('ko'));
const ja = parse(block('ja'));

/* ---------- 코드가 쓰는 키 ---------- */
const used = new Set();
const prefixes = new Set();
for (const f of files) {
  if (f === 'i18n.js') continue;          // 사전 본체를 세면 전부 "쓰인 것" 이 된다
  const src = readFileSync(new URL(f, JS), 'utf8');
  for (const m of src.matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+){1,2})'/g)) used.add(m[1]);
  // 손으로 잇는 것: t('accent.' + k)
  for (const m of src.matchAll(/'([a-z][a-zA-Z0-9]*\.)'\s*\+/g)) prefixes.add(m[1]);
}

/* ---------- 검사 ---------- */
const HAN = /[가-힣]/;
const ph = v => [...new Set(v.match(/\{(\w+)\}/g) || [])].sort().join(',');

const koOnly = [...ko.keys()].filter(k => !ja.has(k));
const jaOnly = [...ja.keys()].filter(k => !ko.has(k));
const untranslated = [...ja].filter(([, v]) => HAN.test(v)).map(([k]) => k);
const sameValue = [...ko].filter(([k, v]) => ja.get(k) === v && HAN.test(v)).map(([k]) => k);
const phMismatch = [...ko].filter(([k, v]) => ja.has(k) && ph(v) !== ph(ja.get(k))).map(([k]) => k);
/* 파일 이름도 'a.b' 모양이라 정규식에 걸린다(fursuitfryday.catalog.json).
   i18n 키가 확장자로 끝나는 일은 없으므로 걸러낸다. */
const FILEISH = /\.(json|js|css|html|png|webp|mjs)$/;
const missing = [...used]
  .filter(k => !ko.has(k) && !k.startsWith('cd.') && !FILEISH.test(k))
  .sort();
const dead = [...ko.keys()]
  .filter(k => !used.has(k) && ![...prefixes].some(px => k.startsWith(px)))
  .sort();

const dup = (() => {
  const seen = new Set(), d = [];
  for (const m of block('ko').matchAll(/^\s*'([^']+)':/gm)) {
    if (seen.has(m[1])) d.push(m[1]); else seen.add(m[1]);
  }
  return d;
})();

/* ---------- 결과 ---------- */
const rows = [
  ['ko / ja 개수', `${ko.size} / ${ja.size}`, ko.size === ja.size],
  ['ko 에만 있는 키', koOnly.length || '없음', !koOnly.length],
  ['ja 에만 있는 키', jaOnly.length || '없음', !jaOnly.length],
  ['중복된 키', dup.length || '없음', !dup.length],
  ['일본어 칸에 한글', untranslated.length || '없음', !untranslated.length],
  ['ko/ja 값이 동일(한글)', sameValue.length || '없음', !sameValue.length],
  ['자리표시자 불일치', phMismatch.length || '없음', !phMismatch.length],
  ['코드가 쓰는데 없는 키', missing.length || '없음', !missing.length],
  ['사전에 있는데 안 쓰는 키', dead.length || '없음', !dead.length],
];
for (const [name, val, good] of rows) {
  console.log(`  ${good ? '✓' : '✗'} ${name.padEnd(26)} ${val}`);
}
const show = (label, arr) => { if (arr.length) console.log(`\n${label}\n` + arr.map(k => '  ' + k).join('\n')); };
show('ko 에만:', koOnly);
show('ja 에만:', jaOnly);
show('중복:', dup);
show('일본어 칸에 한글이 남은 키:', untranslated);
show('ko/ja 가 같고 한글인 키:', sameValue);
show('자리표시자가 어긋난 키:', phMismatch);
show('코드가 쓰는데 사전에 없는 키:', missing);
show('사전에 있는데 코드가 안 쓰는 키:', dead);

const bad = rows.some(([, , good]) => !good);
console.log(bad ? '\n손볼 것이 있습니다.' : '\n이상 없습니다.');
process.exit(bad ? 1 : 0);
