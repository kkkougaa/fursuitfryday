/* schedule.js — 일정 탭, 디데이, 하위 일정, 체크리스트
 *
 * 행사(events)를 사진 분류 축과 일정으로 겸용한다. 같은 행사를 두 군데에
 * 따로 적을 이유가 없고, 그래야 "이 행사 사진 보기"가 자연스럽게 이어진다.
 *
 * 행사는 하루짜리일 수도, 여러 날 묶는 컨벤션일 수도 있다(date~endDate).
 * 그 안의 약속은 하위 일정(sub)으로 둔다 — 별개 행사로 만들면 사진 분류
 * 축이 쓸데없이 늘어나기 때문이다.
 *
 * 참가가 확정되지 않은(going=false) "미정" 행사는 홈 디데이를 차지하지 않는다.
 *
 * 체크리스트 두 갈래
 *   사전 준비 — 그 행사에만 해당하는 할 일. 행사별로 직접 적는다.
 *   짐 챙기기 — 매번 같은 것을 챙기므로 공용 목록(cat.packing)을 설정에서
 *              관리하고, 체크 상태만 행사별(events[].packed)로 남긴다.
 */
import { S, touch, touchNow, markDeleted, addEvent, photos, uid, catColor, shooterById } from './store.js';
import * as th from './thumbs.js';
import {
  $, el, ic, esc, fmt, push, popAll, openSheet, closeSheet,
  toast, confirmSheet, wireScroll, keepScroll, segment, flipSwitch,
} from './ui.js';
import { V, NO_FILTER, goTab, renderAll, renderHome, assignSheet, reviewSheet } from './screens.js';
import { catSheet, logoSheet } from './screens2.js';
import { avatarHTML } from './ui.js';
import { t } from './i18n.js';

/* ---------- 날짜 ---------- */

const p2 = v => String(v).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

function diff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/** 오늘부터 그 날짜까지 며칠. 자정 기준으로만 세어 타임존을 섞지 않는다. */
export function daysUntil(dateStr) {
  return dateStr ? diff(dateStr, todayStr()) : null;
}

const fmtDate = d => (d ? d.replace(/-/g, '.') : '');
export const dayCount = e => (e.endDate ? diff(e.endDate, e.date) + 1 : 1);

/** 하루면 "2026.10.23", 여러 날이면 "2026.10.23 – 25 · 3일" */
export function fmtRange(e) {
  if (!e.date) return t('sched.noDate');
  if (!e.endDate) return fmtDate(e.date);
  const [sy, sm] = e.date.split('-');
  const [ey, em, ed] = e.endDate.split('-');
  const tail = (sy === ey && sm === em) ? ed : (sy === ey ? `${em}.${ed}` : fmtDate(e.endDate));
  return `${fmtDate(e.date)} – ${tail} · ${t('sched.spanDays', { n: dayCount(e) })}`;
}

/**
 * 행사가 지금 어디쯤인지.
 *  before : 시작 전  { n } 남은 일수
 *  during : 진행 중  { idx, of } 며칠차 / 총 며칠
 *  after  : 끝남     { n } 지난 일수
 */
export function phase(e) {
  if (!e.date) return { state: 'none' };
  const s = daysUntil(e.date);
  const u = daysUntil(e.endDate || e.date);
  if (s > 0) return { state: 'before', n: s };
  if (u >= 0) return { state: 'during', idx: -s + 1, of: dayCount(e) };
  return { state: 'after', n: -u };
}

/** 목록·카드에 쓰는 큰 글씨 / 작은 글씨 */
export function ddayLabel(e) {
  const ph = phase(e);
  if (ph.state === 'none') return { big: '–', sub: t('sched.tbd'), ph };
  if (ph.state === 'before') return { big: `D-${ph.n}`, sub: t('sched.daysLeft', { n: ph.n }), ph };
  if (ph.state === 'after') return { big: `D+${ph.n}`, sub: t('sched.daysPast', { n: ph.n }), ph };
  return ph.of > 1
    ? { big: t('sched.dayN', { n: ph.idx }), sub: t('sched.ofDays', { n: ph.of }), ph }
    : { big: t('sched.today'), sub: t('sched.live'), ph };
}

const isLive = e => phase(e).state === 'during';
const isDone = e => phase(e).state === 'after';

/** 홈 디데이가 잡을 행사: 진행 중 > 다가오는 확정 > 다가오는 미정 */
export function nextEvent() {
  const future = S.cat.events.filter(e => e.date && !isDone(e));
  const live = future.filter(isLive).sort((a, b) => a.date.localeCompare(b.date));
  if (live.length) return live[0];
  const sorted = [...future].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.find(e => e.going !== false) || sorted[0] || null;
}

