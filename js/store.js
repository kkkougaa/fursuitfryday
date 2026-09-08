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
import { t } from './i18n.js';

/* 5 에서 사진에 plannedAt(업로드 예정 표시 시각)이 붙었다. 없어도 되는 필드라
   옛 catalog 를 그대로 읽어도 문제없다 — 표시가 없는 것으로 취급된다. */
export const SCHEMA = 5;

/** 앱 전체 액센트 후보. app.css 의 [data-accent] 블록과 짝이 맞다. */
/* 이름은 여기 박지 않는다 — 모듈이 한 번만 평가되므로 언어를 바꿔도
   그때 담긴 이름이 그대로 남는다. 쓸 때 accentName(k) 로 꺼낸다. */
export const ACCENTS = [
  { k: 'blue' }, { k: 'teal' }, { k: 'green' }, { k: 'purple' },
  { k: 'pink' }, { k: 'red' }, { k: 'amber' }, { k: 'ink' },
];

export const accentName = k => t('accent.' + k);

/* ---------- 색 계산 (커스텀 테마용) ----------
 * 미리 정해 둔 여덟 색은 app.css 가 --blue / --blue-press / --blue-fill /
 * --on-blue 를 짝지어 갖고 있다. 커스텀 색은 하나만 받으니 나머지 셋을
 * 여기서 만들어야 한다. 손으로 정한 값과 결이 같도록 맞췄다
 * (blue #3182F6 -> press #2272EB, fill #EBF3FE, on #FFFFFF).
 */
export function parseHex(v) {
  if (typeof v !== 'string') return null;
  let h = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return '#' + h.toUpperCase();
}
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hexOf = ([r, g, b]) => '#' + [r, g, b]
  .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
  .join('').toUpperCase();

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const l = (mx + mn) / 2;
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
}
function fromHsl([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hexOf(t.map(v => (v + m) * 255));
}
/* 상대 휘도 (WCAG). 흰 글자를 얹을 수 있는지 판단한다. */
function lum(rgb) {
  const [r, g, b] = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** 커스텀 색 하나에서 짝이 되는 네 값을 만든다. */
export function accentVars(hex, dark) {
  const rgb = rgbOf(hex);
  const [h, sat, l] = toHsl(rgb);
  /* 글자색: **흰색을 기본으로** 하고 너무 밝은 색에서만 뒤집는다.
     대비를 최대화하면 안 된다 — #3182F6 은 흰 글자 3.72 대 검은 글자 5.00
     이지만 이 앱은 흰 글자를 쓴다. 미리 정해 둔 여덟 색 모두 --on-blue 가
     흰색이고, 그중 가장 밝은 앰버(#E58A00)가 2.63 이다. 그래서 문턱을
     2.4 로 두면 여덟 색 전부 흰 글자가 되고, 노랑처럼 더 밝은 색만
     어두운 글자로 뒤집힌다(그때 설정 화면이 알려 준다). */
  const on = contrast(rgb, [255, 255, 255]) >= 2.4 ? '#FFFFFF' : '#101318';
  return {
    '--blue': hex,
    // 누른 상태 — 밝기만 조금 낮춘다
    '--blue-press': fromHsl([h, sat, Math.max(0, l - 0.05)]),
    // 옅은 배경 — 라이트는 아주 밝게, 다크는 아주 어둡게
    '--blue-fill': dark
      ? fromHsl([h, Math.min(sat, 0.34), 0.16])
      : fromHsl([h, Math.min(sat, 0.92), 0.96]),
    '--on-blue': on,
  };
}

const isDark = () => {
  try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
};

/**
 * 앱 전체 액센트를 문서에 적용한다.
 * 미리 정해 둔 색은 CSS 가 갖고 있고(data-accent), 커스텀 색은 여기서
 * 계산해 인라인으로 얹는다. hex 를 주면 그것이 이긴다.
 */
export function applyAccent(k, hex) {
  const cust = parseHex(hex !== undefined ? hex : S.cat?.opts?.accentHex);
  const custom = k === 'custom' && cust;
  const key = custom ? 'custom' : (ACCENTS.some(a => a.k === k) ? k : 'blue');
  document.documentElement.setAttribute('data-accent', key);

  /* 커스텀일 때만 인라인 변수를 얹는다. 미리 정해 둔 색으로 돌아가면
     반드시 걷어야 한다 — 남겨 두면 CSS 값을 계속 덮어쓴다. */
  const st = document.documentElement.style;
  const vars = ['--blue', '--blue-press', '--blue-fill', '--on-blue'];
  if (custom) {
    const v = accentVars(cust, isDark());
    vars.forEach(n => st.setProperty(n, v[n]));
  } else {
    vars.forEach(n => st.removeProperty(n));
  }
  /* 예전에는 이 아래가 requestAnimationFrame 안에 있었다. 그러면 **숨은
     탭에서는 아예 돌지 않는다** — rAF 는 그리지 않는 문서에서 멈춘다.
     배경 탭에서 앱을 열어 두면 상태바 색도 스플래시 색도 저장되지 않았다.
     getComputedStyle 은 방금 바꾼 속성을 반영해 동기로 계산해 주므로
     기다릴 이유가 없다. */
  const cs = getComputedStyle(document.documentElement);
  // 주소창·상태바 색은 **본문 배경**을 따른다 (액센트가 아니다)
  const bg = cs.getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { if (!m.media) m.content = bg; });
  /* 스플래시가 쓸 색을 남긴다. **이름이 아니라 계산된 색값**을 남기는
     이유: 그래야 스플래시가 팔레트를 몰라도 되고, 커스텀 색도 그대로
     따라온다. index.html 의 부팅 스크립트가 이 값을 읽는다. */
  const blue = cs.getPropertyValue('--blue').trim();
  try {
    if (/^#[0-9a-f]{3,8}$/i.test(blue)) localStorage.setItem('cd.bootbg', blue);
  } catch (e) { /* 무시해도 된다 */ }
}

/* 커스텀 색은 인라인 변수라 CSS 미디어 쿼리가 안 먹는다. 시스템 테마가
   바뀌면 --blue-fill 을 다시 계산해 줘야 한다(옅은 배경의 명암이 뒤집힌다). */
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (S.cat?.opts?.accent === 'custom') applyAccent('custom');
  });
} catch (e) { /* 지원 안 하면 그냥 넘어간다 */ }

