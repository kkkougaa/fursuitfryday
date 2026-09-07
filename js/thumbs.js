/* thumbs.js — 썸네일 지연 로딩 + 영구 캐시
 *
 * 3단 캐시
 *   1) 메모리 (blob URL)      — 같은 화면 안에서 즉시
 *   2) IndexedDB (blob)       — 앱을 다시 열어도 즉시. 400px 그리드 썸네일만.
 *   3) 드라이브 thumbnailLink — 처음 한 번
 *
 * thumbnailLink 는 수명이 짧아 catalog 에 저장하지 않는다. 대신 받아온
 * 이미지 자체를 IDB 에 남긴다.
 */
import { pool } from './auth.js';
import { thumbBlob } from './drive.js';
import * as store from './thumbcache.js';

const GRID = 400;

const mem = new Map();    // key → blob URL
const meta = new Map();   // fileId → drive file
const run = pool(8);
const inflight = new Map();

let provider = null;      // 데모 모드용 — 드라이브 대신 로컬 생성
export function setProvider(fn) { provider = fn; }

export function remember(files) {
  for (const f of files) meta.set(f.id, f);
}
export const known = id => meta.has(id);

const key = (id, size) => `${id}@${size}`;

const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    fill(e.target);
  }
}, { rootMargin: '900px 0px' });   // 넉넉히 앞서 받아둔다

/**
 * <img data-fid> 를 채운다.
 * 화면에 보이는 앞쪽 몇 장은 관찰을 기다리지 않고 바로 받는다 —
 * 첫 화면이 비어 보이는 것을 막는 데 이게 제일 크다.
 */
export function observe(img, eager = false) {
  const id = img.dataset.fid;
  if (!id) return;
  const k = key(id, GRID);
  if (mem.has(k)) { apply(img, mem.get(k)); return; }
  if (eager) { fill(img); return; }
  io.observe(img);
}

/** 목록을 렌더한 직후 호출 — IDB 를 한 번에 읽어 보이는 부분을 즉시 채운다. */
export async function warm(imgs, eagerCount = 24) {
  const list = [...imgs];
  const ids = list.map(i => i.dataset.fid).filter(Boolean);
  if (!ids.length) return;

  if (!provider) {
    const hit = await store.getMany(ids.map(id => key(id, GRID)));
    for (const img of list) {
      const k = key(img.dataset.fid, GRID);
      const blob = hit.get(k);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      mem.set(k, url);
      apply(img, url);
    }
  }
  list.forEach((img, i) => { if (!img.classList.contains('ready')) observe(img, i < eagerCount); });
}

async function fill(img) {
  const id = img.dataset.fid;
  const k = key(id, GRID);
  if (mem.has(k)) return apply(img, mem.get(k));
  try {
    const url = await load(id, GRID);
    if (url) apply(img, url);
  } catch { /* 조용히 빈 타일로 남긴다 */ }
}

async function load(id, size) {
  const k = key(id, size);
  if (mem.has(k)) return mem.get(k);
  if (inflight.has(k)) return inflight.get(k);

  const p = (async () => {
    if (provider) {
      const url = await provider(id, size);
      if (url) mem.set(k, url);
      return url;
    }
    // IDB 먼저
    if (size === GRID) {
      const cached = await store.get(k);
      if (cached) {
        const url = URL.createObjectURL(cached);
        mem.set(k, url);
        return url;
      }
    }
    const f = meta.get(id);
    if (!f) return null;
    const blob = await run(() => thumbBlobRaw(f, size));
    const url = URL.createObjectURL(blob);
    mem.set(k, url);
    if (size === GRID) store.put(k, blob);
    return url;
  })().finally(() => inflight.delete(k));

  inflight.set(k, p);
  return p;
}

/** drive.thumbBlob 은 blob URL 을 주므로, 캐시에 넣을 수 있게 blob 자체를 받는다. */
async function thumbBlobRaw(f, size) {
  const url = await thumbBlob(f, size);
  const blob = await (await fetch(url)).blob();
  URL.revokeObjectURL(url);
  return blob;
}

function apply(img, url) {
  if (img.src === url) return;
  img.src = url;
  if (img.complete) img.classList.add('ready');
  else img.addEventListener('load', () => img.classList.add('ready'), { once: true });
}

/** 큰 미리보기 (사진 상세·복사 시트) — 메모리에만 둔다. */
export function big(id, size = 1200) {
  return load(id, size);
}

/** 원본 사진 blob — 복사할 때 쓴다. */
export async function blobOf(id, size = 1600) {
  const url = await load(id, size);
  if (!url) return null;
  return (await fetch(url)).blob();
}

export async function cacheInfo() {
  return { entries: await store.count() };
}
export async function clearCache() {
  for (const url of mem.values()) URL.revokeObjectURL(url);
  mem.clear();
  await store.clear();
}
export const prune = store.prune;