export const prepDone = e => (e.prep || []).filter(x => x.done).length;
export const packDone = e => (e.packed || []).filter(id => S.cat.packing.some(p => p.id === id)).length;
export function progress(e) {
  const total = (e.prep || []).length + S.cat.packing.length;
  const done = prepDone(e) + packDone(e);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/* ---------- 하위 일정 ---------- */

const subs = e => [...(e.sub || [])].sort((a, b) =>
  (a.day || '').localeCompare(b.day || '') || (a.time || '99:99').localeCompare(b.time || '99:99'));

/** 오늘 이후의 약속만 — 진행 중인 행사에서 "앞으로 뭐가 남았나" 용 */
const subsAhead = e => subs(e).filter(x => !x.day || x.day >= todayStr());

function subRow(e, x, onChange) {
  const r = el('button', 'subrow tapable');
  const multi = dayCount(e) > 1;
  const dayLb = multi && x.day ? t('sched.dayN', { n: diff(x.day, e.date) + 1 }) : '';
  const meta = [dayLb, x.place].filter(Boolean).join(' · ');
  r.innerHTML = `<span class="tm">${esc(x.time || '--:--')}</span>`
    + `<span class="grow"><span class="tt">${esc(x.title)}</span>`
    + (meta ? `<span class="mm">${esc(meta)}</span>` : '')
    + (x.note ? `<span class="memo">${esc(x.note)}</span>` : '')
    + `</span>`
    + (x.note ? `<span class="hasmemo">${ic('info', 14, 2.2)}</span>` : '');
  // 편집 가능한 자리(일정 상세)에서는 삭제 버튼을 붙이고, 목록에서는 보기만.
  if (onChange) {
    const del = el('span', 'del', ic('x', 15, 2.4));
    del.onclick = ev => {
      ev.stopPropagation();
      e.sub = (e.sub || []).filter(y => y.id !== x.id);
      touch(); onChange();
    };
    r.appendChild(del);
    r.onclick = () => subSheet(e, x, onChange);
  } else {
    // 일정 목록에서 약속을 누르면 무엇인지 알아볼 수 있게 읽기 시트를 띄운다
    r.onclick = () => subViewSheet(e, x);
  }
  return r;
}

/** 약속 하나를 읽어 보는 시트 (목록에서 누를 때) */
function subViewSheet(e, x) {
  const multi = dayCount(e) > 1;
  const when = [
    multi && x.day ? `${t('sched.dayN', { n: diff(x.day, e.date) + 1 })} · ${fmtDate(x.day).slice(5)}` : fmtDate(x.day || e.date),
    x.time || null,
  ].filter(Boolean).join(' · ');
  openSheet(`<h3>${esc(x.title)}</h3><p class="lead">${esc(e.name)}</p>`
    + `<dl class="kv"><div><dt>${t('sched.when')}</dt><dd>${esc(when || t('sched.tbd'))}</dd></div>`
    + (x.place ? `<div><dt>${t('sched.where')}</dt><dd>${esc(x.place)}</dd></div>` : '')
    + `</dl>`
    + (x.note
      ? `<div class="fld" style="margin-top:14px"><label>${t('sched.memo')}</label><pre class="pv">${esc(x.note)}</pre></div>`
      : `<div class="note" style="margin-top:14px">${ic('info', 17)}<span>${t('sched.noMemo')}</span></div>`)
    + `<button class="btn" id="sv-edit" style="margin-top:16px">${ic('cal', 18, 2.1)}${t('sched.edit')}</button>`
    + `<button class="btn sub" id="sv-go" style="width:100%;margin-top:8px">${ic('chev', 17, 2.2)}${t('sched.openEvent')}</button>`);
  $('#sv-edit').onclick = () => subSheet(e, x, () => renderAll());
  $('#sv-go').onclick = () => { closeSheet(); openEvent(e.id); };
}

/** 약속 추가 / 편집 */
function subSheet(e, x, after) {
  const isNew = !x;
  const multi = dayCount(e) > 1;
  const days = [];
  if (e.date) {
    for (let i = 0; i < dayCount(e); i++) {
      const d = new Date(`${e.date}T00:00:00`);
      d.setDate(d.getDate() + i);
      const key = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
      days.push({ key, label: `${t('sched.dayN', { n: i + 1 })} · ${fmtDate(key).slice(5)}` });
    }
  }
  openSheet(`<h3>${t(isNew ? 'sched.subAdd' : 'sched.subEdit')}</h3>`
    + `<p class="lead">${t('sched.subLead', { name: esc(e.name) })}</p>`
    + `<div class="fld"><label for="sb-t">${t('sched.what')}</label>`
    + `<input id="sb-t" maxlength="40" value="${esc(x ? x.title : '')}" placeholder="${t('sched.subTitlePh')}"></div>`
    + (multi && days.length
      ? `<div class="fld"><label for="sb-d">${t('sched.whichDay')}</label><select id="sb-d">`
        + days.map(d => `<option value="${d.key}"${(x ? x.day : e.date) === d.key ? ' selected' : ''}>${d.label}</option>`).join('')
        + `</select></div>`
      : '')
    + `<div class="fld"><label for="sb-h">${t('sched.timeOpt')}</label>`
    + `<input id="sb-h" type="time" value="${esc(x && x.time ? x.time : '')}"></div>`
    + `<div class="fld"><label for="sb-p">${t('sched.placeOpt')}</label>`
    + `<input id="sb-p" maxlength="30" value="${esc(x && x.place ? x.place : '')}" placeholder="${t('sched.subPlacePh')}"></div>`
    + `<div class="fld"><label for="sb-n">${t('sched.noteOpt')}</label>`
    + `<textarea id="sb-n" maxlength="300" rows="3" placeholder="${t('sched.notePh')}">${esc(x && x.note ? x.note : '')}</textarea>`
    + `<div class="hint">${t('sched.noteHint')}</div></div>`
    + `<button class="btn" id="sb-save">${t(isNew ? 'common.add' : 'common.save')}</button>`);

  const inT = $('#sb-t');
  $('#sb-save').onclick = () => {
    const title = inT.value.trim();
    if (!title) { inT.focus(); return; }
    const rec = {
      id: x ? x.id : uid('sb'),
      day: $('#sb-d') ? $('#sb-d').value : e.date,
      time: $('#sb-h').value || null,
      title,
      place: $('#sb-p').value.trim() || null,
      note: $('#sb-n').value.trim() || null,
    };
    e.sub = e.sub || [];
    if (x) e.sub = e.sub.map(y => (y.id === x.id ? rec : y));
    else e.sub.push(rec);
    touch();
    closeSheet();
    toast(isNew ? t('sched.subAdded') : t('common.saved'));
    if (after) after();
    renderAll();
  };
  setTimeout(() => inT.focus(), 340);
}

/* ---------- 펼침 상태 (다시 그려도 유지) ---------- */
const open = new Set();

/** max-height 를 재서 넣는다 — 내용 높이가 제각각이라 CSS 만으로는 안 된다. */
function setPanel(panel, expanded) {
  panel.style.maxHeight = expanded ? `${panel.scrollHeight}px` : '0px';
  panel.classList.toggle('on', expanded);
}

function wireExpand(key, host, panel, btn) {
  const apply = () => {
    const on = open.has(key);
    setPanel(panel, on);
    host.classList.toggle('open', on);
  };
  requestAnimationFrame(apply);
  btn.onclick = ev => {
    ev.stopPropagation();
    open.has(key) ? open.delete(key) : open.add(key);
    apply();
  };
}

/* ---------- 홈 최상단 디데이 카드 ---------- */

export function ddayCard() {
  const e = nextEvent();
  if (!e) {
    const b = el('button', 'strip', `<span class="k">${t('sched.registerNext')}</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
    b.onclick = () => { goTab('schedule'); setTimeout(() => eventSheet(null), 120); };
    return b;
  }
  const d = ddayLabel(e);
  const live = d.ph.state === 'during';
  const pg = progress(e);
  const ahead = subsAhead(e);

  const wrap = el('div', 'ddwrap');
  const card = el('div', 'dday'
    + (live ? ' live' : d.ph.state === 'before' && d.ph.n <= 7 ? ' soon' : '')
    + (e.going === false ? ' maybe' : ''));

  const main = el('button', 'main');
  const bits = [fmtRange(e), e.place].filter(Boolean).join(' · ');
  main.innerHTML = (e.logo ? `<img class="evlogo sm" alt="" src="${e.logo}">` : '')
    + `<span class="col">`
    + `<span class="k">${live ? `<i class="live-dot"></i>${t('sched.liveEvent')}`
      : e.going === false ? t('sched.goingNo') : t('sched.nextEvent')}</span>`
    + `<span class="nm">${esc(e.name)}</span>`
    + `<span class="m">${esc(bits)}${pg.total ? ` · ${t('sched.prep')} ${pg.done}/${pg.total}` : ''}</span></span>`;
  main.onclick = () => openEvent(e.id);

  const num = el('div', 'num', `<b>${d.big}</b><i>${esc(d.sub)}</i>`);

  const exp = el('button', 'exp');
  exp.setAttribute('aria-label', t('sched.expand'));
  exp.innerHTML = ic('chev', 20, 2.4);

  card.appendChild(main);
  card.appendChild(num);
  card.appendChild(exp);
  wrap.appendChild(card);

  /* 펼치면 이번 행사에 잡아둔 약속 + 체크리스트 */
  const panel = el('div', 'ddpanel');
  const inner = el('div', 'ddpanel-in');
  inner.appendChild(el('div', 'panel-lb', `<span>${t('sched.ahead')}</span><span>${ahead.length ? t('sched.count', { n: ahead.length }) : t('sched.none')}</span>`));
  ahead.slice(0, 5).forEach(x => inner.appendChild(subRow(e, x)));
  if (ahead.length > 5) {
    inner.appendChild(el('div', 'subrow', `<span class="tm"></span><span class="grow"><span class="mm">${t('sched.aheadMore', { n: ahead.length - 5 })}</span></span>`));
  }
  const addSub = el('button', 'panel-btn', `${ic('plus', 15, 2.4)}${t('sched.subAdd')}`);
  addSub.onclick = () => subSheet(e, null, null);
  inner.appendChild(addSub);

  const ckBtn = el('button', 'panel-btn', `${ic('check', 15, 2.4)}${t('sched.checklist')}`
    + `<span class="rt">${pg.total ? `${pg.done}/${pg.total}` : t('sched.setup')}</span>${ic('chev', 15, 2.2)}`);
  ckBtn.onclick = () => openChecklist(e.id);
  inner.appendChild(ckBtn);

  panel.appendChild(inner);
  wrap.appendChild(panel);
  wireExpand('home:' + e.id, card, panel, exp);
  return wrap;
}

/* ---------- 일정 탭 ---------- */

let catFilter = null;

export function renderSchedule() {
  const sc = $('#sched-body');
  if (!sc) return;
  keepScroll(sc, () => paintSchedule(sc));
}

function paintSchedule(sc) {
  sc.innerHTML = '';
  /* "행사 미상" 은 일정이 아니다 — 사진을 모아 두는 자리라 날짜가 없다.
     걸러 내지 않으면 날짜 미정 목록에 계속 끼어 있는다. */
  const all = [...S.cat.events].filter(e => !e.unknown);
  const match = e => !catFilter || (e.tags || []).includes(catFilter);

  const up = all.filter(e => e.date && !isDone(e)).sort((a, b) => a.date.localeCompare(b.date));
  const past = all.filter(e => e.date && isDone(e)).sort((a, b) => b.date.localeCompare(a.date));
  const undated = all.filter(e => !e.date);

  const top = el('div', 'sec');
  top.style.paddingTop = '2px';
  top.appendChild(ddayCard());
  sc.appendChild(top);

  /* 다가오는 일정 — 헤더 옆에서 카테고리로 걸러 본다 */
  if (up.length) {
    const upF = up.filter(match);
    const s = el('div', 'sec');
    const lb = el('div', 'sec-lb');
    lb.innerHTML = `<h2>${t('sched.upcoming')}</h2>`;
    const pick = el('button', 'catpick' + (catFilter ? ' on' : ''),
      catFilter
        ? `<span class="cat c-${catColor(catFilter)} sm">${esc(catFilter)}</span>${ic('x', 13, 2.6)}`
        : `${t('sched.category')}${ic('chev', 13, 2.4)}`);
    pick.onclick = () => {
      if (catFilter) { catFilter = null; renderSchedule(); return; }
      catPickSheet(v => { catFilter = v; renderSchedule(); });
    };
    lb.appendChild(pick);
    s.appendChild(lb);

    if (!upF.length) {
      s.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t('sched.noneInCat')}</span>`));
    } else {
      const box = el('div', 'stagger');
      upF.forEach(e => box.appendChild(eventBlock(e, true)));
      s.appendChild(box);
      th.warm(box.querySelectorAll('img[data-fid]'), 6);
    }
    sc.appendChild(s);
  }

  const section = (label, list) => {
    const l = list.filter(match);
    if (!l.length) return;
    const s = el('div', 'sec');
    s.appendChild(el('div', 'sec-lb', `<h2>${label}</h2><span class="n">${l.length}</span>`));
    const box = el('div', 'stagger');
    l.forEach(e => box.appendChild(eventBlock(e, false)));
    s.appendChild(box);
    sc.appendChild(s);
    th.warm(box.querySelectorAll('img[data-fid]'), 4);
  };
  section(t('sched.noDate'), undated);
  section(t('sched.past'), past);

  const add = el('div', 'sec');
  add.style.marginTop = '18px';
  const b = el('button', 'btn', `${ic('plus', 19, 2.2)}${t('sched.evAdd')}`);
  b.onclick = () => eventSheet(null);
  add.appendChild(b);
  sc.appendChild(add);

  if (!all.length) {
    const n = el('div', 'sec');
    n.style.marginTop = '16px';
    n.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t('sched.evNote')}</span>`));
    sc.appendChild(n);
  }
  wireScroll();
}

function catPickSheet(apply) {
  const pool = S.cat.eventTags;
  openSheet(`<h3>${t('sched.byCategory')}</h3><p class="lead">${t('sched.byCategoryLead')}</p><div class="opts" id="cp"></div>`
    + `<button class="btn sub" id="cp-all" style="width:100%">${t('sched.showAll')}</button>`);
  const box = $('#cp');
  pool.forEach(tag => {
    const n = S.cat.events.filter(e => (e.tags || []).includes(tag.name) && e.date && !isDone(e)).length;
    const o = el('button', 'opt', `<span class="l"><span class="cat c-${tag.color}" style="pointer-events:none">${esc(tag.name)}</span></span>`
      + `<span class="n">${t('sched.count', { n })}</span><span class="c">${ic('chev', 17, 2.2)}</span>`);
    o.onclick = () => { apply(tag.name); closeSheet(); };
    box.appendChild(o);
  });
  if (!pool.length) box.innerHTML = `<div class="note">${ic('info', 17)}<span>${t('sched.noCat')}</span></div>`;
  $('#cp-all').onclick = () => { apply(null); closeSheet(); };
}

/** 행 + (약속이 있으면) 접었다 펼 수 있는 패널 */
function eventBlock(e, upcoming) {
  const list = photos().filter(p => p.event === e.id);
  const d = ddayLabel(e);
  const live = d.ph.state === 'during';
  const sl = subs(e);

  const wrap = el('div', 'evwrap');
  const r = el('div', 'ev'
    + (upcoming && !live ? ' up' : '')
    + (live ? ' live' : '')
    + (e.going === false ? ' maybe' : ''));

  const lead = e.logo
    ? `<img class="evlogo" alt="" src="${e.logo}">`
    : list.length
      ? `<img class="evlogo" data-fid="${list[0].id}" alt="">`
      : `<span class="evlogo none">${esc((e.name || '?').trim()[0] || '?')}</span>`;

  const meta = [fmtRange(e), e.place, list.length ? `${t('sched.photoCount', { n: fmt(list.length) })}` : null]
    .filter(Boolean).join(' · ');
  const chips = (e.going === false ? `<span class="cat c-gray sm">${t('sched.tbd')}</span>` : '')
    + (e.tags || []).map(tag => `<span class="cat c-${catColor(tag)} sm">${esc(tag)}</span>`).join('')
    + (sl.length ? `<span class="cat c-gray sm">${t('sched.subBadge', { n: sl.length })}</span>` : '');

  const body = el('button', 'ev-main');
  body.innerHTML = lead
    + `<span class="grow"><span class="nm">${live ? '<i class="live-dot"></i>' : ''}${esc(e.name)}</span>`
    + `<span class="m">${esc(meta)}</span>`
    + (chips ? `<span class="tt">${chips}</span>` : '')
    + `</span>`
    + `<span class="dd"><b>${d.big}</b><i>${esc(d.sub)}</i></span>`;
  body.onclick = () => openEvent(e.id);
  r.appendChild(body);
  wrap.appendChild(r);

  if (sl.length) {
    const exp = el('button', 'exp');
    exp.setAttribute('aria-label', t('sched.openSub'));
    exp.innerHTML = ic('chev', 18, 2.4);
    r.appendChild(exp);

    const panel = el('div', 'evpanel');
    const inner = el('div', 'evpanel-in');
    sl.forEach(x => inner.appendChild(subRow(e, x)));
    panel.appendChild(inner);
    wrap.appendChild(panel);
    wireExpand(e.id, r, panel, exp);
  }
  return wrap;
}

/* ---------- 일정 상세 ---------- */

export function openEvent(id) {
  push(t('tab.schedule'), sc => paintEvent(sc, id));
}

function paintEvent(sc, id) {
  const e = S.cat.events.find(x => x.id === id);
  if (!e) { sc.innerHTML = `<div class="sec" style="padding-top:40px"><div class="note bad">${t('sched.deleted')}</div></div>`; return; }
  keepScroll(sc, () => paint(sc, e, id));
}

function paint(sc, e, id) {
  sc.innerHTML = '';
  const d = ddayLabel(e);
  const live = d.ph.state === 'during';
  const n = photos().filter(p => p.event === e.id).length;

  const hd = el('div', 'gtitle');
  hd.innerHTML = (e.logo ? `<img class="evlogo big" alt="" src="${e.logo}" style="margin-bottom:12px">` : '')
    + `<h2>${esc(e.name)}</h2>`
    + `<div class="m">${esc([fmtRange(e), e.place].filter(Boolean).join(' · '))}</div>`
    + `<div class="x">${live ? '<i class="live-dot"></i>' : ''}${d.big}${d.sub ? ` · ${d.sub}` : ''}</div>`;
  sc.appendChild(hd);

  /* 참가 확정 — 갈까 말까 하는 행사를 등록만 해두고 나중에 확정한다 */
  const g = el('div', 'sec');
  g.style.marginTop = '16px';
  const gbox = el('div', 'card');
  const grow = el('div', 'row',
    `<span class="row-ico" style="${e.going === false
      ? 'background:var(--fill);color:var(--g500)'
      : 'background:var(--green-fill);color:var(--green)'}">${ic('check', 18, 2.4)}</span>`
    + `<span class="grow"><span class="t">${t(e.going === false ? 'sched.goingNo' : 'sched.goingYes')}</span>`
    + `<span class="d">${e.going === false
      ? t('sched.goingNoDesc')
      : t('sched.goingYesDesc')}</span></span>`);
  const sw = el('button', 'sw' + (e.going !== false ? ' on' : ''), '<i></i>');
  sw.setAttribute('aria-pressed', String(e.going !== false));
  sw.onclick = () => {
    // 제자리에서 뒤집고, 이 행의 문구만 갈아 준다
    e.going = flipSwitch(sw, e.going === false);
    const tn = grow.querySelector('.t');
    const d = grow.querySelector('.d');
    const ico = grow.parentElement.querySelector('.row-ico');
    if (tn) tn.textContent = e.going ? t('sched.goingYes') : t('sched.goingNo');
    if (d) d.textContent = e.going ? t('sched.goingYesDesc') : t('sched.goingNoDesc');
    if (ico) ico.style.cssText = e.going
      ? 'background:var(--green-fill);color:var(--green)'
      : 'background:var(--fill);color:var(--g500)';
    touch();
    renderHome();
    renderSchedule();
    toast(e.going ? t('sched.toGoingYes') : t('sched.toGoingNo'));
  };
  grow.appendChild(sw);
  gbox.appendChild(grow);
  g.appendChild(gbox);
  sc.appendChild(g);

  if (e.note) {
    const nn = el('div', 'sec');
    nn.style.marginTop = '14px';
    nn.appendChild(el('div', 'note', `${ic('info', 17)}<span>${esc(e.note)}</span>`));
    sc.appendChild(nn);
  }

  /* 행사 안의 약속 */
  const sl = subs(e);
  const ss = el('div', 'sec');
  ss.appendChild(el('div', 'sec-lb', `<h2>${t('sched.subsInEvent')}</h2><span class="n">${t('sched.count', { n: sl.length })}</span>`));
  const sbox = el('div', 'card');
  if (sl.length) {
    if (dayCount(e) > 1) {
      const byDay = new Map();
      sl.forEach(x => {
        const k = x.day || e.date;
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(x);
      });
      [...byDay.keys()].sort().forEach(k => {
        sbox.appendChild(el('div', 'daylb', `${t('sched.dayN', { n: diff(k, e.date) + 1 })} · ${fmtDate(k).slice(5)}`));
        byDay.get(k).forEach(x => sbox.appendChild(subRow(e, x, () => paint(sc, e, id))));
      });
    } else {
      sl.forEach(x => sbox.appendChild(subRow(e, x, () => paint(sc, e, id))));
    }
  } else {
    sbox.appendChild(el('div', 'subrow', `<span class="tm"></span><span class="grow"><span class="mm">${t('sched.subNone')}</span></span>`));
  }
  ss.appendChild(sbox);
  const addSub = el('button', 'btn sub', `${ic('plus', 17, 2.2)}${t('sched.subAdd')}`);
  addSub.style.cssText = 'width:100%;margin-top:12px';
  addSub.onclick = () => subSheet(e, null, () => paint(sc, e, id));
  ss.appendChild(addSub);
  sc.appendChild(ss);

  /* 체크리스트 */
  const pg = progress(e);
  const s1 = el('div', 'sec');
  s1.style.marginTop = '24px';
  const strip = el('button', 'strip blue', `<span class="k">${t('sched.checklist')}</span>`
    + `<span class="v">${pg.total ? `${pg.done}/${pg.total}` : t('sched.setup')}</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
  strip.onclick = () => openChecklist(e.id);
  s1.appendChild(strip);
  sc.appendChild(s1);

  /* 행사 카테고리 */
  const ts = el('div', 'sec');
  ts.appendChild(el('div', 'sec-lb', `<h2>${t('sched.evCats')}</h2><span class="n">${t('sched.evCatsSub')}</span>`));
  const tw = el('div', 'tagwrap');
  (e.tags || []).forEach(tag => {
    const c = el('button', `cat c-${catColor(tag)}`, `${esc(tag)}<span class="x">${ic('x', 13, 2.6)}</span>`);
    c.onclick = () => { e.tags = e.tags.filter(x => x !== tag); touch(); paint(sc, e, id); renderSchedule(); };
    tw.appendChild(c);
  });
  const addT = el('button', 'tg add', `${ic('check', 14, 2.4)}${t('sched.pickCat')}`);
  addT.onclick = () => eventCatSheet(e, () => paint(sc, e, id));
  tw.appendChild(addT);
  const mkT = el('button', 'tg add', `${ic('plus', 14, 2.4)}${t('sched.makeCat')}`);
  mkT.onclick = () => catSheet(null, name => {
    if (name) { e.tags = [...new Set([...(e.tags || []), name])]; touch(); }
    paint(sc, e, id);
  });
  tw.appendChild(mkT);
  ts.appendChild(tw);
  sc.appendChild(ts);

  /* 사진사 — 이 행사에 누가 찍었는지, 그리고 아직 안 정한 것 */
  if (n) {
    const list = photos().filter(p => p.event === e.id);
    const crew = [...new Set(list.map(p => p.shooter).filter(Boolean))]
      .map(id => ({ sh: shooterById(id), cnt: list.filter(p => p.shooter === id).length }))
      .filter(x => x.sh).sort((a, b) => b.cnt - a.cnt);

    const ss2 = el('div', 'sec');
    ss2.appendChild(el('div', 'sec-lb', `<h2>${t('sched.shooters')}</h2><span class="n">${t('sched.shooterCount', { n: crew.length })}</span>`));
    const sbox2 = el('div', 'card');

    crew.forEach(({ sh, cnt }) => {
      const r = el('button', 'row');
      r.innerHTML = avatarHTML(sh.name, sh.avatar)
        + `<span class="grow"><span class="t">${esc(sh.name)}</span>`
        + `<span class="d${sh.x ? ' x' : ''}">${sh.x ? '@' + esc(sh.x) : t('common.noXId')}</span></span>`
        + `<span class="n-sm">${t('common.photoN', { n: fmt(cnt) })}</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
      r.onclick = () => {
        V.filter = { ...NO_FILTER(), event: e.id, shooter: sh.id };
        V.limit = 90;
        goTab('photos');
        popAll();
      };
      sbox2.appendChild(r);
    });

    /* 카메라 모델별로 묶어 제안한다. 같은 바디로 찍힌 사진은 대개 같은
       사진사라, 여기서 한 번 지정하면 그 묶음이 통째로 정리된다.
       이게 홈의 "확인할 것" 카메라→사진사 제안이 학습할 씨앗도 된다. */
    const byCam = new Map();
    list.filter(p => !p.shooter).forEach(p => {
      const k = p.cameraModel || t('sched.noCamera');
      if (!byCam.has(k)) byCam.set(k, []);
      byCam.get(k).push(p.id);
    });
    [...byCam.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([cam, ids]) => {
      const r = el('button', 'row');
      r.innerHTML = `<span class="row-ico" style="background:var(--amber-fill);color:var(--amber)">${ic('cam', 18)}</span>`
        + `<span class="grow"><span class="t" style="color:var(--amber)">${t('sched.assignShooter')}</span>`
        + `<span class="d">${esc(cam)}</span></span>`
        + `<span class="n-sm">${t('common.photoN', { n: fmt(ids.length) })}</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
      /* 바로 할당 화면을 띄우지 않는다 — 같은 카메라라도 남의 것을 잠깐
         쓴 컷이 섞인다. 먼저 어떤 사진인지 보여주고 아닌 것을 빼게 한 뒤,
         남은 것에만 사진사를 고른다. 사진을 보고 나서야 누가 찍었는지
         판단이 되는 경우가 대부분이다. */
      r.onclick = () => {
        reviewSheet({
          title: esc(cam),
          ids,
          okKey: 'sug.reviewPick',
          onApply: keep => {
            V.sel = new Set(keep);
            assignSheet('shooter', () => { paint(sc, e, id); renderAll(); });
          },
        });
      };
      sbox2.appendChild(r);
    });

    ss2.appendChild(sbox2);
    sc.appendChild(ss2);
  }

  /* 사진 */
  const ps = el('div', 'sec');
  ps.appendChild(el('div', 'sec-lb', `<h2>${t('sched.thisEventPhotos')}</h2><span class="n">${t('common.photoN', { n: fmt(n) })}</span>`));
  const pb = el('div', 'card');
  const pr = el('button', 'row', `<span class="row-ico">${ic('grid', 18)}</span>`
    + `<span class="grow"><span class="t">${t(n ? 'sched.viewPhotos' : 'sched.noPhotos')}</span>`
    + `<span class="d">${t(n ? 'sched.filterInPhotos' : 'sched.assignHint')}</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
  pr.onclick = () => {
    V.filter = { ...NO_FILTER(), event: e.id };
    V.limit = 90;
    goTab('photos');
    popAll();
  };
  pb.appendChild(pr);
  ps.appendChild(pb);
  sc.appendChild(ps);

  /* 로고 · 편집 · 삭제 */
  const act = el('div', 'sec');
  act.style.cssText = 'margin-top:20px;display:flex;flex-direction:column;gap:8px';
  const lg = el('button', 'btn sub', `${ic('grid', 17, 2)}${t('sched.logo', { act: t(e.logo ? 'sched.change' : 'sched.setup') })}`);
  lg.style.width = '100%';
  lg.onclick = () => logoSheet(e, () => paint(sc, e, id));
  const ed = el('button', 'btn sub', `${ic('cal', 17, 2)}${t('sched.evEdit')}`);
  ed.style.width = '100%';
  ed.onclick = () => eventSheet(e, () => paint(sc, e, id));
  const del = el('button', 'btn danger', `${ic('trash', 17, 2)}${t('sched.evDelete')}`);
  del.onclick = () => confirmSheet({
    title: t('sched.evDeleteQ'), danger: true, ok: t('common.delete'),
    lead: n
      ? `${t('sched.evDeleteLeadN', { n: fmt(n) })}`
      : t('sched.evDeleteLead'),
    onOk: () => {
      S.cat.events = S.cat.events.filter(x => x.id !== id);
      Object.values(S.cat.photos).forEach(p => { if (p.event === id) p.event = null; });
      markDeleted('events', id);
      touchNow();          // 삭제는 미루지 않는다 — 지연 저장이 끊기면 되살아난다
      popAll();
      renderAll();
      toast(t('sched.evDeleted'));
    },
  });
  act.appendChild(lg);
  act.appendChild(ed);
  act.appendChild(del);
  sc.appendChild(act);
}

/* ---------- 일정 추가 / 편집 ---------- */

export function eventSheet(e, after) {
  const isNew = !e;
  let multi = !!(e && e.endDate);
  let going = e ? e.going !== false : true;

  const render = () => {
    openSheet(`<h3>${t(isNew ? 'sched.evAdd' : 'sched.evEdit')}</h3>`
      + `<p class="lead">${isNew ? t('sched.evLead') : ''}</p>`
      + `<div class="fld"><label for="ev-name">${t('sched.evName')}</label>`
      + `<input id="ev-name" maxlength="60" value="${esc(e ? e.name : '')}" placeholder="${t('sched.evNamePh')}"></div>`
      + `<div class="fld"><label>${t('sched.period')}</label><div id="ev-seg"></div></div>`
      + `<div class="fld"><label for="ev-date">${t(multi ? 'sched.startDate' : 'sched.date')}</label>`
      + `<input id="ev-date" type="date" value="${e && e.date ? e.date : ''}"></div>`
      + (multi
        ? `<div class="fld"><label for="ev-end">${t('sched.endDate')}</label>`
          + `<input id="ev-end" type="date" value="${e && e.endDate ? e.endDate : ''}">`
          + `<div class="hint">${t('sched.endHint')}</div></div>`
        : '')
      + `<div class="fld"><label for="ev-place">${t('sched.placeOpt')}</label>`
      + `<input id="ev-place" maxlength="40" value="${esc(e && e.place ? e.place : '')}" placeholder="${t('sched.placePh')}"></div>`
      + `<div class="fld"><label for="ev-note">${t('sched.noteOpt')}</label>`
      + `<input id="ev-note" maxlength="80" value="${esc(e && e.note ? e.note : '')}" placeholder="${t('sched.notePh2')}"></div>`
      + `<div class="fld"><label>${t('sched.going')}</label><div id="ev-go"></div>`
      + `<div class="hint">${t('sched.goingHint')}</div></div>`
      + `<button class="btn" id="ev-save">${t(isNew ? 'common.add' : 'common.save')}</button>`);

    /* 기간 전환 시 입력값을 잃지 않도록 옮겨 담는다 */
    $('#ev-seg').appendChild(segment([['one', t('sched.oneDay')], ['many', t('sched.multiDay')]], multi ? 'many' : 'one', v => {
      const keep = {
        name: $('#ev-name').value, date: $('#ev-date').value,
        end: $('#ev-end') ? $('#ev-end').value : '',
        place: $('#ev-place').value, note: $('#ev-note').value,
      };
      multi = v === 'many';
      render();
      $('#ev-name').value = keep.name;
      $('#ev-date').value = keep.date;
      if ($('#ev-end')) $('#ev-end').value = keep.end;
      $('#ev-place').value = keep.place;
      $('#ev-note').value = keep.note;
    }));
    $('#ev-seg .segwrap').style.padding = '0';

    const goSeg = segment([['yes', t('sched.confirmed')], ['maybe', t('sched.tbd')]], going ? 'yes' : 'maybe', v => {
      going = v === 'yes';
      const seg = goSeg.querySelector('.seg');
      seg.style.setProperty('--i', going ? '0' : '1');
      seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === (going ? 0 : 1)));
    });
    $('#ev-go').appendChild(goSeg);
    goSeg.style.padding = '0';

    $('#ev-save').onclick = () => {
      const nm = $('#ev-name');
      const name = nm.value.trim();
      if (!name) { nm.focus(); return; }
      const date = $('#ev-date').value || null;
      let endDate = multi && $('#ev-end') ? ($('#ev-end').value || null) : null;
      if (endDate && date && endDate <= date) endDate = null;
      const place = $('#ev-place').value.trim() || null;
      const note = $('#ev-note').value.trim() || null;
      if (isNew) {
        addEvent(name, date, place, { endDate, note, going });
      } else {
        Object.assign(e, { name, date, endDate, place, note, going });
        // 기간이 줄어 범위를 벗어난 약속은 시작일로 당긴다
        if (e.sub) {
          const last = e.endDate || e.date;
          e.sub.forEach(x => {
            if (!x.day || !e.date) return;
            if (x.day < e.date || (last && x.day > last)) x.day = e.date;
          });
        }
      }
      touch();
      closeSheet();
      toast(isNew ? t('sched.evAdded', { name }) : t('common.saved'));
      if (after) after();
      renderAll();
    };
    if (isNew) setTimeout(() => $('#ev-name').focus(), 340);
  };
  render();
}