/** 행사 카테고리 색상 키. CSS 의 --c-* 토큰과 짝이 맞다. */
export const CAT_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink', 'gray'];

export function emptyCatalog() {
  return {
    v: SCHEMA,
    syncedAt: null,
    lastBackup: null,       // 마지막으로 사본을 남긴 날(YYYY-MM-DD)
    me: { nick: '', x: null, avatar: null },   // 내 프로필
    folders: [],            // [{id,name}]  — 사용자가 고른 루트
    /* 동기화 때 만난 하위 폴더들. { id: {name, parent} }
       "폴더 이름 = 행사 이름" 으로 정리해 둔 사람에게 분류를 제안하는 데 쓴다.
       사진 자체는 p.folder 로 자기 폴더를 가리킨다. */
    folderTree: {},
    /* 행사는 사진 분류 축과 일정을 겸한다 — 같은 행사를 두 군데에 따로 적을 이유가 없다.
       date=시작일, endDate=종료일(여러 날 묶는 컨벤션). 하루면 endDate 는 null.
       going=참가 확정 여부. false 면 "미정" 으로, 홈 디데이를 차지하지 않는다.
       sub=행사 안의 약속 [{id,day,time,title,place,note}].
       logo 는 128px WebP base64. 정하지 않으면 목록에서 대표 사진을 쓴다.
       suits=그 행사에 데려간 내 퍼슈트 [suitId]. 착용 횟수의 근거가 된다.
       [{id,name,date,endDate,going,place,note,logo,tags[],sub[],prep[...],packed[...],suits[]}] */
    events: [],
    eventTags: [],          // 행사 카테고리 [{name,color}]. 사진 태그(tags)와 별개.
    /* 행사에 묶이지 않는 할 일. 행사별 체크리스트(events[].prep)와 같은
       화면에 나란히 둔다 — 두 곳으로 갈리면 어디 적었는지 매번 헤맨다.
       [{id,text,done,at}] */
    todos: [],
    /* 짐 챙기기 공용 목록. 설정에서 관리하고 체크는 행사별(events[].packed)로 따로 남는다. */
    packing: [
      { id: 'pk1', text: t('pack.suit') },
      { id: 'pk2', text: t('pack.head') },
      { id: 'pk3', text: t('pack.paws') },
      { id: 'pk4', text: t('pack.cooling') },
      { id: 'pk5', text: t('pack.drink') },
      { id: 'pk6', text: t('pack.shirt') },
      { id: 'pk7', text: t('pack.spray') },
      { id: 'pk8', text: t('pack.battery') },
    ],
    /* 지운 것의 열쇠를 남긴다(묘비).
       병합이 서버본과 합집합이라 삭제를 표현할 방법이 없었다 — 다른 기기의
       서버본에 남아 있던 행사·짐 항목이 동기화 때마다 되살아났다.
       여기 적힌 것은 병합에서 걷어낸다. */
    deleted: { events: [], packing: [], eventTags: [], tags: [], suits: [], careTags: [], todos: [] },
    shooters: [],           // [{id,name,x,avatar}]   x = X 핸들, avatar = base64 96px
    people: [],             // 같이 찍은 퍼슈트 [{id,name,role,x,avatar}]
    /* 내 퍼슈트. 캐릭터로서의 정보(이름·핸들·대표 사진)와 물건으로서의
       기록(메이커·데뷔일·관리)을 한 곳에 둔다.
       personId 는 people[] 의 짝을 가리킨다 — 사진에 붙는 것은 그쪽이다.
       log 는 관리 기록과 할 일을 겸한다: doneAt 이 없으면 아직 안 한 것.
       avatar 는 대표 사진 겸 아바타다 — 핸들로 자동 수집한 것과 사진에서
       직접 고른 것이 같은 자리에 들어간다(96px WebP base64).
       [{id,name,x,avatar,maker,debutAt,birthday,personId,
         memo,retiredAt,log:[{id,kinds[],note,at,doneAt}]}] */
    suits: [],
    /* 관리 태그 [{name,color}]. 여기서 기본값을 깐다 —
       데모와 신규 사용자는 migrate() 를 타지 않는다. */
    careTags: defaultCareTags(),
    tags: [],               // 자유 태그. 설정에서 직접 만든 것만 들어간다.
    opts: {
      eventTag: true,
      tags: [],
      prefix: '#',
      emoji: '📷',
      homeTitle: '#FursuitFryday🍤',
      homeTab: '',   // 비우면 homeTitle 을 쓴다. 탭이 좁을 때 짧게 따로 정하는 칸.
      accent: 'blue', // 앱 전체 액센트. app.css 의 [data-accent] 블록과 짝.
      accentHex: '',  // accent 가 'custom' 일 때 쓰는 색. 예: '#FF6B9D'
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
 *   event, shooter, people[], tags[], usages[{ch,url,date}],
 *   plannedAt        // "업로드 예정" 표시 시각(ISO). null 이면 표시 없음.
 * }
 *
 * plannedAt 을 불리언이 아니라 시각으로 둔 이유: 언제 담았는지가 정렬과
 * "담아두고 3주째 안 올린 사진" 같은 판단에 쓰인다. 불리언이면 나중에
 * 그 정보를 되살릴 방법이 없다. */

export const S = {
  cat: emptyCatalog(),
  demo: false,          // ?demo=1 — 드라이브를 건드리지 않는다
  catFileId: null,
  catVersion: null,
  dirty: false,
  saving: false,
  lastSaveAt: null,
  conflict: false,
  saveError: null,      // 마지막 저장 실패. 성공하면 비운다.
  recovered: null,      // 부팅 때 로컬에서 되살린 변경이 있었던 시각
};

/* ---------- 로드 / 저장 ---------- */

export async function load() {
  const f = await drive.findCatalog();
  if (!f) {
    S.catFileId = null;
    S.cat = emptyCatalog();
    pCache = null;
    return { created: false, found: false };
  }
  S.catFileId = f.id;
  S.catVersion = f.version;
  const raw = await drive.readCatalog(f.id);
  S.cat = migrate(raw);
  pCache = null;

  /* 지난번에 드라이브로 못 올린 변경이 기기에 남아 있으면 얹는다.
     로컬을 **먼저** 읽지 않는 이유: 폰과 PC 를 같이 쓰면 옛 로컬이 다른
     기기의 최신 변경을 통째로 덮는다. 드라이브를 읽고, 못 올린 것만
     충돌 병합과 같은 규칙으로 얹는다. */
  const pend = pendingLocal();
  if (pend) {
    const server = S.cat;
    S.cat = migrate(pend.cat);
    mergeInto(S.cat, server);
    S.dirty = true;
    S.recovered = pend.at;      // 화면에서 알려 줄 수 있게 남긴다
    schedule(800);              // 곧 올린다
  }
  return { found: true, recovered: pend ? pend.at : null };
}

function migrate(raw) {
  const base = emptyCatalog();
  const c = { ...base, ...raw };
  c.opts = { ...base.opts, ...(raw.opts || {}) };
  c.rules = { camera: {}, ...(raw.rules || {}) };
  c.me = { ...base.me, ...(raw.me || {}) };
  for (const k of ['folders', 'events', 'shooters', 'people', 'tags', 'dismissed',
    'eventTags', 'packing', 'suits', 'todos']) {
    if (!Array.isArray(c[k])) c[k] = base[k];
  }
  if (!c.folderTree || typeof c.folderTree !== 'object') c.folderTree = {};
  // 묘비: 예전 카탈로그에는 없던 필드라 모양을 맞춰 준다
  c.deleted = { ...base.deleted, ...(raw.deleted || {}) };
  for (const k of Object.keys(base.deleted)) {
    if (!Array.isArray(c.deleted[k])) c.deleted[k] = [];
  }
  // 예전 스키마의 행사에 일정 필드를 채워준다
  c.events = c.events.map(e => ({
    place: null, note: null, logo: null, icon: null, endDate: null, going: true,
    tags: [], sub: [], prep: [], packed: [], suits: [], ...e,
    suits: Array.isArray(e.suits) ? e.suits : [],
    tags: Array.isArray(e.tags) ? e.tags : [],
    sub: Array.isArray(e.sub) ? e.sub : [],
    /* 사전 준비 항목의 pin: 할 일 목록에도 띄울지. 예전 카탈로그엔 없다. */
    prep: (Array.isArray(e.prep) ? e.prep : []).map(x => ({ pin: false, ...x })),
    packed: Array.isArray(e.packed) ? e.packed : [],
    // 종료일이 시작일보다 앞이면 무시한다
    endDate: e.endDate && e.date && e.endDate > e.date ? e.endDate : null,
    going: e.going !== false,
  }));
  // 슈트: 예전 카탈로그에는 없던 필드라 모양을 맞춰 준다
  c.suits = c.suits.map(x => ({
    x: null, avatar: null, maker: null,
    debutAt: null, birthday: null, personId: null, memo: null, retiredAt: null,
    ...x,
    log: (Array.isArray(x.log) ? x.log : []).map(l => ({
      kinds: Array.isArray(l.kinds) ? l.kinds : [], note: null, doneAt: null, ...l,
    })),
  }));
  /* 태그를 전부 지운 것과 "예전 카탈로그라 필드가 없는 것" 은 다르다.
     빈 배열일 때 다시 깔면 지운 사람의 것이 열 때마다 되살아난다. */
  if (!Array.isArray(raw.careTags)) c.careTags = defaultCareTags();
  c.careTags = c.careTags.map(x => (typeof x === 'string'
    ? { name: x, color: 'gray' }
    : { name: x.name, color: CAT_COLORS.includes(x.color) ? x.color : 'gray' }));

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
  pCache = null;          // 사진이 바뀌었으니 캐시를 버린다
  /* 드라이브로 가기 전에 기기에 먼저 남긴다. 여기서 앱이 죽어도
     다음에 열 때 되살릴 수 있다. */
  saveLocal();
  schedule(2500);
  return S.cat;
}

/** 삭제를 묘비에 적는다. 병합에서 이 열쇠는 서버본에서 걷어낸다. */
export function markDeleted(kind, key) {
  const d = (S.cat.deleted ||= { events: [], packing: [], eventTags: [], tags: [], suits: [], careTags: [], todos: [] });
  d[kind] = d[kind] || [];
  if (!d[kind].includes(key)) d[kind].push(key);
}

/** 되돌릴 수 없는 변경(삭제)은 미루지 않고 바로 쓴다.
 *  touch() 는 2.5초 뒤에 저장하는데, 그 사이 앱이 백그라운드로 가면
 *  아이폰이 페이지를 먼저 죽여 드라이브 쓰기가 끊긴다. 그러면 다음에 열 때
 *  지운 것이 그대로 남아 있다 — "지워도 자꾸 살아남" 의 절반이 이것이었다. */
export function touchNow() {
  S.dirty = true;
  return flush().catch(() => {});   // 실패하면 dirty 가 남아 다음 저장에 다시 실린다
}

/* ---------- 백업 ----------
 * 하루에 한 번만 남긴다. 사본은 최근 7개까지 두고 오래된 것은 지운다 —
 * catalog 는 아바타가 들어가 수백 KB 가 되므로 무한히 쌓을 것이 아니다.
 * 실패는 삼킨다: 백업이 안 됐다고 앱을 못 쓰게 만들 이유가 없다. */
const KEEP_BACKUPS = 7;

export async function backupIfDue() {
  if (S.demo || !S.catFileId) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (S.cat.lastBackup === today) return null;
  try {
    await drive.createBackup(S.cat, today);
    S.cat.lastBackup = today;
    touch();
    const list = await drive.listBackups();
    for (const f of list.slice(KEEP_BACKUPS)) {
      await drive.deleteFile(f.id).catch(() => { /* 지우기 실패는 넘어간다 */ });
    }
    return today;
  } catch {
    return null;
  }
}

export const listBackups = () => drive.listBackups();

/** 사본으로 현재 기록을 덮는다. 되돌릴 수 없으므로 호출부에서 반드시 확인받는다. */
export async function restoreBackup(id) {
  const raw = await drive.readCatalog(id);
  if (!raw || typeof raw !== 'object' || !raw.photos) throw new Error('bad backup');
  S.cat = migrate(raw);
  pCache = null;
  S.dirty = true;
  await flush();
  return S.cat;
}

/* ---------- 로컬 안전망 ----------
 * 드라이브에 못 올린 변경을 기기에 남긴다. 드라이브가 진실의 원천이라는
 * 것은 그대로다 — 이건 "아직 못 올렸다" 는 사실만 들고 있는 자리다.
 * 올라가면 지운다. 남아 있다는 것 자체가 "복구할 것이 있다" 는 표시다.
 */
const LOCAL_KEY = 'cd.cat.pending';

function saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ at: Date.now(), cat: S.cat }));
  } catch { /* 용량 초과. 드라이브 저장이 살아 있으면 문제 없다 */ }
}
function clearLocal() {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* 프라이빗 모드 */ }
}
/** 못 올린 스냅샷. 없으면 null. */
export function pendingLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    return v && v.cat && v.cat.photos ? v : null;
  } catch { return null; }
}

