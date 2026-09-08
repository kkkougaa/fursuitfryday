/* 저장 유실 재현 테스트.
 *
 * 브라우저 없이 store.js 만 돌린다. drive 모듈을 가짜로 바꿔치기해서
 * 쓰기에 지연을 넣고, 그 지연 중에 한 변경이 살아남는지 본다.
 *
 * 고치기 전에는 ③이 실패했다: 저장 중에 한 변경이 dirty=false 에 쓸려
 * 나가 영원히 올라가지 않았다.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

/* drive.js 를 가짜로 바꿔치기하는 로더.
   훅은 별도 컨텍스트에서 돌아 globalThis 가 안 보이므로 소스를 안에 담는다. */
const FAKE = `
export const state = { file: null, version: 1, delay: 0, fail: 0, writes: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function findCatalog() { return state.file ? { id: 'f1', version: String(state.version) } : null; }
export async function readCatalog() { return JSON.parse(state.file); }
export async function getFile() { return { version: String(state.version) }; }
export async function createCatalog(data) {
  await sleep(state.delay);
  state.file = JSON.stringify(data); state.version++; state.writes++;
  return { id: 'f1', version: String(state.version) };
}
export async function writeCatalog(id, data, base) {
  /* 본문은 **보내는 순간** 고정된다. 실제 fetch 도 JSON.stringify 를 요청
     만들 때 하므로, 업로드가 끝나기를 기다리는 동안 온 변경은 이 본문에
     담기지 않는다. 지연 뒤에 직렬화하면 버그를 못 짚는다. */
  const body = JSON.stringify(data);
  await sleep(state.delay);
  if (state.fail > 0) { state.fail--; throw new Error('network down'); }
  if (base != null && String(base) !== String(state.version)) {
    throw Object.assign(new Error('conflict'), { conflict: true });
  }
  state.file = body; state.version++; state.writes++;
  return { id, version: String(state.version) };
}
export async function listBackups() { return []; }
export async function createBackup() { return {}; }
export async function deleteFile() {}
export async function listImages() { return { files: [], folders: [] }; }
`;

const HOOK = `
const FAKE = ${JSON.stringify('PLACEHOLDER')};
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('/drive.js') || spec === './drive.js') {
    return { url: 'fake-drive:', shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === 'fake-drive:') return { format: 'module', shortCircuit: true, source: FAKE };
  return next(url, ctx);
}
`.replace(JSON.stringify('PLACEHOLDER'), () => JSON.stringify(FAKE));

register('data:text/javascript,' + encodeURIComponent(HOOK), pathToFileURL('./'));

/* localStorage 흉내 */
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
  get length() { return mem.size; },
  key: i => [...mem.keys()][i],
};

/* i18n.js 가 document.documentElement.lang 을 만진다. 저장 로직과는
   무관하지만 모듈 평가 때 실행되므로 최소한만 흉내 낸다. */
globalThis.document = { documentElement: {} };

const store = await import(new URL('../js/store.js', import.meta.url).href);
const drive = await import('fake-drive:');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};

/* ── ① 기본 저장 ───────────────────────────────────────────────── */
store.S.catFileId = 'f1';
store.S.catVersion = null;      // 첫 쓰기는 버전 검사 없이
drive.state.file = JSON.stringify(store.S.cat);
drive.state.version = 1;

store.S.cat.tags.push('첫태그');
store.touch();
await sleep(3000);
ok('① 일반 변경이 올라간다', JSON.parse(drive.state.file).tags.includes('첫태그'));

/* ── ② 저장 중에 온 변경도 올라간다 (유실 버그) ─────────────────── */
drive.state.delay = 800;        // 쓰기가 0.8초 걸린다
store.S.catVersion = String(drive.state.version);
store.S.cat.tags.push('저장중A');
store.touch();
await sleep(2600);              // flush 가 막 시작해 await 중
store.S.cat.tags.push('저장중B');   // ← 예전에는 이게 사라졌다
store.touch();
await sleep(3000);
const t2 = JSON.parse(drive.state.file).tags;
ok('② 저장 중에 온 변경이 살아남는다', t2.includes('저장중A') && t2.includes('저장중B'),
  JSON.stringify(t2));

/* ── ③ 쓰기가 실패하면 로컬에 남고 다시 시도한다 ────────────────── */
drive.state.delay = 0;
drive.state.fail = 2;           // 두 번 실패한 뒤 성공
store.S.catVersion = String(drive.state.version);
store.S.cat.tags.push('실패후복구');
store.touch();
await sleep(2800);
const heldLocally = !!store.pendingLocal();
ok('③-1 실패하면 로컬에 남는다', heldLocally && store.S.dirty);
await sleep(14000);             // 4초 → 8초 백오프
const t3 = JSON.parse(drive.state.file).tags;
ok('③-2 물러가며 다시 시도해 결국 올라간다', t3.includes('실패후복구'), JSON.stringify(t3));
ok('③-3 올라간 뒤 로컬 안전망을 비운다', !store.pendingLocal());

/* ── ④ 부팅 복구: 못 올린 로컬이 드라이브본 위에 얹힌다 ─────────── */
// 드라이브에는 없고 로컬에만 있는 변경을 만든다
const serverOnly = JSON.parse(drive.state.file);
serverOnly.tags = [...serverOnly.tags, '다른기기태그'];
drive.state.file = JSON.stringify(serverOnly);
drive.state.version++;

const local = JSON.parse(JSON.stringify(store.S.cat));
local.tags = [...local.tags, '못올린태그'];
localStorage.setItem('cd.cat.pending', JSON.stringify({ at: Date.now(), cat: local }));

store.S.cat = { photos: {} };   // 메모리를 비워 부팅 흉내
const r = await store.load();
const t4 = store.S.cat.tags;
ok('④-1 로컬의 못 올린 변경이 살아난다', t4.includes('못올린태그'), JSON.stringify(t4));
ok('④-2 다른 기기 변경도 함께 남는다', t4.includes('다른기기태그'), JSON.stringify(t4));
ok('④-3 복구했다는 사실을 알려 준다', !!r.recovered);
await sleep(2500);
ok('④-4 복구분이 드라이브로 올라간다',
  JSON.parse(drive.state.file).tags.includes('못올린태그'));

console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