/* ---------- 카테고리 고르기 ---------- */

function eventCatSheet(e, after) {
  const pool = S.cat.eventTags;
  openSheet(`<h3>${t('sched.evCats')}</h3><p class="lead">${t('sched.evCatsLead')}</p>`
    + `<div class="opts" id="et-list"></div>`
    + `<button class="btn sub" id="et-new" style="width:100%">${ic('plus', 17, 2.2)}${t('sched.makeCat')}</button>`);
  const box = $('#et-list');
  const paintList = () => {
    box.innerHTML = '';
    pool.forEach(tag => {
      const on = (e.tags || []).includes(tag.name);
      const o = el('button', 'opt' + (on ? ' on' : ''),
        `<span class="l"><span class="cat c-${tag.color}" style="pointer-events:none">${esc(tag.name)}</span></span>`
        + `<span class="c">${ic('check', 18, 2.8)}</span>`);
      o.onclick = () => {
        e.tags = on ? e.tags.filter(x => x !== tag.name) : [...(e.tags || []), tag.name];
        touch(); paintList(); if (after) after(); renderSchedule();
      };
      box.appendChild(o);
    });
    if (!pool.length) box.innerHTML = `<div class="note">${ic('info', 17)}<span>${t('sched.makeCatFirst')}</span></div>`;
  };
  paintList();
  $('#et-new').onclick = () => catSheet(null, name => {
    if (name) { e.tags = [...new Set([...(e.tags || []), name])]; touch(); }
    if (after) after();
    eventCatSheet(e, after);
  });
}

