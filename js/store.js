/* store.js — catalog.json 스키마와 상태
 *
 * 진실의 원천은 드라이브에 있는 cutdaejang.catalog.json 하나.
 * 사진의 키는 Drive fileId, 보조 키는 md5Checksum.
 *   → 작가가 파일명을 바꾸거나 폴더를 옮겨도 태그가 살아남고,
 *     지웠다 다시 올려 fileId 가 바뀌어도 md5 로 옛 기록에 다시 붙는다.
 *
 * 비밀(unavatar 키)은 여기 넣지 않는다. 동기화되는 파일에 비밀을 두지 않는다.
 */
import * as drive from './drive.js';

export const SCHEMA = 4;

/** 앱 전체 액센트 후보. app.css 의 [data-accent] 블록과 짝이 맞다. */
export const ACCENTS = [
  { k: 'blue', name: '파랑' },
  { k: 'teal', name: '청록' },
  { k: 'green', name: '초록' },
  { k: 'purple', name: '보라' },
  { k: 'pink', name: '분홍' },
  { k: 'red', name: '빨강' },
  { k: 'amber', name: '호박' },
  { k: 'ink', name: '먹색' },
];

/** 앱 전체 액센트를 문서에 적용한다. 색 정의는 CSS 가 갖고 있다. */
export function applyAccent(k) {
  const key = ACCENTS.some(a => a.k === k) ? k : 'blue';
  document.documentElement.setAttribute('data-accent', key);
  // 주소창·상태바 색도 맞춰 준다
  requestAnimationFrame(() => {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => { if (!m.media) m.content = c; });
  });
}

/** 행사 카테고리 색상 키. CSS 의 --c-* 토큰과 짝이 맞다. */
export const CAT_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink', 'gray'];

export function emptyCatalog() {
  return {
    v: SCHEMA,
    syncedAt: null,
    me: { nick: '', x: null, avatar: null },   // 내 프로필
    folders: [],            // [{id,name}]
    /* 행사는 사진 분류 축과 일정을 겸한다 — 같은 행사를 두 군데에 따로 적을 이유가 없다.
       date=시작일, endDate=종료일(여러 날 묶는 컨벤션). 하루면 endDate 는 null.
       going=참가 확정 여부. false 면 "미정" 으로, 홈 디데이를 차지하지 않는다.
       sub=행사 안의 약속 [{id,day,time,title,place,note}].
       logo 는 128px WebP base64. 정하지 않으면 목록에서 대표 사진을 쓴다.
       [{id,name,date,endDate,going,place,note,logo,tags[],sub[],prep[...],packed[...]}] */
    events: [],
    eventTags: [],          // 행사 카테고리 [{name,color}]. 사진 태그(tags)와 별개.
    /* 짐 챙기기 공용 목록. 설정에서 관리하고 체크는 행사별(events[].packed)로 따로 남는다. */
    packing: [
      { id: 'pk1', text: '슈트 본체' },
      { id: 'pk2', text: '헤드' },
      { id: 'pk3', text: '핸드포 · 풋포' },
      { id: 'pk4', text: '쿨링 조끼 · 아이스팩' },
      { id: 'pk5', text: '얼음물 · 이온 음료' },
      { id: 'pk6', text: '여분 티셔츠 · 수건' },
      { id: 'pk7', text: '탈취 스프레이' },
      { id: 'pk8', text: '보조배터리' },
    ],
    shooters: [],           // [{id,name,x,avatar}]   x = X 핸들, avatar = base64 96px
    people: [],             // 같이 찍은 퍼슈트 [{id,name,role,x,avatar}]
    tags: [],               // 자유 태그. 설정에서 직접 만든 것만 들어간다.
    opts: {
      eventTag: true,
      tags: [],
      prefix: '#',
      emoji: '📷',
      homeTitle: '#FursuitFryday🍤',
      homeTab: '',   // 비우면 homeTitle 을 쓴다. 탭이 좁을 때 짧게 따로 정하는 칸.
      accent: 'blue', // 앱 전체 액센트. app.css 의 [data-accent] 블록과 짝.
      friday: true,   // 금요일 홈 상단 FursuitFriday 블록
    },
    rules: { camera: {} },  // { "Sony α7 IV": shooterId }  — 사용자가 "앞으로 자동" 을 켠 것만
    dismissed: [],          // 다시 띄우지 않을 제안 키
    photos: {},             // { fileId: Photo }
    gone: {},               // { fileId: Photo }  드라이브에서 사라졌지만 기록은 보존
  };
}

