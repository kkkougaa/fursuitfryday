/* suggest.js — "확인할 것" 제안 엔진
 *
 * 원칙
 *  1. 자동 적용하지 않는다. 두 사진사가 같은 바디를 쓰면 틀리니까 항상 묻는다.
 *     사용자가 "앞으로 이 카메라는 자동" 을 켠 조합(rules.camera)만 무인 적용한다.
 *  2. 거부를 기억한다. 안 그러면 동기화마다 같은 제안이 다시 떠서 금방 짜증난다.
 *     "아니요" → dismissed 에 영구 기록. "나중에" → 이번 세션만 숨김.
 */
import { S, photos, isUnfiled, eventById, shooterById, touch, UNKNOWN_SHOOTER } from './store.js';
import { t } from './i18n.js';

const laterKeys = new Set(); // 세션 한정

export const dayOf = iso => (iso || '').slice(0, 10);

/** 표시할 제안 목록 (최대 6개). */
export function build() {
  const out = [];
  const all = photos();

  out.push(...cameraToShooter(all));
  out.push(...dateToEvent(all));
  out.push(...folderGroups(all));
  out.push(...newEventClusters(all));

  return out
    .filter(s => !S.cat.dismissed.includes(s.key) && !laterKeys.has(s.key))
    .sort((a, b) => b.ids.length - a.ids.length)
    .slice(0, 6);
}

/** 카메라 모델이 기존 사진사의 것과 같은 미지정 사진 → "이 사진사인가요?" */
function cameraToShooter(all) {
  const known = new Map(); // cameraModel → Map(shooterId → count)
  for (const p of all) {
    if (!p.shooter || p.shooter === UNKNOWN_SHOOTER || !p.cameraModel) continue;
    if (!known.has(p.cameraModel)) known.set(p.cameraModel, new Map());
    const m = known.get(p.cameraModel);
    m.set(p.shooter, (m.get(p.shooter) || 0) + 1);
  }

  const groups = new Map(); // cameraModel → ids
  for (const p of all) {
    if (p.shooter || !p.cameraModel || !known.has(p.cameraModel)) continue;
    if (!groups.has(p.cameraModel)) groups.set(p.cameraModel, []);
    groups.get(p.cameraModel).push(p.id);
  }

  const out = [];
  for (const [cam, ids] of groups) {
    const ranked = [...known.get(cam)].sort((a, b) => b[1] - a[1]);
    const [topId, topN] = ranked[0];
    const sh = shooterById(topId);
    if (!sh) continue;
    // 같은 카메라를 쓰는 사진사가 둘 이상이면 확신이 낮다는 걸 알려준다
    const ambiguous = ranked.length > 1;
    out.push({
      key: `cam:${cam}→${topId}`,
      kind: 'shooter',
      why: t('sug.camWhy', { cam, n: ids.length }),
      q: t('sug.shooterQ', { name: sh.name }),
      note: ambiguous ? t('sug.camNote', { n: ranked.length }) : null,
      ids,
      apply: { shooter: topId },
      alwaysLabel: ambiguous ? null : t('sug.always', { cam, name: sh.name }),
      alwaysKey: cam,
      alwaysValue: topId,
      confidence: topN,
    });
  }
  return out;
}

/** 촬영일이 기존 행사 날짜와 같은 미지정 사진 → "이 행사인가요?" */
function dateToEvent(all) {
  const byDate = new Map();
  for (const e of S.cat.events) if (e.date) byDate.set(e.date, e);

  const groups = new Map();
  for (const p of all) {
    if (p.event || !p.shotAt) continue;
    const d = dayOf(p.shotAt);
    if (!byDate.has(d)) continue;
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(p.id);
  }

  return [...groups].map(([d, ids]) => {
    const e = byDate.get(d);
    return {
      key: `date:${d}→${e.id}`,
      kind: 'event',
      why: t('sug.dateWhy', { date: fmtDate(d), n: ids.length }),
      q: t('sug.eventQ', { name: e.name }),
      ids,
      apply: { event: e.id },
    };
  });
}