/* ---------- 체크리스트 ---------- */

export function openChecklist(id) {
  push(t('sched.checklist'), sc => paintChecklist(sc, id));
}

function paintChecklist(sc, id) {
  const e = S.cat.events.find(x => x.id === id);
  if (!e) { sc.innerHTML = `<div class="sec" style="padding-top:40px"><div class="note bad">${t('sched.deleted')}</div></div>`; return; }
  keepScroll(sc, () => {
    sc.innerHTML = '';
    const d = ddayLabel(e);
    const hd = el('div', 'gtitle');
    hd.innerHTML = `<h2>${esc(e.name)}</h2><div class="m">${esc([fmtRange(e), d.sub].filter(Boolean).join(' · '))}</div>`;
    sc.appendChild(hd);

    /* 사전 준비 */
    const prep = e.prep || (e.prep = []);
    const s1 = el('div', 'sec');
    s1.appendChild(ckHead(t('sched.prep'), prepDone(e), prep.length));
    const b1 = el('div', 'card');
    prep.forEach(item => {
      const r = el('button', 'ck-row' + (item.done ? ' on' : ''), `<span class="ck-box">${ic('check', 14, 3)}</span><span class="tx">${esc(item.text)}</span>`);
      const del = el('span', 'del', ic('x', 15, 2.4));
      del.onclick = ev => {
        ev.stopPropagation();
        e.prep = prep.filter(x => x.id !== item.id);
        touch(); paintChecklist(sc, id);
      };
      r.appendChild(del);
      r.onclick = () => { item.done = !item.done; touch(); paintChecklist(sc, id); renderAll(); };
      b1.appendChild(r);
    });
    if (!prep.length) b1.appendChild(el('div', 'ck-row', `<span class="tx" style="color:var(--g500);font-weight:600">${t('sched.subNone')}</span>`));
    s1.appendChild(b1);
    const ar = el('div', 'addrow');
    ar.style.marginTop = '10px';
    ar.innerHTML = `<input id="pp-in" placeholder="${t('sched.todoPh')}" maxlength="40"><button id="pp-add">${t('common.add')}</button>`;
    s1.appendChild(ar);
    sc.appendChild(s1);
    const addPrep = () => {
      const v = ar.querySelector('#pp-in').value.trim();
      if (!v) return;
      prep.push({ id: uid('q'), text: v, done: false });
      touch();
      paintChecklist(sc, id);
    };
    ar.querySelector('#pp-add').onclick = addPrep;
    ar.querySelector('#pp-in').addEventListener('keydown', ev => { if (ev.key === 'Enter') addPrep(); });

    /* 짐 챙기기 */
    const packing = S.cat.packing;
    const packed = e.packed || (e.packed = []);
    const s2 = el('div', 'sec');
    s2.appendChild(ckHead(t('sched.packing'), packDone(e), packing.length));
    const b2 = el('div', 'card');
    packing.forEach(item => {
      const on = packed.includes(item.id);
      const r = el('button', 'ck-row' + (on ? ' on' : ''), `<span class="ck-box">${ic('check', 14, 3)}</span><span class="tx">${esc(item.text)}</span>`);
      r.onclick = () => {
        e.packed = on ? packed.filter(x => x !== item.id) : [...packed, item.id];
        touch(); paintChecklist(sc, id); renderAll();
      };
      b2.appendChild(r);
    });
    if (!packing.length) b2.appendChild(el('div', 'ck-row', `<span class="tx" style="color:var(--g500);font-weight:600">${t('sched.sharedEmpty')}</span>`));
    s2.appendChild(b2);
    const go = el('button', 'btn sub', `${ic('sliders', 17, 2)}${t('sched.editShared')}`);
    go.style.cssText = 'width:100%;margin-top:12px';
    go.onclick = () => openPacking();
    s2.appendChild(go);
    sc.appendChild(s2);

    const reset = el('div', 'sec');
    reset.style.marginTop = '18px';
    const rb = el('button', 'btn sub', `${ic('refresh', 17, 2)}${t('sched.clearThisEvent')}`);
    rb.style.width = '100%';
    rb.onclick = () => confirmSheet({
      title: t('sched.clearChecksQ'), ok: t('sched.clearAll'), danger: true,
      lead: t('sched.clearChecksLead'),
      onOk: () => {
        e.packed = [];
        (e.prep || []).forEach(x => { x.done = false; });
        touch(); paintChecklist(sc, id); renderAll(); toast(t('sched.checksCleared'));
      },
    });
    reset.appendChild(rb);
    sc.appendChild(reset);
  });
}