/* Photo = {
 *   md5, name, w, h, shotAt, cameraModel, lens, exposure, iso, size,
 *   event, shooter, people[], tags[], usages[{ch,url,date}]
 * } */

export const S = {
  cat: emptyCatalog(),
  demo: false,          // ?demo=1 — 드라이브를 건드리지 않는다
  catFileId: null,
  catVersion: null,
  dirty: false,
  saving: false,
  lastSaveAt: null,
  conflict: false,
};

/* ---------- 로드 / 저장 ---------- */

export async function load() {
  const f = await drive.findCatalog();
  if (!f) {
    S.catFileId = null;
    S.cat = emptyCatalog();
    return { created: false, found: false };
  }
  S.catFileId = f.id;
  S.catVersion = f.version;
  const raw = await drive.readCatalog(f.id);
  S.cat = migrate(raw);
  return { found: true };
}

function migrate(raw) {
  const base = emptyCatalog();
  const c = { ...base, ...raw };
  c.opts = { ...base.opts, ...(raw.opts || {}) };
  c.rules = { camera: {}, ...(raw.rules || {}) };
  c.me = { ...base.me, ...(raw.me || {}) };
  for (const k of ['folders', 'events', 'shooters', 'people', 'tags', 'dismissed', 'eventTags', 'packing']) {
    if (!Array.isArray(c[k])) c[k] = base[k];
  }
  // 예전 스키마의 행사에 일정 필드를 채워준다
  c.events = c.events.map(e => ({
    place: null, note: null, logo: null, icon: null, endDate: null, going: true,
    tags: [], sub: [], prep: [], packed: [], ...e,
    tags: Array.isArray(e.tags) ? e.tags : [],
    sub: Array.isArray(e.sub) ? e.sub : [],
    prep: Array.isArray(e.prep) ? e.prep : [],
    packed: Array.isArray(e.packed) ? e.packed : [],
    // 종료일이 시작일보다 앞이면 무시한다
    endDate: e.endDate && e.date && e.endDate > e.date ? e.endDate : null,
    going: e.going !== false,
  }));
  // 카테고리: 문자열 목록이던 것을 {name,color} 로 올린다
  c.eventTags = c.eventTags.map(t => (typeof t === 'string'
    ? { name: t, color: 'gray' }
    : { name: t.name, color: CAT_COLORS.includes(t.color) ? t.color : 'gray' }));
  c.photos = c.photos || {};
  c.gone = c.gone || {};
  c.v = SCHEMA;
  return c;
}

let timer = null;
let waiters = [];

/** 화면 조작은 메모리에 즉시 반영하고, 저장은 묶어서 한 번. */
export function touch() {
  S.dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => { flush(); }, 2500);
  return S.cat;
}

export function onSaved(fn) { waiters.push(fn); }
const emit = () => waiters.forEach(f => f());

export async function flush() {
  clearTimeout(timer);
  if (!S.dirty || S.saving) return;
  if (S.demo) {
    // 데모도 저장은 해준다 — 리로드 때마다 만든 게 날아가면 볼 수가 없다.
    try { localStorage.setItem('cd.demo.cat', JSON.stringify(S.cat)); } catch { /* 용량 초과 */ }
    S.dirty = false; S.lastSaveAt = Date.now(); emit(); return;
  }
  S.saving = true;
  emit();
  try {
    if (!S.catFileId) {
      const r = await drive.createCatalog(S.cat);
      S.catFileId = r.id;
      S.catVersion = r.version;
    } else {
      const r = await drive.writeCatalog(S.catFileId, S.cat, S.catVersion);
      S.catVersion = r.version;
    }
    S.dirty = false;
    S.conflict = false;
    S.lastSaveAt = Date.now();
  } catch (e) {
    if (e.conflict) {
      await mergeFromServer();
    } else {
      throw e;
    }
  } finally {
    S.saving = false;
    emit();
  }
}

