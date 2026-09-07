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
import { thumbBlob, getFile } from './drive.js';
import * as store from './thumbcache.js';

/* 그리드 타일은 3열이라 아이폰에서 한 변이 126px 남짓이다. 3배 화면을
   기준으로 해도 380px 이면 충분한데 400 은 여유가 과했다. 288 로 낮추면
   장당 용량이 40~60KB 에서 15~25KB 로 떨어진다 — 2천 장이면 100MB 가
   40MB 가 되는 차이고, 받는 시간도 그만큼 줄어든다. */
const GRID = 288;

/* 화면에 한 번에 보이는 건 20장 남짓, 그리드가 렌더하는 건 90장이다.
   그보다 넉넉히 두되 무한하지는 않게. 400px 썸네일 장당 40~60KB 기준
   240장이면 15MB 안쪽이다. */
const MEM_MAX = 120;

const mem = new Map();    // key → blob URL (Map 의 삽입 순서를 LRU 로 쓴다)
const meta = new Map();   // fileId → drive file
const run = pool(2);      // 동시 요청. 한 번에 두 장이면 스크롤이 충분히 따라온다
const inflight = new Map();

let provider = null;      // 데모 모드용 — 드라이브 대신 로컬 생성
export function setProvider(fn) { provider = fn; }

/* ?nothumb=1 진단용. 썸네일을 한 장도 받지 않는다. 이걸 켜고도 죽는다면
   원인은 이미지가 아니라 다른 곳에 있다. */
let off = false;
export function disable() { off = true; }

export function remember(files) {
  for (const f of files) meta.set(f.id, f);
}
export const known = id => meta.has(id);

/*
 * 파일 정보를 확보한다.
 *
 * 썸네일을 받으려면 thumbnailLink 가 필요한데, 그건 drive 목록에만 있고
 * catalog.json 에는 저장하지 않는다(수명이 짧아서 저장해봐야 곧 죽는다).
 * 예전에는 앱을 열 때마다 동기화를 돌려 이 정보가 늘 채워져 있었다.
 * 동기화를 버튼으로 뺀 순간, 앱을 열면 meta 가 텅 빈 채로 남아
 * **썸네일이 한 장도 안 뜨는** 상태가 됐다. IDB 에 캐시된 것만 보이는데,
 * 크기를 288 로 바꾸면서 그 캐시마저 전부 무효가 됐으니 결국 아무것도
 * 안 보였다.
 *
 * 그래서 없으면 그때 한 장씩 물어본다. 어차피 썸네일을 받으려고 네트워크를
 * 쓰는 참이고, 캐시에 있는 사진은 여기까지 오지도 않는다.
 */
const metaWait = new Map();

function fileMeta(id) {
  const hit = meta.get(id);
  if (hit) return Promise.resolve(hit);
  if (metaWait.has(id)) return metaWait.get(id);

  const p = getFile(id, 'id,name,thumbnailLink')
    .then(f => { if (f) meta.set(id, f); return f || null; })
    .catch(() => null)
    .finally(() => metaWait.delete(id));
  metaWait.set(id, p);
  return p;
}

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
}, { rootMargin: '200px 0px' });

/**
 * <img data-fid> 를 채운다.
 * 화면에 보이는 앞쪽 몇 장은 관찰을 기다리지 않고 바로 받는다 —
 * 첫 화면이 비어 보이는 것을 막는 데 이게 제일 크다.
 */
/*
 * 안 보이는 탭의 타일은 받지 않는다. 탭을 옮기면 그때 그 화면이 다시
 * 그려지면서 받는다.
 *
 * offsetParent 로 판단하면 안 된다. push() 는 화면을 다 만든 **뒤에** 문서에
 * 붙이기 때문에, 그 안에서 warm() 을 부르는 시점에는 아직 문서 밖이라
 * offsetParent 가 null 이다. 그래서 그룹 상세·일정·사진 상세의 썸네일이
 * 통째로 안 뜬다.
 *
 * 실제로 걸러야 하는 건 "display:none 인 탭 화면 안에 있는 것" 하나뿐이다.
 * 탭 화면 밖(푸시 화면, 시트)이거나 아직 문서에 안 붙었으면 그냥 받는다.
 */
function onScreen(img) {
  const sc = img.closest?.('.screen');
  return !sc || sc.classList.contains('on');
}

export function observe(img, eager = false) {
  if (off) return;
  const id = img.dataset.fid;
  if (!id) return;
  if (!onScreen(img)) return;
  const k = key(id, GRID);
  const hit = memGet(k);
  if (hit) { apply(img, hit, k); return; }
  if (eager) { fill(img); return; }
  io.observe(img);
}