function ckHead(label, done, total) {
  const all = total > 0 && done === total;
  return el('div', 'ck-head', `<h2>${label}</h2>`
    + `<span class="pg"><span class="bar"><i style="width:${total ? (done / total) * 100 : 0}%"></i></span>`
    + `<span class="${all ? 'all' : ''}">${done}/${total}</span></span>`);
}

/* ---------- 짐 챙기기 공용 목록 ---------- */

export function openPacking() {
  push(t('sched.packingList'), sc => paintPacking(sc));
}

function paintPacking(sc) {
  keepScroll(sc, () => {
    sc.innerHTML = '';
    const list = S.cat.packing;
    const hd = el('div', 'gtitle');
    hd.innerHTML = `<h2>${t('sched.packingList')}</h2><div class="m">${t('sched.packingLead')}</div>`;
    sc.appendChild(hd);

    const s = el('div', 'sec');
    s.style.marginTop = '18px';
    const ar = el('div', 'addrow');
    ar.innerHTML = `<input id="pk-in" placeholder="${t('sched.packPh')}" maxlength="40"><button id="pk-add">${t('common.add')}</button>`;
    s.appendChild(ar);

    const box = el('div', 'card');
    box.style.marginTop = '12px';
    list.forEach((item, i) => {
      const r = el('div', 'ck-row');
      r.innerHTML = `<span class="ck-box" style="background:var(--fill);color:var(--g400)">${ic('check', 14, 3)}</span>`
        + `<span class="tx">${esc(item.text)}</span>`;
      const up = el('span', 'del', ic('chevL', 15, 2.4));
      up.style.transform = 'rotate(90deg)';
      up.onclick = () => {
        if (i === 0) return;
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        touch(); paintPacking(sc);
      };
      const del = el('span', 'del', ic('x', 15, 2.4));
      del.onclick = () => {
        const used = S.cat.events.filter(e => (e.packed || []).includes(item.id)).length;
        confirmSheet({
          title: t('sched.delItemQ', { name: item.text }), danger: true, ok: t('common.delete'),
          lead: used ? t('sched.delItemUsed', { n: used }) : t('sched.packingGone'),
          onOk: () => {
            S.cat.packing = list.filter(x => x.id !== item.id);
            S.cat.events.forEach(e => { if (e.packed) e.packed = e.packed.filter(x => x !== item.id); });
            markDeleted('packing', item.id);
            touchNow();
            paintPacking(sc); renderAll();
          },
        });
      };
      r.appendChild(up);
      r.appendChild(del);
      box.appendChild(r);
    });
    if (!list.length) box.appendChild(el('div', 'ck-row', `<span class="tx" style="color:var(--g500);font-weight:600">${t('sched.noItems')}</span>`));
    s.appendChild(box);
    sc.appendChild(s);

    const add = () => {
      const v = ar.querySelector('#pk-in').value.trim();
      if (!v) return;
      if (list.some(x => x.text === v)) { toast(t('sched.dupItem')); return; }
      list.push({ id: uid('pk'), text: v });
      touch();
      paintPacking(sc);
    };
    ar.querySelector('#pk-add').onclick = add;
    ar.querySelector('#pk-in').addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });

    const n = el('div', 'sec');
    n.style.marginTop = '20px';
    n.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t('sched.defaultNote')}</span>`));
    sc.appendChild(n);
  });
}