/* ---------- 저장 예약 ----------
 * 타이머는 하나만 둔다. 여러 개를 돌리면 같은 저장이 겹쳐 들어간다.
 * 실패하면 물러가며 다시 시도한다 — 토큰이 만료됐거나 네트워크가 끊겼을 때
 * 사용자가 다시 뭔가를 고칠 때까지 기다리면 그 사이에 앱을 닫아 유실된다.
 */
let again = false;      // 저장 중에 또 바뀌었나
let backoff = 0;

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => { flush().catch(() => { /* 상태로 남는다 */ }); }, ms);
}

export function onSaved(fn) { waiters.push(fn); }
const emit = () => waiters.forEach(f => f());

export async function flush() {
  clearTimeout(timer);
  if (!S.dirty) return;
  /* 이미 쓰는 중이면 겹쳐 보내지 않고 표시만 남긴다. 끝난 뒤 한 번 더 쓴다 —
     예전에는 여기서 그냥 돌아갔고, 그 변경이 아래 dirty=false 에 쓸려
     나가 영원히 저장되지 않았다. */
  if (S.saving) { again = true; return; }

  S.saving = true;
  /* dirty 는 **쓰기 전에** 내린다. 이 뒤에 온 변경은 다시 dirty 를 세우고,
     그건 again 과 함께 끝난 뒤 한 번 더 실린다. */
  S.dirty = false;
  again = false;
  S.saveError = null;
  emit();

  try {
    if (S.demo) {
      // 데모도 저장은 해준다 — 리로드 때마다 만든 게 날아가면 볼 수가 없다.
      localStorage.setItem('cd.demo.cat', JSON.stringify(S.cat));
    } else if (!S.catFileId) {
      const r = await drive.createCatalog(S.cat);
      S.catFileId = r.id;
      S.catVersion = r.version;
    } else {
      const r = await drive.writeCatalog(S.catFileId, S.cat, S.catVersion);
      S.catVersion = r.version;
    }
    S.conflict = false;
    S.lastSaveAt = Date.now();
    backoff = 0;
    clearLocal();          // 올라갔으니 안전망을 비운다
  } catch (e) {
    /* 못 올렸다. dirty 를 되돌리고 로컬에 남긴다 —
       여기서 놓치면 사용자가 적은 것이 그냥 사라진다. */
    S.dirty = true;
    saveLocal();
    if (e.conflict) {
      S.conflict = true;
      try {
        await mergeFromServer();
        S.dirty = false;
        S.conflict = false;
        S.lastSaveAt = Date.now();
        backoff = 0;
        clearLocal();
      } catch (e2) {
        S.saveError = e2;
      }
    } else {
      S.saveError = e;
    }
  } finally {
    S.saving = false;
    emit();
    if (S.dirty) {
      if (S.saveError) {
        // 물러가며 다시 시도한다. 4초 → 8 → 16 … 최대 1분
        backoff = Math.min(backoff ? backoff * 2 : 4000, 60000);
        schedule(backoff);
      } else {
        again = false;
        schedule(300);     // 저장 중에 온 변경을 바로 뒤이어 올린다
      }
    }
  }
}

