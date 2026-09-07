/* thumbs.js — 썸네일 지연 로딩 + 영구 캐시
 *
 * 3단 캐시
 *   1) 메모리 (blob URL)      — 같은 화면 안에서 즉시. 상한이 있다.
 *   2) IndexedDB (blob)       — 앱을 다시 열어도 즉시. 400px 그리드 썸네일만.
 *   3) 드라이브 thumbnailLink — 처음 한 번
 *
 * thumbnailLink 는 수명이 짧아 catalog 에 저장하지 않는다. 대신 받아온
 * 이미지 자체를 IDB 에 남긴다.
 *
 * ── 메모리에 대해 ──────────────────────────────────────────────
 * 예전에는 blob URL 을 Map 에 넣고 한 번도 지우지 않았다. 사진이 몇백 장
 * 넘어가면 사파리가 렌더러를 통째로 죽였다("반복적인 문제가 발생했습니다").
 * blob URL 은 revokeObjectURL 을 부르기 전까지 그 이미지를 메모리에 붙잡아
 * 두기 때문이다. 스크롤할수록 쌓이기만 하니 언젠가는 반드시 넘친다.
 *
 * 그래서 두 가지를 바꿨다.
 *   · 그리드 썸네일은 MEM_MAX 장만 들고, 오래된 것부터 URL 을 해제한다.
 *     해제한 타일이 아직 화면에 남아 있으면 src 를 비우고 다시 관찰에
 *     넣는다 — 스크롤해서 돌아오면 IDB 에서 즉시 다시 채워지므로 사용자는
 *     차이를 못 느낀다.
 *   · 큰 미리보기(1200·1600px)는 아예 캐시하지 않고 한 장만 들고 있는다.
 *     장당 수 MB 라 이게 제일 빨리 메모리를 먹었다.
 */
import { pool } from './auth.js';
import { thumbBlob } from './drive.js';
import * as store from './thumbcache.js';

const GRID = 400;

/* 화면에 한 번에 보이는 건 20장 남짓, 그리드가 렌더하는 건 90장이다.
   그보다 넉넉히 두되 무한하지는 않게. 400px 썸네일 장당 40~60KB 기준
   240장이면 15MB 안쪽이다. */
const MEM_MAX = 240;

const mem = new Map();    // key → blob URL (Map 의 삽입 순서를 LRU 로 쓴다)
const meta = new Map();   // fileId → drive file
const run = pool(4);      // 동시 요청. 8 은 아이폰에서 디코딩이 겹쳐 버거웠다
const inflight = new Map();

let provider = null;      // 데모 모드용 — 드라이브 대신 로컬 생성
export function setProvider(fn) { provider = fn; }

export function remember(files) {
  for (const f of files) meta.set(f.id, f);
}
export const known = id => meta.has(id);

const key = (id, size) => `${id}@${size}`;

/* ---------- 메모리 캐시 (상한 있는 LRU) ---------- */

function memGet(k) {
  if (!mem.has(k)) return null;
  const v = mem.get(k);
  mem.delete(k);      // 다시 넣어 "최근 쓴 것" 으로 올린다
  mem.set(k, v);
  return v;
}

function memSet(k, url) {
  mem.set(k, url);
  trim();
}

function trim() {
  let guard = mem.size;
  while (mem.size > MEM_MAX && guard-- > 0) {
    const k = mem.keys().next().value;   // 가장 오래 안 쓴 것
    const url = mem.get(k);
    mem.delete(k);

    /* 그 URL 을 물고 있는 타일이 아직 DOM 에 있으면 비워 준다. src 를 남긴
       채 revoke 하면 이미지가 깨진 아이콘으로 바뀐다. 관찰에 다시 넣으면
       화면에 들어올 때 IDB 에서 곧바로 채워진다. */
    const img = document.querySelector(`img[data-k="${k}"]`);
    if (img) {
      img.removeAttribute('src');
      img.removeAttribute('data-k');
      img.classList.remove('ready');
      io.observe(img);
    }
    URL.revokeObjectURL(url);
  }
}

/* ---------- 지연 로딩 ---------- */

/* rootMargin 을 크게 잡을수록 미리 받아 두어 스크롤이 매끄럽지만, 그만큼
   한꺼번에 디코딩된다. 500px 이면 한 화면 앞까지만 준비한다. */
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    fill(e.target);
  }
}, { rootMargin: '500px 0px' });

/**
 * <img data-fid> 를 채운다.
 * 화면에 보이는 앞쪽 몇 장은 관찰을 기다리지 않고 바로 받는다 —
 * 첫 화면이 비어 보이는 것을 막는 데 이게 제일 크다.
 */
export function observe(img, eager = false) {
  const id = img.dataset.fid;
  if (!id) return;
  const k = key(id, GRID);
  const hit = memGet(k);
  if (hit) { apply(img, hit, k); return; }
  if (eager) { fill(img); return; }
  io.observe(img);
}

