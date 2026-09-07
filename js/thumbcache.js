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

/*
 * 트랜잭션이 끝날 때까지 기다린다.
 *
 * 예전에는 put 을 던져만 놓고 바로 돌아왔다. 미리 받기처럼 빠르게 연달아
 * 부르면 아직 디스크에 안 내려간 blob 들이 대기열에 그대로 쌓인다 — 수백
 * 장이 메모리에 떠 있는 셈이라, 정작 저장은 잘 되는데 탭이 죽었다.
 * 여기서 기다리면 받는 속도가 저장 속도를 앞지르지 못한다.
 */
export async function put(key, blob) {
  try {
    const db = await open();
    await new Promise((ok, no) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put({ k: key, b: blob, at: Date.now() });
      t.oncomplete = ok;
      t.onerror = () => no(t.error);
      t.onabort = () => no(t.error);
    });
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

/**
 * 이미 저장돼 있는 키만 골라낸다.
 *
 * get() 을 쓰면 blob 까지 메모리로 끌어오므로, 몇천 장을 훑는 미리 받기에는
 * 쓸 수 없다. getKey() 는 키만 돌려주고 값은 건드리지 않는다.
 */
export async function hasMany(keys) {
  const out = new Set();
  if (!keys.length) return out;
  // 몇천 개를 한 트랜잭션에 몰아넣으면 아이폰에서 버겁다. 잘라서 묻는다.
  const CHUNK = 400;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const part = keys.slice(i, i + CHUNK);
    try {
      const st = await tx('readonly');
      await Promise.all(part.map(k => new Promise(res => {
        const r = st.getKey(k);
        r.onsuccess = () => { if (r.result != null) out.add(k); res(); };
        r.onerror = () => res();
      })));
    } catch { /* 무시 — 없는 것으로 보고 다시 받는다 */ }
  }
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

/**
 * 지금 쓰는 크기가 아닌 썸네일을 버린다.
 *
 * 캐시 키에 크기가 들어 있어서(`fileId@288`), 크기를 바꾸면 예전 것들이
 * 읽히지도 지워지지도 않은 채 저장 공간만 차지한다. 400px 로 2천 장을
 * 받아뒀다면 100MB 가 그대로 남는 셈이라, 새 크기를 받을 자리를 오히려
 * 뺏는다. 크기를 바꾼 뒤 한 번만 돌면 된다.
 */
export async function dropOtherSizes(keepSuffix) {
  try {
    const st = await tx('readwrite');
    let dropped = 0;
    return await new Promise(ok => {
      const cur = st.openKeyCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return ok(dropped);
        if (!String(c.key).endsWith(keepSuffix)) { st.delete(c.key); dropped++; }
        c.continue();
      };
      cur.onerror = () => ok(dropped);
    });
  } catch { return 0; }
}

export async function clear() {
  try {
    const st = await tx('readwrite');
    st.clear();
  } catch { /* 무시 */ }
}