/**
 * 두 카탈로그를 합친다. **mine 이 이긴다** — 이미 값이 있는 칸은 그대로 두고
 * server 는 빈 칸만 채운다. 목록은 합집합에서 묘비에 적힌 것을 걷어낸다.
 *
 * 두 곳에서 쓴다:
 *  - 충돌(다른 기기가 먼저 저장) : mine=내 것, server=드라이브본
 *  - 부팅(못 올린 로컬이 있음)   : mine=로컬본, server=드라이브본
 * 규칙이 갈라지면 한쪽에서만 사라지는 값이 생기므로 반드시 같은 함수를 쓴다.
 */
function mergeInto(mine, server) {
  pCache = null;

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
    /* 업로드 예정: 한쪽에만 있으면 살린다. 어느 기기가 더 최신인지 알 방법이
       없는데, 지우는 쪽으로 기울면 다른 폰에서 담아둔 것이 조용히 사라진다.
       살리는 쪽이 틀렸을 때는 눈에 보이고 한 번 누르면 끝난다. */
    mp.plannedAt ??= sp.plannedAt ?? null;
  }
  /* 묘비를 먼저 합친다. 양쪽에서 지운 것이 모두 남아야 한다. */
  const tomb = {};
  for (const k of ['events', 'packing', 'eventTags', 'tags', 'suits', 'careTags', 'todos']) {
    tomb[k] = new Set([
      ...((server.deleted && server.deleted[k]) || []),
      ...((mine.deleted && mine.deleted[k]) || []),
    ]);
  }
  mine.deleted = Object.fromEntries(Object.entries(tomb).map(([k, v]) => [k, [...v]]));

  /* 마스터 목록: 합집합으로 합친 뒤 묘비에 적힌 것을 걷어낸다.
     걷어내지 않으면 지운 행사가 서버본에서 되살아난다. */
  const alive = (arr, k, key) => arr.filter(x => !tomb[k].has(key(x)));

  mine.events = alive(unionBy([...server.events, ...mine.events], e => e.id), 'events', e => e.id);
  // 카테고리는 객체라 Set 으로 중복이 안 걸러진다. 이름 기준으로 합치고 내 색을 살린다.
  mine.eventTags = alive(unionBy([...(server.eventTags || []), ...(mine.eventTags || [])], t => t.name), 'eventTags', t => t.name);
  mine.packing = alive(unionBy([...(server.packing || []), ...(mine.packing || [])], x => x.id), 'packing', x => x.id);
  mine.shooters = unionBy([...server.shooters, ...mine.shooters], s => s.id);
  mine.people = unionBy([...server.people, ...mine.people], p => p.id);
  /* 슈트는 안에 기록(log)이 또 배열이라 unionBy 의 얕은 병합으로는 한쪽이
     통째로 덮인다 — 다른 기기에서 적어 둔 관리 기록이 조용히 사라진다.
     그래서 슈트를 합친 뒤 log 를 id 기준으로 다시 합친다. */
  const srvSuit = new Map((server.suits || []).map(x => [x.id, x]));
  mine.suits = alive(unionBy([...(server.suits || []), ...mine.suits], x => x.id), 'suits', x => x.id)
    .map(x => {
      const sv = srvSuit.get(x.id);
      if (!sv) return x;
      return { ...x, log: unionBy([...(sv.log || []), ...(x.log || [])], l => l.id) };
    });
  mine.careTags = alive(unionBy([...(server.careTags || []), ...(mine.careTags || [])], x => x.name),
    'careTags', x => x.name);
  mine.todos = alive(unionBy([...(server.todos || []), ...mine.todos], x => x.id), 'todos', x => x.id);
  mine.tags = [...new Set([...server.tags, ...mine.tags])].filter(t => !tomb.tags.has(t));
  mine.dismissed = [...new Set([...server.dismissed, ...mine.dismissed])];
  mine.gone = { ...server.gone, ...mine.gone };

  return mine;
}