/* ---------- 폴더 구조로 제안 ----------
 *
 * 폴더로 이미 정리해 둔 사람은 사실상 분류를 끝내 놓은 것이다. 그걸 읽어내면
 * 첫 분류 비용이 거의 사라진다.
 *
 * 어려운 지점은 "몇 번째 층이 행사냐" 다. 사람마다 다르게 쌓으므로 정답이 없다.
 * 그래서 **깊이를 보지 않는다.** 그 폴더에 든 사진이 어떻게 생겼는지만 본다.
 * 필요한 값은 이미 catalog 에 있다 — shotAt, cameraModel.
 *
 *   촬영일 폭이 좁고 카메라가 여럿   → 행사   (여러 사진사가 같은 날을 찍었다)
 *   카메라가 하나이고 부모가 행사     → 사진사
 *   이름이 기존 사진사와 같다         → 사진사 (깊이 무관, 가장 강한 신호)
 *
 * 몇 층 깊이든 상관없고, 사람이 사진사/행사 순서로 거꾸로 쌓아 놨어도
 * 내용으로 판정하니 그대로 맞는다. 애매한 폴더(하루·카메라 하나)는
 * 아무 제안도 하지 않는다 — 틀린 제안을 쌓는 것이 더 나쁘다.
 */
const F_MIN = 5;            // 이보다 적은 폴더는 노이즈다
const F_EVENT_SPAN = 3;     // 행사로 볼 촬영일 폭(일)

const norm = v => String(v || '').trim().toLowerCase().replace(/^@/, '');

function folderGroups(all) {
  const tree = S.cat.folderTree || {};
  if (!Object.keys(tree).length) return [];

  const roots = new Set((S.cat.folders || []).map(f => f.id));

  /* 폴더별로 자기 사진과 하위 폴더 목록을 모은다 */
  const own = new Map();      // fid → ids
  for (const p of all) {
    if (!p.folder) continue;
    if (!own.has(p.folder)) own.set(p.folder, []);
    own.get(p.folder).push(p.id);
  }
  const kids = new Map();     // fid → [fid]
  for (const [fid, f] of Object.entries(tree)) {
    const par = f.parent;
    if (!par) continue;
      if (!kids.has(par)) kids.set(par, []);
    kids.get(par).push(fid);
  }

  /* 하위까지 합친 사진 (깊이 제한으로 순환 폴더를 방어한다) */
  const subCache = new Map();
  const sub = (fid, depth = 0) => {
    if (subCache.has(fid)) return subCache.get(fid);
    if (depth > 24) return [];
    let ids = [...(own.get(fid) || [])];
    for (const k of kids.get(fid) || []) ids = ids.concat(sub(k, depth + 1));
    subCache.set(fid, ids);
    return ids;
  };

  const stats = ids => {
    const days = new Set(), cams = new Set();
    for (const id of ids) {
      const p = S.cat.photos[id];
      if (!p) continue;
      if (p.shotAt) days.add(dayOf(p.shotAt));
      if (p.cameraModel) cams.add(p.cameraModel);
    }
    const ds = [...days].sort();
    // daysBetween(a, b) 는 a - b 다. 늦은 날을 먼저 넣어야 양수가 나온다.
    const span = ds.length ? daysBetween(ds[ds.length - 1], ds[0]) : 0;
    return { span, days: ds.length, cams: cams.size };
  };

  const shooterByName = name => S.cat.shooters.find(x => !x.unknown
    && (norm(x.name) === norm(name) || (x.x && norm(x.x) === norm(name))));

  const out = [];

  /* 행사 층을 찾는다: 루트에서 내려가다 처음으로 "행사처럼 생긴" 폴더를 만나면
     그것을 행사로 제안하고 더 내려가지 않는다. 그 아래 자식들은 사진사 후보다. */
  /* 사진을 직접 갖지 않고 자식 폴더가 하나뿐인 폴더는 **경로 조각**이다
     (`2026/봄/봄퍼밋` 의 2026, 봄). 그 자체로는 아무 뜻이 없는데, 하위를
     합치면 행사처럼 보여서 "2026 을 행사로 만들까요?" 같은 제안이 나왔다.
     정보가 없는 층은 건너뛰고 계속 내려간다. */
  const passThrough = fid => (own.get(fid) || []).length === 0
    && (kids.get(fid) || []).length === 1;

  const walk = (fid, depth) => {
    if (depth > 24) return;
    const ids = sub(fid);
    const isRoot = roots.has(fid);

    if (!isRoot && passThrough(fid)) { walk(kids.get(fid)[0], depth + 1); return; }

    if (!isRoot && ids.length >= F_MIN) {
      const st = stats(ids);
      const name = tree[fid] ? tree[fid].name : '';

      // 이름이 기존 사진사와 같으면 깊이와 무관하게 사진사다
      const known = shooterByName(name);
      if (known) {
        const mine = ids.filter(id => S.cat.photos[id] && !S.cat.photos[id].shooter);
        if (mine.length >= F_MIN) {
          out.push({
            key: `fsh:${fid}:${known.id}`,
            kind: 'shooter',
            why: t('sug.folderWhy', { name, n: mine.length }),
            q: t('sug.shooterQ', { name: known.name }),
            note: t('sug.whyNameMatch', { name: known.name }),
            ids: mine,
            apply: { shooter: known.id },
          });
        }
        return;   // 사진사 폴더 아래를 더 파지 않는다
      }

      if (st.span <= F_EVENT_SPAN && st.cams >= 2) {
        const mine = ids.filter(id => S.cat.photos[id] && !S.cat.photos[id].event);
        if (mine.length >= F_MIN) {
          out.push({
            key: `fev:${fid}`,
            kind: 'folderEvent',
            why: t('sug.folderWhy', { name, n: mine.length }),
            q: t('sug.folderEventQ'),
            note: st.span === 0
              ? t('sug.whyOneDay', { cams: st.cams })
              : t('sug.whySpan', { days: st.span + 1, cams: st.cams }),
            ids: mine,
            folderName: name,
            folderId: fid,
          });
        }
        // 이 행사 폴더의 자식들은 사진사 후보
        for (const k of kids.get(fid) || []) {
          const kids2 = sub(k);
          const ks = stats(kids2);
          const kname = tree[k] ? tree[k].name : '';
          const kmine = kids2.filter(id => S.cat.photos[id] && !S.cat.photos[id].shooter);
          if (ks.cams === 1 && kmine.length >= F_MIN) {
            out.push({
              key: `fsn:${k}`,
              kind: 'folderShooter',
              why: t('sug.folderWhy', { name: kname, n: kmine.length }),
              q: t('sug.folderShooterQ'),
              note: t('sug.whyOneCam', { parent: name }),
              ids: kmine,
              folderName: kname,
              folderId: k,
            });
          }
        }
        return;   // 행사 층을 찾았으니 더 내려가지 않는다
      }
    }

    for (const k of kids.get(fid) || []) walk(k, depth + 1);
  };

  for (const r of roots) walk(r, 0);
  return out;
}

