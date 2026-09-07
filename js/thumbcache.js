/* thumbcache.js — 썸네일을 IndexedDB 에 남긴다
 *
 * 왜: 메모리 캐시만 두면 앱을 다시 열 때마다 1,284장을 드라이브에서 다시
 * 받아와 그리드가 느리게 채워진다. 400px 썸네일은 장당 30~60KB 라
 * 2천 장이라도 100MB 안쪽이고, 홈 화면 웹앱은 사파리의 7일 저장소 삭제
 * 정책에서 제외되므로 캐시가 살아 있다.
 *
 * 원본 사진은 캐시하지 않는다. 큰 미리보기는 메모리에만 둔다.
 */

const DB = 'cutdaejang';
const STORE = 'thumbs';
const MAX = 4000;          // 항목 상한 — 넘으면 오래된 것부터 버린다

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((ok, no) => {
    if (!('indexedDB' in self)) return no(new Error('no idb'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: 'k' });
        st.createIndex('at', 'at');
      }
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  }).catch(e => { dbp = null; throw e; });
  return dbp;
}

function tx(mode) {
  return open().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

export async function get(key) {
  try {
    const st = await tx('readonly');
    return await new Promise((ok, no) => {
      const r = st.get(key);
      r.onsuccess = () => ok(r.result ? r.result.b : null);
      r.onerror = () => no(r.error);
    });
  } catch { return null; }
}

export async function put(key, blob) {
  try {
    const st = await tx('readwrite');
    st.put({ k: key, b: blob, at: Date.now() });
  } catch { /* 용량 초과·프라이빗 모드 — 캐시 없이도 동작한다 */ }
}

/** 여러 키를 한 트랜잭션으로 읽는다. 그리드 첫 화면을 즉시 채우기 위한 것. */
export async function getMany(keys) {
  const out = new Map();
  if (!keys.length) return out;
  try {
    const st = await tx('readonly');
    await Promise.all(keys.map(k => new Promise(res => {
      const r = st.get(k);
      r.onsuccess = () => { if (r.result) out.set(k, r.result.b); res(); };
      r.onerror = () => res();
    })));
  } catch { /* 무시 */ }
  return out;
}

export async function count() {
  try {
    const st = await tx('readonly');
    return await new Promise(ok => { const r = st.count(); r.onsuccess = () => ok(r.result); r.onerror = () => ok(0); });
  } catch { return 0; }
}

/** 상한을 넘으면 오래된 것부터 버린다. */
export async function prune(max = MAX) {
  try {
    const n = await count();
    if (n <= max) return 0;
    const st = await tx('readwrite');
    let drop = n - max;
    return await new Promise(ok => {
      const cur = st.index('at').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || drop <= 0) return ok(n - max);
        c.delete();
        drop--;
        c.continue();
      };
      cur.onerror = () => ok(0);
    });
  } catch { return 0; }
}

export async function clear() {
  try {
    const st = await tx('readwrite');
    st.clear();
  } catch { /* 무시 */ }
}