/** 다른 기기가 먼저 저장한 경우: 서버본을 읽어 내 변경을 얹고 다시 쓴다. */
async function mergeFromServer() {
  const server = migrate(await drive.readCatalog(S.catFileId));
  mergeInto(S.cat, server);
  const cur = await drive.getFile(S.catFileId, 'version');
  S.catVersion = cur.version;
  const r = await drive.writeCatalog(S.catFileId, S.cat, S.catVersion);
  S.catVersion = r.version;
  // dirty·lastSaveAt 은 flush 가 관리한다 — 두 곳에서 만지면 어긋난다
}

function unionBy(arr, key) {
  const m = new Map();
  arr.forEach(x => m.set(key(x), { ...(m.get(key(x)) || {}), ...x }));
  return [...m.values()];
}

/* ---------- 동기화 (드라이브 → catalog 한 방향 대조) ---------- */

/**
 * 드라이브 목록과 catalog 를 대조한다.
 * @param {object[]} files    이미지 파일 목록
 * @param {object[]} [folders] 만난 폴더들 — 폴더 기반 제안에 쓴다
 */
export function syncFiles(files, folders) {
  const cat = S.cat;
  pCache = null;

  if (folders) {
    // 트리는 통째로 갈아 끼운다. 드라이브에서 폴더를 지우면 같이 사라져야 한다.
    cat.folderTree = {};
    for (const f of folders) cat.folderTree[f.id] = { name: f.name, parent: f.parent };
  }
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
  return { event: null, shooter: null, people: [], tags: [], usages: [], plannedAt: null, folder: null };
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
  // 자기 폴더. 드라이브에서 파일이 옮겨지면 다음 동기화에 따라온다.
  p.folder = (f.parents || [])[0] || p.folder || null;
  p.event ??= null;
  p.shooter ??= null;
  p.people ||= [];
  p.tags ||= [];
  p.usages ||= [];
  p.plannedAt ??= null;   // 옛 catalog 에서 올라온 사진
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

/* photos() 는 호출마다 **사진 수만큼 객체를 새로 만든다**. 한 번 그릴 때
   filtered() · groups() · counts() · 제안 엔진이 각각 부르니, 2천 장이면
   렌더 한 번에 수천 개가 만들어졌다 버려진다. 그래서 한 번 만들고 재사용한다.

   무효화는 touch() 가 맡는다 — 사진을 고치는 경로는 전부 touch() 를 부르게
   되어 있다(그러지 않으면 저장도 안 되니 규칙이 이미 강제돼 있다).
   카탈로그를 통째로 바꾸는 곳에서는 invalidatePhotos() 를 직접 부른다.

   photos() 가 돌려주는 것은 **사본**이다. 고칠 때는 예전부터 S.cat.photos[id] 를
   직접 만졌으니(사진 상세도 그렇다) 캐시가 그 규칙을 바꾸지는 않는다. */
let pCache = null;

export function invalidatePhotos() { pCache = null; }

export const photos = () => (pCache ||= Object.entries(S.cat.photos).map(([id, p]) => ({ id, ...p })));
/* ---------- 퍼슈트 ---------- */

/** 관리 태그 기본값. 파츠를 쪼개는 대신 태그로 "헤드 세탁" 처럼 붙인다. */
export function defaultCareTags() {
  return [
    { name: t('care.wash'), color: 'blue' },
    { name: t('care.air'), color: 'teal' },
    { name: t('care.fur'), color: 'green' },
    { name: t('care.fix'), color: 'red' },
    { name: t('care.head'), color: 'purple' },
    { name: t('care.body'), color: 'amber' },
    { name: t('care.paws'), color: 'pink' },
  ];
}

export const suitById = id => S.cat.suits.find(x => x.id === id) || null;

/** 은퇴하지 않은 슈트가 딱 하나면 그것. 아니면 null.
 *  하나뿐이면 "어느 캐릭터냐" 를 물을 필요가 없다는 뜻이다. */
/* ---------- 행사 없는 할 일 ---------- */

export function addTodo(text) {
  const it = { id: uid('td'), text: text.trim(), done: false, at: new Date().toISOString() };
  S.cat.todos.push(it);
  touch();
  return it;
}

/**
 * 할 일 목록. 행사에 묶이지 않은 것과, 행사 체크리스트에서 **핀을 꽂은**
 * 사전 준비 항목을 함께 낸다.
 *
 * 핀 꽂은 항목은 복사하지 않고 원본 객체를 그대로 넘긴다 — 어느 쪽에서
 * 체크해도 같은 것이 바뀌어야 하고, 복사해 두면 두 곳이 어긋난다.
 *
 * 안 한 것이 위로. 그 안에서는 행사 없는 것을 먼저 둔다 — 행사 항목은
 * 그 행사 체크리스트에도 있으니 여기서는 곁들이는 쪽이다.
 */
export function todoSorted() {
  const free = S.cat.todos.map(x => ({ it: x, ev: null }));
  const pinned = S.cat.events.flatMap(e =>
    (e.prep || []).filter(x => x.pin).map(x => ({ it: x, ev: e })));
  return [...free, ...pinned].sort((a, b) =>
    (a.it.done ? 1 : 0) - (b.it.done ? 1 : 0)
    || (a.ev ? 1 : 0) - (b.ev ? 1 : 0)
    || String(a.it.at || '').localeCompare(String(b.it.at || '')));
}

export function onlySuit() {
  const live = S.cat.suits.filter(x => !x.retiredAt);
  return live.length === 1 ? live[0] : null;
}

/** 슈트를 만들면 사진에 붙일 people[] 짝을 같이 만든다. */
export function addSuit(name, extra = {}) {
  const person = { id: uid('p'), name, role: null, x: extra.x || null, avatar: extra.avatar || null };
  S.cat.people.push(person);
  const suit = {
    id: uid('su'), name, x: null, avatar: null,
    maker: null, debutAt: null, birthday: null, memo: null, retiredAt: null,
    ...extra, personId: person.id, log: [],
  };
  S.cat.suits.push(suit);
  touch();
  return suit;
}

/** 이 슈트가 내 캐릭터인지 — 지정 시트에서 "내 캐릭터" 를 위로 올릴 때 쓴다. */
export const isMine = personId => S.cat.suits.some(x => x.personId === personId);

/**
 * 착용 이력. 저장하지 않고 **행사에서** 유도한다 —
 * "이 행사에 데려갔다"(event.suits)가 곧 그날 입었다는 뜻이다.
 * 사진에서 유도하는 것보다 정확하다: 사진을 아직 분류하지 않아도 맞다.
 * 날짜가 없는 행사는 횟수에는 넣고 날짜 목록에서는 뺀다.
 */
export function suitWears(suit) {
  if (!suit) return { n: 0, last: null, dates: [] };
  const evs = S.cat.events.filter(e => (e.suits || []).includes(suit.id));
  const dates = evs.map(e => e.date).filter(Boolean).sort();
  return { n: evs.length, last: dates[dates.length - 1] || null, dates };
}

/** 이 캐릭터가 찍힌 사진 수. 사진 탭으로 넘길 때 같이 보여 준다. */
export function suitPhotoCount(suit) {
  if (!suit?.personId) return 0;
  return photos().filter(p => (p.people || []).includes(suit.personId)).length;
}

/** 관리 기록을 갈라 준다. 안 한 것이 위로 온다. */
export function careSplit(suit) {
  const log = suit?.log || [];
  const todo = log.filter(l => !l.doneAt).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const done = log.filter(l => l.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  return { todo, done };
}

/** 마지막으로 그 태그의 관리를 한 뒤 몇 번 입었나. 세탁 주기의 실제 기준이다. */
export function wearsSince(suit, tagName) {
  const { done } = careSplit(suit);
  const lastAt = done.find(l => (l.kinds || []).includes(tagName))?.doneAt || null;
  const { n, dates } = suitWears(suit);
  if (!lastAt) return { since: null, n };
  const day = lastAt.slice(0, 10);
  return { since: lastAt, n: dates.filter(d => d >= day).length };
}

/**
 * 슈트가 하나뿐일 때 지금 있는 것을 한 번에 붙인다.
 *
 * 이미 쌓아 둔 사진이 수백 장인 사람에게 행사마다 버튼을 누르게 하면
 * 그게 곧 "귀찮아서 안 쓴다" 가 된다. 하나뿐이라 답이 정해져 있으니
 * 한 번 물어보고 끝낸다.
 *
 * 이미 내 캐릭터가 붙은 사진은 건드리지 않는다 — 손으로 정한 것이 우선이다.
 * 참가하지 않은(going:false) 행사와 "행사 미상" 은 착용으로 세지 않는다.
 */
export function tagEverything(suit) {
  if (!suit?.personId) return { photos: 0, events: 0 };
  let np = 0;
  for (const p of Object.values(S.cat.photos)) {
    const has = p.people || [];
    if (has.includes(suit.personId)) continue;
    if (has.some(pid => isMine(pid))) continue;
    p.people = [...has, suit.personId];
    np++;
  }
  let ne = 0;
  for (const e of S.cat.events) {
    if (e.unknown || e.going === false) continue;
    if ((e.suits || []).includes(suit.id)) continue;
    e.suits = [...(e.suits || []), suit.id];
    ne++;
  }
  if (np || ne) { invalidatePhotos(); touchNow(); }
  return { photos: np, events: ne };
}

/**
 * 그 행사 사진에 캐릭터를 붙인다.
 * 이미 내 캐릭터가 붙어 있는 사진은 건드리지 않는다 — 손으로 정한 것이 우선이다.
 * @returns 실제로 붙인 장수
 */
export function tagEventSuit(eventId, suit, ids) {
  if (!suit?.personId) return 0;
  const target = ids || photos().filter(p => p.event === eventId).map(p => p.id);
  let n = 0;
  for (const id of target) {
    const p = S.cat.photos[id];
    if (!p) continue;
    const has = p.people || [];
    if (has.includes(suit.personId)) continue;
    // 다른 내 캐릭터가 이미 붙어 있으면 손으로 정한 것이므로 넘어간다
    if (!ids && has.some(pid => isMine(pid))) continue;
    p.people = [...has, suit.personId];
    n++;
  }
  if (n) touch();
  return n;
}

export const isUsed = p => (p.usages || []).length > 0;

/* 업로드 예정으로 담아둔 사진.
 *
 * 이미 올린 사진이어도 표시는 유지한다 — 다시 올릴 계획일 수 있다.
 * 대신 사용 이력을 기록하는 순간 표시를 자동으로 푼다(usageSheet). 담아둔
 * 사진을 올리고 나서 손으로 또 지우게 만들면 목록이 금세 못 믿을 것이 된다. */
export const isPlanned = p => !!p.plannedAt;

/** 여러 장의 "업로드 예정" 을 한 번에 켜고 끈다. @returns 실제로 바뀐 장수 */
export function setPlanned(ids, on) {
  const now = new Date().toISOString();
  let n = 0;
  ids.forEach(id => {
    const p = S.cat.photos[id];
    if (!p) return;
    if (!!p.plannedAt === on) return;
    p.plannedAt = on ? now : null;
    n++;
  });
  if (n) touch();
  return n;
}
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
    /* 슈트가 하나뿐이면 데려간 것도 정해져 있다 — 물어볼 이유가 없다.
       둘 이상이면 비워 두고 행사 상세에서 고르게 한다. */
    suits: onlySuit() ? [onlySuit().id] : [],
  };
  S.cat.events.push(e); touch(); return e;
}
export const UNKNOWN_EVENT = 'e-unknown';