/** 날짜별로 몰려 있는 미분류 사진 → "새 행사로 만들까요?" */
function newEventClusters(all) {
  const have = new Set(S.cat.events.map(e => e.date).filter(Boolean));
  const groups = new Map();
  for (const p of all) {
    if (p.event || !p.shotAt) continue;
    const d = dayOf(p.shotAt);
    if (have.has(d)) continue;
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(p.id);
  }
  return [...groups]
    .filter(([, ids]) => ids.length >= 5)   // 몇 장짜리 자잘한 날은 제안하지 않는다
    .map(([d, ids]) => ({
      key: `newev:${d}`,
      kind: 'newEvent',
      why: t('sug.clusterWhy', { date: fmtDate(d), n: ids.length }),
      q: t('sug.newEvent'),
      ids,
      date: d,
    }));
}

export function dismiss(key) {
  if (!S.cat.dismissed.includes(key)) { S.cat.dismissed.push(key); touch(); }
}
export function later(key) { laterKeys.add(key); }

/** 제안을 받아들여 사진들에 적용.
 *  ids 를 주면 그 사진만 — 카메라·날짜로 묶은 제안은 대개 맞지만 항상
 *  맞지는 않아서, 받아들이기 전에 아닌 것을 빼는 화면을 거친다. */
export function accept(sug, { always = false, ids = null } = {}) {
  for (const id of (ids && ids.length ? ids : sug.ids)) {
    const p = S.cat.photos[id];
    if (!p) continue;
    if (sug.apply?.shooter && !p.shooter) p.shooter = sug.apply.shooter;
    if (sug.apply?.event && !p.event) p.event = sug.apply.event;
  }
  if (always && sug.alwaysKey) S.cat.rules.camera[sug.alwaysKey] = sug.alwaysValue;
  dismiss(sug.key);
  touch();
}

/** 동기화 직후: 사용자가 "앞으로 자동" 을 켠 카메라 규칙만 조용히 적용 */
export function applyRules(ids) {
  let n = 0;
  for (const id of ids) {
    const p = S.cat.photos[id];
    if (!p || p.shooter || !p.cameraModel) continue;
    const sid = S.cat.rules.camera[p.cameraModel];
    if (sid && shooterById(sid)) { p.shooter = sid; n++; }
  }
  if (n) touch();
  return n;
}

export const unfiledCount = () => photos().filter(isUnfiled).length;

/** 두 날짜(YYYY-MM-DD) 사이 일수. 이틀짜리 행사 편입 제안에 쓴다. */
export function daysBetween(a, b) {
  if (!a || !b) return 999;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

export function fmtDate(d) {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${y}.${m}.${dd}`;
}
export { eventById };