/** 목록을 렌더한 직후 호출 — IDB 를 한 번에 읽어 보이는 부분을 즉시 채운다. */
export async function warm(imgs, eagerCount = 14) {
  const list = [...imgs];
  const ids = list.map(i => i.dataset.fid).filter(Boolean);
  if (!ids.length) return;

  if (!provider) {
    /* 예전에는 목록 전체를 IDB 에서 한 번에 꺼내 전부 blob URL 로 만들었다.
       90장이면 90개가 즉시 메모리에 올라온다. 앞쪽만 미리 꺼내고 나머지는
       관찰에 맡긴다. */
    const head = list.slice(0, eagerCount);
    const hit = await store.getMany(head.map(i => key(i.dataset.fid, GRID)));
    for (const img of head) {
      const k = key(img.dataset.fid, GRID);
      const blob = hit.get(k);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      memSet(k, url);
      apply(img, url, k);
    }
  }
  list.forEach((img, i) => { if (!img.classList.contains('ready')) observe(img, i < eagerCount); });
}

async function fill(img) {
  const id = img.dataset.fid;
  const k = key(id, GRID);
  const hit = memGet(k);
  if (hit) return apply(img, hit, k);
  try {
    const url = await gridUrl(id);
    // 그 사이 타일이 다른 사진으로 바뀌었을 수 있다(목록 재렌더)
    if (url && img.dataset.fid === id) apply(img, url, k);
  } catch { /* 조용히 빈 타일로 남긴다 */ }
}

/** 그리드 썸네일 URL. 메모리 → IDB → 드라이브 순. */
function gridUrl(id) {
  const k = key(id, GRID);
  const hit = memGet(k);
  if (hit) return Promise.resolve(hit);
  if (inflight.has(k)) return inflight.get(k);

  const p = (async () => {
    if (provider) {
      const url = await provider(id, GRID);
      if (url) memSet(k, url);
      return url;
    }
    const cached = await store.get(k);
    if (cached) {
      const url = URL.createObjectURL(cached);
      memSet(k, url);
      return url;
    }
    const blob = await rawBlob(id, GRID);
    if (!blob) return null;
    store.put(k, blob);
    const url = URL.createObjectURL(blob);
    memSet(k, url);
    return url;
  })().finally(() => inflight.delete(k));

  inflight.set(k, p);
  return p;
}

/** 드라이브에서 blob 자체를 받는다. 캐시에 넣지 않는다. */
async function rawBlob(id, size) {
  const f = meta.get(id);
  if (!f) return null;
  return run(async () => {
    const url = await thumbBlob(f, size);
    const blob = await (await fetch(url)).blob();
    URL.revokeObjectURL(url);   // drive.thumbBlob 이 만든 임시 URL
    return blob;
  });
}

function apply(img, url, k) {
  if (img.src === url) return;
  img.src = url;
  if (k) img.dataset.k = k;     // trim() 이 이 타일을 찾을 수 있게
  if (img.complete) img.classList.add('ready');
  else img.addEventListener('load', () => img.classList.add('ready'), { once: true });
}

/* ---------- 큰 미리보기 ---------- */

/* 1200px 한 장이 수 MB 다. 사진을 20장 넘겨보면 그것만으로 죽는다.
   그래서 딱 한 장만 들고, 다음 것을 받을 때 앞의 것을 해제한다. */
let bigSlot = null;   // { k, url }

export async function big(id, size = 1200) {
  const k = key(id, size);
  if (bigSlot && bigSlot.k === k) return bigSlot.url;

  let url;
  if (provider) {
    url = await provider(id, size);
    if (!url) return null;
  } else {
    const blob = await rawBlob(id, size);
    if (!blob) return null;
    url = URL.createObjectURL(blob);
  }

  // 그 사이 다른 사진을 열었으면 방금 받은 것을 버린다
  if (bigSlot && bigSlot.k !== k && !provider) URL.revokeObjectURL(bigSlot.url);
  bigSlot = { k, url };
  return url;
}

/** 열려 있던 큰 미리보기를 놓아준다. 사진 화면을 닫을 때 부른다. */
export function releaseBig() {
  if (bigSlot && !provider) URL.revokeObjectURL(bigSlot.url);
  bigSlot = null;
}

/** 원본에 가까운 blob — 복사할 때 쓴다. URL 을 만들지 않는다. */
export async function blobOf(id, size = 1600) {
  if (provider) {
    const url = await provider(id, size);
    return url ? (await fetch(url)).blob() : null;
  }
  return rawBlob(id, size);
}

export async function cacheInfo() {
  return { entries: await store.count() };
}
export async function clearCache() {
  for (const url of mem.values()) URL.revokeObjectURL(url);
  mem.clear();
  releaseBig();
  await store.clear();
}
export const prune = store.prune;