/** 목록을 렌더한 직후 호출 — IDB 를 한 번에 읽어 보이는 부분을 즉시 채운다. */
export async function warm(imgs, eagerCount = 14) {
  if (off) return;
  const list = [...imgs].filter(onScreen);
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
  /* 나머지는 관찰에 맡긴다. rootMargin 이 200px 이라 실제로 화면 근처에
     올 때만 받는다 — 목록이 몇백 장이어도 동시에 도는 건 두 장뿐이다. */
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

/**
 * 드라이브에서 blob 자체를 받는다. 캐시에 넣지 않는다.
 *
 * allowOriginal 은 큰 미리보기에서만 켠다. 썸네일이 없는 파일을 그리드에서
 * 만나면 그냥 빈 타일로 두는 편이 낫다 — 원본은 장당 수 MB 라, 그런 파일이
 * 몇십 장만 섞여 있어도 미리 받기가 통째로 무너진다.
 */
async function rawBlob(id, size, allowOriginal = false) {
  return run(async () => {
    const f = await fileMeta(id);
    if (!f) return null;
    return thumbBlob(f, size, { allowOriginal });
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
  if (off) return null;
  const k = key(id, size);
  if (bigSlot && bigSlot.k === k) return bigSlot.url;

  let url;
  if (provider) {
    url = await provider(id, size);
    if (!url) return null;
  } else {
    // 상세 화면은 한 장뿐이니 썸네일이 없으면 원본을 받아도 된다
    const blob = await rawBlob(id, size, true);
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
  return rawBlob(id, size, true);
}

/* ---------- 미리 받기 ---------- */

/*
 * 썸네일을 IndexedDB 에만 채운다. 화면에 그리지 않고, blob URL 도 만들지
 * 않는다. 받은 blob 은 IDB 에 넣는 즉시 참조를 놓기 때문에 몇천 장을 돌려도
 * 메모리가 늘지 않는다 — 그리드를 쭉 스크롤하는 것과 결정적으로 다른 점이다.
 *
 * 한 장씩 순서대로 하지는 않는다. 그러면 몇천 장에 몇십 분이 걸린다.
 * 대신 작게 묶어(STEP) 처리하고 사이마다 한 박자 쉰다. 쉬는 동안 브라우저가
 * 화면을 갱신하고 정리할 틈이 생겨, 진행 표시가 멈추지 않고 탭도 안 죽는다.
 */
const STEP = 3;

let swept = false;

export async function prefetch(ids, { onProgress, shouldStop } = {}) {
  if (provider) return { done: 0, skipped: ids.length, failed: 0 };

  // 크기를 바꿨다면 예전 크기 썸네일이 남아 있다. 세션당 한 번 치운다.
  if (!swept) { swept = true; await store.dropOtherSizes(`@${GRID}`); }

  // 이미 있는 것은 건너뛴다. 두 번째 실행이 즉시 끝나는 이유다.
  const keys = ids.map(id => key(id, GRID));
  const have = await store.hasMany(keys);
  // meta 가 없어도 된다 — rawBlob 이 필요하면 그때 물어본다.
  const todo = ids.filter((id, i) => !have.has(keys[i]));

  const total = todo.length;
  let done = 0;
  let failed = 0;
  onProgress?.({ done, total, failed });

  for (let i = 0; i < todo.length; i += STEP) {
    if (shouldStop?.()) break;

    /* 앱이 백그라운드로 가면 멈춘다. 사파리는 안 보이는 탭의 메모리를 제일
       먼저 회수하는데, 그때 계속 받고 있으면 회수 대상 1순위가 된다.
       돌아오면 이어서 진행한다. */
    while (document.hidden && !shouldStop?.()) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (shouldStop?.()) break;
    const batch = todo.slice(i, i + STEP);
    await Promise.all(batch.map(async id => {
      try {
        const blob = await rawBlob(id, GRID);
        if (blob) await store.put(key(id, GRID), blob);
        else failed++;
      } catch {
        failed++;   // 한 장 실패로 전체를 멈추지 않는다
      } finally {
        done++;
      }
    }));
    onProgress?.({ done, total, failed });
    /* 브라우저에게 숨 돌릴 틈을 준다. 100장마다 한 번은 길게 쉰다 —
       사파리가 메모리를 정리할 시간을 주는 것이 목적이다. */
    await new Promise(r => setTimeout(r, done % 100 < STEP ? 400 : 60));
  }

  return { done, total, failed, skipped: ids.length - total };
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