/** 다른 기기가 먼저 저장한 경우: 서버본을 읽어 내 변경을 얹고 다시 쓴다. */
async function mergeFromServer() {
  const server = migrate(await drive.readCatalog(S.catFileId));
  const mine = S.cat;

  // 사진: 필드 단위로 병합. 사용 이력은 URL 기준 합집합(기록은 지우지 않는다).
  for (const [id, sp] of Object.entries(server.photos)) {
    const mp = mine.photos[id];
    if (!mp) { mine.photos[id] = sp; continue; }
    mp.event ??= sp.event;
    mp.shooter ??= sp.shooter;
    mp.people = [...new Set([...(mp.people || []), ...(sp.people || [])])];
    mp.tags = [...new Set([...(mp.tags || []), ...(sp.tags || [])])];
    const seen = new Set((mp.usages || []).map(u => u.url));
    mp.usages = [...(mp.usages || []), ...(sp.usages || []).filter(u => !seen.has(u.url))];
  }
  // 마스터 목록: 이름 기준 합집합
  mine.events = unionBy([...server.events, ...mine.events], e => e.id);
  // 카테고리는 객체라 Set 으로 중복이 안 걸러진다. 이름 기준으로 합치고 내 색을 살린다.
  mine.eventTags = unionBy([...(server.eventTags || []), ...(mine.eventTags || [])], t => t.name);
  mine.packing = unionBy([...(server.packing || []), ...(mine.packing || [])], x => x.id);
  mine.shooters = unionBy([...server.shooters, ...mine.shooters], s => s.id);
  mine.people = unionBy([...server.people, ...mine.people], p => p.id);
  mine.tags = [...new Set([...server.tags, ...mine.tags])];
  mine.dismissed = [...new Set([...server.dismissed, ...mine.dismissed])];
  mine.gone = { ...server.gone, ...mine.gone };

  const cur = await drive.getFile(S.catFileId, 'version');
  S.catVersion = cur.version;
  const r = await drive.writeCatalog(S.catFileId, mine, S.catVersion);
  S.catVersion = r.version;
  S.dirty = false;
  S.lastSaveAt = Date.now();
}

function unionBy(arr, key) {
  const m = new Map();
  arr.forEach(x => m.set(key(x), { ...(m.get(key(x)) || {}), ...x }));
  return [...m.values()];
}

/* ---------- 동기화 (드라이브 → catalog 한 방향 대조) ---------- */

export function syncFiles(files) {
  const cat = S.cat;
  const byMd5 = new Map();
  for (const [id, p] of Object.entries(cat.photos)) if (p.md5) byMd5.set(p.md5, { id, p });
  for (const [id, p] of Object.entries(cat.gone)) if (p.md5) byMd5.set(p.md5, { id, p, wasGone: true });

  const live = new Set();
  const added = [];

  for (const f of files) {
    live.add(f.id);
    if (cat.photos[f.id]) { refresh(cat.photos[f.id], f); continue; }

    // 재업로드 복원: md5 가 같은 옛 기록이 있으면 태그·사용 이력을 그대로 승계
    const prev = f.md5Checksum && byMd5.get(f.md5Checksum);
    if (prev) {
      cat.photos[f.id] = refresh({ ...prev.p }, f);
      delete cat.photos[prev.id];
      delete cat.gone[prev.id];
      continue;
    }
    cat.photos[f.id] = refresh(newPhoto(), f);
    added.push(f.id);
  }

  // catalog 에만 있는 것 → 사라진 것. 기록은 지우지 않고 gone 으로 옮긴다.
  const vanished = [];
  for (const id of Object.keys(cat.photos)) {
    if (live.has(id)) continue;
    cat.gone[id] = cat.photos[id];
    delete cat.photos[id];
    vanished.push(id);
  }
  // 돌아온 것 정리
  for (const id of Object.keys(cat.gone)) if (live.has(id)) delete cat.gone[id];

  cat.syncedAt = new Date().toISOString();
  touch();

  const vanishedUsed = vanished.filter(id => (cat.gone[id]?.usages || []).length);
  return { total: files.length, added: added.length, addedIds: added, vanished: vanished.length, vanishedUsed };
}

function newPhoto() {
  return { event: null, shooter: null, people: [], tags: [], usages: [] };
}

function refresh(p, f) {
  const m = f.imageMediaMetadata || {};
  p.md5 = f.md5Checksum || p.md5 || null;
  p.name = f.name;
  p.size = Number(f.size) || null;
  p.w = m.width || null;
  p.h = m.height || null;
  p.shotAt = exifTime(m.time) || f.createdTime || null;
  p.cameraModel = [m.cameraMake, m.cameraModel].filter(Boolean).join(' ').trim() || null;
  p.lens = m.lens || null;
  p.iso = m.isoSpeed || null;
  p.exposure = fmtExposure(m.exposureTime, m.aperture);
  p.event ??= null;
  p.shooter ??= null;
  p.people ||= [];
  p.tags ||= [];
  p.usages ||= [];
  return p;
}