/** "행사 미상" 은 미지정과 다르다 — 어느 행사였는지 찾아본 뒤 모른다고
 *  결론 낸 사진들을 모아 두는 자리다. 미지정으로 두면 "아직 정할 것" 목록에
 *  영원히 남아 매번 다시 확인하게 된다.
 *
 *  날짜가 없어서 일정(디데이)에는 잡히지 않고, 복사 문구의 해시태그에서도
 *  빠진다 — "#행사미상" 은 아무 뜻이 없다. */
export function unknownEvent() {
  let e = S.cat.events.find(x => x.id === UNKNOWN_EVENT);
  if (!e) {
    e = {
      id: UNKNOWN_EVENT, name: t('common.unknownEvent'), date: null, endDate: null,
      going: false, place: null, note: null, logo: null,
      tags: [], sub: [], prep: [], packed: [], unknown: true,
    };
    S.cat.events.push(e);
    touch();
  }
  return e;
}

export const UNKNOWN_SHOOTER = 's-unknown';

/** "사진사 미상" 은 미지정과 다르다 — 알아본 뒤 모른다고 결론 낸 상태다.
 *  실제 사진사 항목으로 두어 필터·집계가 자연스럽게 되게 하고,
 *  카메라→사진사 제안과 크레딧 복사에서는 제외한다. */
export function unknownShooter() {
  let s = S.cat.shooters.find(x => x.id === UNKNOWN_SHOOTER);
  if (!s) {
    s = { id: UNKNOWN_SHOOTER, name: t('common.unknownShooter'), x: null, avatar: null, unknown: true };
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
  if (opts.eventTag && ev && !ev.unknown) tags.push(hashtagify(ev.name));
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
