/* suggest.js — "확인할 것" 제안 엔진
 *
 * 원칙
 *  1. 자동 적용하지 않는다. 두 사진사가 같은 바디를 쓰면 틀리니까 항상 묻는다.
 *     사용자가 "앞으로 이 카메라는 자동" 을 켠 조합(rules.camera)만 무인 적용한다.
 *  2. 거부를 기억한다. 안 그러면 동기화마다 같은 제안이 다시 떠서 금방 짜증난다.
 *     "아니요" → dismissed 에 영구 기록. "나중에" → 이번 세션만 숨김.
 */
import { S, photos, isUnfiled, eventById, shooterById, touch, UNKNOWN_SHOOTER } from './store.js';

const laterKeys = new Set(); // 세션 한정

export const dayOf = iso => (iso || '').slice(0, 10);

/** 표시할 제안 목록 (최대 6개). */
export function build() {
  const out = [];
  const all = photos();

  out.push(...cameraToShooter(all));
  out.push(...dateToEvent(all));
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
      why: `${cam} 로 찍힌 ${ids.length}장`,
      q: `${sh.name} 사진사가 찍은 사진인가요?`,
      note: ambiguous ? `이 카메라를 쓰는 사진사가 ${ranked.length}명이라 확실하지 않아요` : null,
      ids,
      apply: { shooter: topId },
      alwaysLabel: ambiguous ? null : `앞으로 ${cam} 은 ${sh.name}`,
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
      why: `${fmtDate(d)} 에 찍힌 ${ids.length}장`,
      q: `${e.name} 사진인가요?`,
      ids,
      apply: { event: e.id },
    };
  });
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
      why: `${fmtDate(d)} 에 ${ids.length}장이 몰려 있어요`,
      q: '새 행사로 만들까요?',
      ids,
      date: d,
    }));
}

export function dismiss(key) {
  if (!S.cat.dismissed.includes(key)) { S.cat.dismissed.push(key); touch(); }
}
export function later(key) { laterKeys.add(key); }

/** 제안을 받아들여 사진들에 적용 */
export function accept(sug, { always = false } = {}) {
  for (const id of sug.ids) {
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