/** EXIF time 은 "2026:05:22 16:11:52" — 타임존이 없다. 로컬 시간으로만 취급한다. */
function exifTime(s) {
  if (!s) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

/** exposureTime 0.008 → "1/125", aperture 2.8 → "f/2.8" */
function fmtExposure(t, ap) {
  const parts = [];
  if (t) parts.push(t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`);
  if (ap) parts.push(`f/${ap}`);
  return parts.join(' · ') || null;
}

/* ---------- 조회 헬퍼 ---------- */

export const photos = () => Object.entries(S.cat.photos).map(([id, p]) => ({ id, ...p }));
export const isUsed = p => (p.usages || []).length > 0;
export const isUnfiled = p => !p.event || !p.shooter;
export const shooterById = id => S.cat.shooters.find(s => s.id === id) || null;
export const eventById = id => S.cat.events.find(e => e.id === id) || null;
export const personById = id => S.cat.people.find(p => p.id === id) || null;

export function uid(prefix) {
  return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
}

export function addEvent(name, date, place, opts = {}) {
  const end = opts.endDate && date && opts.endDate > date ? opts.endDate : null;
  const e = {
    id: uid('e'), name: name.trim(), date: date || null, endDate: end,
    going: opts.going !== false,
    place: (place || '').trim() || null, note: opts.note || null, logo: null,
    tags: [], sub: [], prep: [], packed: [],
  };
  S.cat.events.push(e); touch(); return e;
}
export const UNKNOWN_SHOOTER = 's-unknown';

/** "사진사 미상" 은 미지정과 다르다 — 알아본 뒤 모른다고 결론 낸 상태다.
 *  실제 사진사 항목으로 두어 필터·집계가 자연스럽게 되게 하고,
 *  카메라→사진사 제안과 크레딧 복사에서는 제외한다. */
export function unknownShooter() {
  let s = S.cat.shooters.find(x => x.id === UNKNOWN_SHOOTER);
  if (!s) {
    s = { id: UNKNOWN_SHOOTER, name: '사진사 미상', x: null, avatar: null, unknown: true };
    S.cat.shooters.push(s);
    touch();
  }
  return s;
}

export function addShooter(name, x) {
  const s = { id: uid('s'), name: name.trim(), x: normX(x), avatar: null };
  S.cat.shooters.push(s); touch(); return s;
}
export function addPerson(name, role, x) {
  const p = { id: uid('p'), name: name.trim(), role: (role || '').trim() || null, x: normX(x), avatar: null };
  S.cat.people.push(p); touch(); return p;
}

/** "@handle", "x.com/handle", "https://twitter.com/handle" → "handle" */
export function normX(v) {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '');
  s = s.replace(/^@/, '').replace(/[/?#].*$/, '').trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

/* ---------- 복사 텍스트 ---------- */

export function catColor(name) {
  const t = S.cat.eventTags.find(x => x.name === name);
  return t ? t.color : 'gray';
}

export function hashtagify(s) {
  return '#' + String(s).replace(/[\s·・.,'"“”‘’!?()[\]{}/\\|:;~\-–—]/g, '');
}

export function copyTextFor(p) {
  const { opts } = S.cat;
  const tags = [];
  const ev = p.event && eventById(p.event);
  if (opts.eventTag && ev) tags.push(hashtagify(ev.name));
  tags.push(...(opts.tags || []));
  const sh = p.shooter && shooterById(p.shooter);
  const credit = sh?.x ? `${opts.emoji} ${opts.prefix}${sh.x}` : '';
  return [tags.join(' '), credit].filter(Boolean).join('\n\n');
}

export function channelOf(url) {
  const s = String(url).toLowerCase();
  if (/instagram\.com/.test(s)) return 'instagram';
  if (/(^|\/\/|\.)(x|twitter)\.com/.test(s)) return 'x';
  if (/blog\.naver\.com|tistory\.com|brunch\.co\.kr|velog\.io/.test(s)) return 'blog';
  if (/linkedin\.com/.test(s)) return 'linkedin';
  if (/threads\.(com|net)/.test(s)) return 'threads';
  return null;
}
