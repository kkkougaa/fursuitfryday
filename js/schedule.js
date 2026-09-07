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
import { S, touch, addEvent, photos, uid, catColor, shooterById } from './store.js';
import * as th from './thumbs.js';
import {
  $, el, ic, esc, fmt, push, popAll, openSheet, closeSheet,
  toast, confirmSheet, wireScroll, keepScroll, segment, flipSwitch,
} from './ui.js';
import { V, NO_FILTER, goTab, renderAll, renderHome, assignSheet } from './screens.js';
import { catSheet, logoSheet } from './screens2.js';
import { avatarHTML } from './ui.js';

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
  if (!e.date) return '날짜 미정';
  if (!e.endDate) return fmtDate(e.date);
  const [sy, sm] = e.date.split('-');
  const [ey, em, ed] = e.endDate.split('-');
  const tail = (sy === ey && sm === em) ? ed : (sy === ey ? `${em}.${ed}` : fmtDate(e.endDate));
  return `${fmtDate(e.date)} – ${tail} · ${dayCount(e)}일`;
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
  if (ph.state === 'none') return { big: '–', sub: '미정', ph };
  if (ph.state === 'before') return { big: `D-${ph.n}`, sub: `${ph.n}일 남음`, ph };
  if (ph.state === 'after') return { big: `D+${ph.n}`, sub: `${ph.n}일 지남`, ph };
  return ph.of > 1
    ? { big: `${ph.idx}일차`, sub: `${ph.of}일 중`, ph }
    : { big: '오늘', sub: '진행 중', ph };
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
  const dayLb = multi && x.day ? `${diff(x.day, e.date) + 1}일차` : '';
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
    multi && x.day ? `${diff(x.day, e.date) + 1}일차 · ${fmtDate(x.day).slice(5)}` : fmtDate(x.day || e.date),
    x.time || null,
  ].filter(Boolean).join(' · ');
  openSheet(`<h3>${esc(x.title)}</h3><p class="lead">${esc(e.name)}</p>`
    + `<dl class="kv"><div><dt>언제</dt><dd>${esc(when || '미정')}</dd></div>`
    + (x.place ? `<div><dt>어디</dt><dd>${esc(x.place)}</dd></div>` : '')
    + `</dl>`
    + (x.note
      ? `<div class="fld" style="margin-top:14px"><label>메모</label><pre class="pv">${esc(x.note)}</pre></div>`
      : `<div class="note" style="margin-top:14px">${ic('info', 17)}<span>메모가 없어요. 아래에서 적을 수 있습니다.</span></div>`)
    + `<button class="btn" id="sv-edit" style="margin-top:16px">${ic('cal', 18, 2.1)}편집</button>`
    + `<button class="btn sub" id="sv-go" style="width:100%;margin-top:8px">${ic('chev', 17, 2.2)}행사 열기</button>`);
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
      days.push({ key, label: `${i + 1}일차 · ${fmtDate(key).slice(5)}` });
    }
  }
  openSheet(`<h3>${isNew ? '약속 추가' : '약속 편집'}</h3>`
    + `<p class="lead">${esc(e.name)} 안에서 잡은 약속입니다.</p>`
    + `<div class="fld"><label for="sb-t">무엇</label>`
    + `<input id="sb-t" maxlength="40" value="${esc(x ? x.title : '')}" placeholder="예: 단체 사진 촬영"></div>`
    + (multi && days.length
      ? `<div class="fld"><label for="sb-d">며칠차</label><select id="sb-d">`
        + days.map(d => `<option value="${d.key}"${(x ? x.day : e.date) === d.key ? ' selected' : ''}>${d.label}</option>`).join('')
        + `</select></div>`
      : '')
    + `<div class="fld"><label for="sb-h">시각 (선택)</label>`
    + `<input id="sb-h" type="time" value="${esc(x && x.time ? x.time : '')}"></div>`
    + `<div class="fld"><label for="sb-p">장소 (선택)</label>`
    + `<input id="sb-p" maxlength="30" value="${esc(x && x.place ? x.place : '')}" placeholder="예: 3홀 포토존"></div>`
    + `<div class="fld"><label for="sb-n">메모 (선택)</label>`
    + `<textarea id="sb-n" maxlength="300" rows="3" placeholder="누구와 · 준비물 · 기억할 것">${esc(x && x.note ? x.note : '')}</textarea>`
    + `<div class="hint">일정 목록에서 약속을 누르면 이 메모가 보입니다.</div></div>`
    + `<button class="btn" id="sb-save">${isNew ? '추가' : '저장'}</button>`);

  const t = $('#sb-t');
  $('#sb-save').onclick = () => {
    const title = t.value.trim();
    if (!title) { t.focus(); return; }
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
    toast(isNew ? '약속을 추가했어요' : '저장했어요');
    if (after) after();
    renderAll();
  };
  setTimeout(() => t.focus(), 340);
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
    const b = el('button', 'strip', `<span class="k">다음 행사를 등록해 주세요</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
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
    + `<span class="k">${live ? '<i class="live-dot"></i>행사 진행 중'
      : e.going === false ? '참가 미정' : '다음 행사'}</span>`
    + `<span class="nm">${esc(e.name)}</span>`
    + `<span class="m">${esc(bits)}${pg.total ? ` · 준비 ${pg.done}/${pg.total}` : ''}</span></span>`;
  main.onclick = () => openEvent(e.id);

  const num = el('div', 'num', `<b>${d.big}</b><i>${esc(d.sub)}</i>`);

  const exp = el('button', 'exp');
  exp.setAttribute('aria-label', '펼쳐 보기');
  exp.innerHTML = ic('chev', 20, 2.4);

  card.appendChild(main);
  card.appendChild(num);
  card.appendChild(exp);
  wrap.appendChild(card);

  /* 펼치면 이번 행사에 잡아둔 약속 + 체크리스트 */
  const panel = el('div', 'ddpanel');
  const inner = el('div', 'ddpanel-in');
  inner.appendChild(el('div', 'panel-lb', `<span>잡아둔 약속</span><span>${ahead.length ? `${ahead.length}건` : '없음'}</span>`));
  ahead.slice(0, 5).forEach(x => inner.appendChild(subRow(e, x)));
  if (ahead.length > 5) {
    inner.appendChild(el('div', 'subrow', `<span class="tm"></span><span class="grow"><span class="mm">+${ahead.length - 5}건 더</span></span>`));
  }
  const addSub = el('button', 'panel-btn', `${ic('plus', 15, 2.4)}약속 추가`);
  addSub.onclick = () => subSheet(e, null, null);
  inner.appendChild(addSub);

  const ckBtn = el('button', 'panel-btn', `${ic('check', 15, 2.4)}체크리스트`
    + `<span class="rt">${pg.total ? `${pg.done}/${pg.total}` : '설정'}</span>${ic('chev', 15, 2.2)}`);
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
  const all = [...S.cat.events];
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
    lb.innerHTML = `<h2>다가오는 일정</h2>`;
    const pick = el('button', 'catpick' + (catFilter ? ' on' : ''),
      catFilter
        ? `<span class="cat c-${catColor(catFilter)} sm">${esc(catFilter)}</span>${ic('x', 13, 2.6)}`
        : `카테고리${ic('chev', 13, 2.4)}`);
    pick.onclick = () => {
      if (catFilter) { catFilter = null; renderSchedule(); return; }
      catPickSheet(v => { catFilter = v; renderSchedule(); });
    };
    lb.appendChild(pick);
    s.appendChild(lb);

    if (!upF.length) {
      s.appendChild(el('div', 'note', `${ic('info', 17)}<span>이 카테고리에 해당하는 다가오는 일정이 없어요.</span>`));
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
  section('날짜 미정', undated);
  section('지난 일정', past);

  const add = el('div', 'sec');
  add.style.marginTop = '18px';
  const b = el('button', 'btn', `${ic('plus', 19, 2.2)}일정 추가`);
  b.onclick = () => eventSheet(null);
  add.appendChild(b);
  sc.appendChild(add);

  if (!all.length) {
    const n = el('div', 'sec');
    n.style.marginTop = '16px';
    n.appendChild(el('div', 'note', `${ic('info', 17)}<span>일정은 사진의 <b>행사</b>와 같은 목록입니다. 여기서 만든 일정이 사진 분류에도 바로 쓰여요.</span>`));
    sc.appendChild(n);
  }
  wireScroll();
}

function catPickSheet(apply) {
  const pool = S.cat.eventTags;
  openSheet(`<h3>카테고리로 보기</h3><p class="lead">다가오는 일정만 골라 봅니다.</p><div class="opts" id="cp"></div>`
    + `<button class="btn sub" id="cp-all" style="width:100%">전체 보기</button>`);
  const box = $('#cp');
  pool.forEach(t => {
    const n = S.cat.events.filter(e => (e.tags || []).includes(t.name) && e.date && !isDone(e)).length;
    const o = el('button', 'opt', `<span class="l"><span class="cat c-${t.color}" style="pointer-events:none">${esc(t.name)}</span></span>`
      + `<span class="n">${n}건</span><span class="c">${ic('chev', 17, 2.2)}</span>`);
    o.onclick = () => { apply(t.name); closeSheet(); };
    box.appendChild(o);
  });
  if (!pool.length) box.innerHTML = `<div class="note">${ic('info', 17)}<span>아직 카테고리가 없어요. 일정 안에서 만들 수 있습니다.</span></div>`;
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

  const meta = [fmtRange(e), e.place, list.length ? `사진 ${fmt(list.length)}장` : null]
    .filter(Boolean).join(' · ');
  const chips = (e.going === false ? `<span class="cat c-gray sm">미정</span>` : '')
    + (e.tags || []).map(t => `<span class="cat c-${catColor(t)} sm">${esc(t)}</span>`).join('')
    + (sl.length ? `<span class="cat c-gray sm">약속 ${sl.length}</span>` : '');

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
    exp.setAttribute('aria-label', '약속 펼치기');
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
  push('일정', sc => paintEvent(sc, id));
}

function paintEvent(sc, id) {
  const e = S.cat.events.find(x => x.id === id);
  if (!e) { sc.innerHTML = `<div class="sec" style="padding-top:40px"><div class="note bad">삭제된 일정입니다.</div></div>`; return; }
  keepScroll(sc, () => paint(sc, e, id));
}

function paint(sc, e, id) {
  sc.innerHTML = '';
  const d = ddayLabel(e);
  const live = d.ph.state === 'during';
  const n = photos().filter(p => p.event === e.id).length;

  const t = el('div', 'gtitle');
  t.innerHTML = (e.logo ? `<img class="evlogo big" alt="" src="${e.logo}" style="margin-bottom:12px">` : '')
    + `<h2>${esc(e.name)}</h2>`
    + `<div class="m">${esc([fmtRange(e), e.place].filter(Boolean).join(' · '))}</div>`
    + `<div class="x">${live ? '<i class="live-dot"></i>' : ''}${d.big}${d.sub ? ` · ${d.sub}` : ''}</div>`;
  sc.appendChild(t);

  /* 참가 확정 — 갈까 말까 하는 행사를 등록만 해두고 나중에 확정한다 */
  const g = el('div', 'sec');
  g.style.marginTop = '16px';
  const gbox = el('div', 'card');
  const grow = el('div', 'row',
    `<span class="row-ico" style="${e.going === false
      ? 'background:var(--fill);color:var(--g500)'
      : 'background:var(--green-fill);color:var(--green)'}">${ic('check', 18, 2.4)}</span>`
    + `<span class="grow"><span class="t">${e.going === false ? '참가 미정' : '참가 확정'}</span>`
    + `<span class="d">${e.going === false
      ? '홈 디데이는 확정된 행사부터 보여줍니다'
      : '홈 화면에 디데이로 올라갑니다'}</span></span>`);
  const sw = el('button', 'sw' + (e.going !== false ? ' on' : ''), '<i></i>');
  sw.setAttribute('aria-pressed', String(e.going !== false));
  sw.onclick = () => {
    // 제자리에서 뒤집고, 이 행의 문구만 갈아 준다
    e.going = flipSwitch(sw, e.going === false);
    const t = grow.querySelector('.t');
    const d = grow.querySelector('.d');
    const ico = grow.parentElement.querySelector('.row-ico');
    if (t) t.textContent = e.going ? '참가 확정' : '참가 미정';
    if (d) d.textContent = e.going ? '홈 화면에 디데이로 올라갑니다' : '홈 디데이는 확정된 행사부터 보여줍니다';
    if (ico) ico.style.cssText = e.going
      ? 'background:var(--green-fill);color:var(--green)'
      : 'background:var(--fill);color:var(--g500)';
    touch();
    renderHome();
    renderSchedule();
    toast(e.going ? '참가 확정으로 바꿌어요' : '참가 미정으로 바꿌어요');
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
  ss.appendChild(el('div', 'sec-lb', `<h2>행사 안의 약속</h2><span class="n">${sl.length}건</span>`));
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
        sbox.appendChild(el('div', 'daylb', `${diff(k, e.date) + 1}일차 · ${fmtDate(k).slice(5)}`));
        byDay.get(k).forEach(x => sbox.appendChild(subRow(e, x, () => paint(sc, e, id))));
      });
    } else {
      sl.forEach(x => sbox.appendChild(subRow(e, x, () => paint(sc, e, id))));
    }
  } else {
    sbox.appendChild(el('div', 'subrow', `<span class="tm"></span><span class="grow"><span class="mm">아직 없어요. 아래에서 추가하세요.</span></span>`));
  }
  ss.appendChild(sbox);
  const addSub = el('button', 'btn sub', `${ic('plus', 17, 2.2)}약속 추가`);
  addSub.style.cssText = 'width:100%;margin-top:12px';
  addSub.onclick = () => subSheet(e, null, () => paint(sc, e, id));
  ss.appendChild(addSub);
  sc.appendChild(ss);

  /* 체크리스트 */
  const pg = progress(e);
  const s1 = el('div', 'sec');
  s1.style.marginTop = '24px';
  const strip = el('button', 'strip blue', `<span class="k">체크리스트</span>`
    + `<span class="v">${pg.total ? `${pg.done}/${pg.total}` : '설정'}</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
  strip.onclick = () => openChecklist(e.id);
  s1.appendChild(strip);
  sc.appendChild(s1);

  /* 행사 카테고리 */
  const ts = el('div', 'sec');
  ts.appendChild(el('div', 'sec-lb', `<h2>행사 카테고리</h2><span class="n">사진 태그와 별개</span>`));
  const tw = el('div', 'tagwrap');
  (e.tags || []).forEach(tag => {
    const c = el('button', `cat c-${catColor(tag)}`, `${esc(tag)}<span class="x">${ic('x', 13, 2.6)}</span>`);
    c.onclick = () => { e.tags = e.tags.filter(x => x !== tag); touch(); paint(sc, e, id); renderSchedule(); };
    tw.appendChild(c);
  });
  const addT = el('button', 'tg add', `${ic('check', 14, 2.4)}고르기`);
  addT.onclick = () => eventCatSheet(e, () => paint(sc, e, id));
  tw.appendChild(addT);
  const mkT = el('button', 'tg add', `${ic('plus', 14, 2.4)}카테고리 만들기`);
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
    ss2.appendChild(el('div', 'sec-lb', `<h2>사진사</h2><span class="n">${crew.length}명</span>`));
    const sbox2 = el('div', 'card');

    crew.forEach(({ sh, cnt }) => {
      const r = el('button', 'row');
      r.innerHTML = avatarHTML(sh.name, sh.avatar)
        + `<span class="grow"><span class="t">${esc(sh.name)}</span>`
        + `<span class="d${sh.x ? ' x' : ''}">${sh.x ? '@' + esc(sh.x) : 'X 아이디 없음'}</span></span>`
        + `<span class="n-sm">${fmt(cnt)}장</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
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
      const k = p.cameraModel || '카메라 정보 없음';
      if (!byCam.has(k)) byCam.set(k, []);
      byCam.get(k).push(p.id);
    });
    [...byCam.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([cam, ids]) => {
      const r = el('button', 'row');
      r.innerHTML = `<span class="row-ico" style="background:var(--amber-fill);color:var(--amber)">${ic('cam', 18)}</span>`
        + `<span class="grow"><span class="t" style="color:var(--amber)">사진사 지정하기</span>`
        + `<span class="d">${esc(cam)}</span></span>`
        + `<span class="n-sm">${fmt(ids.length)}장</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
      r.onclick = () => {
        V.sel = new Set(ids);
        assignSheet('shooter', () => { paint(sc, e, id); renderAll(); });
      };
      sbox2.appendChild(r);
    });

    ss2.appendChild(sbox2);
    sc.appendChild(ss2);
  }

  /* 사진 */
  const ps = el('div', 'sec');
  ps.appendChild(el('div', 'sec-lb', `<h2>이 행사 사진</h2><span class="n">${fmt(n)}장</span>`));
  const pb = el('div', 'card');
  const pr = el('button', 'row', `<span class="row-ico">${ic('grid', 18)}</span>`
    + `<span class="grow"><span class="t">${n ? '사진 보기' : '아직 연결된 사진이 없어요'}</span>`
    + `<span class="d">${n ? '사진 탭에서 이 행사로 필터' : '사진 탭에서 이 행사로 지정하면 모입니다'}</span></span>`
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
  const lg = el('button', 'btn sub', `${ic('grid', 17, 2)}로고 ${e.logo ? '바꾸기' : '설정'}`);
  lg.style.width = '100%';
  lg.onclick = () => logoSheet(e, () => paint(sc, e, id));
  const ed = el('button', 'btn sub', `${ic('cal', 17, 2)}일정 편집`);
  ed.style.width = '100%';
  ed.onclick = () => eventSheet(e, () => paint(sc, e, id));
  const del = el('button', 'btn danger', `${ic('trash', 17, 2)}일정 삭제`);
  del.onclick = () => confirmSheet({
    title: '이 일정을 삭제할까요?', danger: true, ok: '삭제',
    lead: n
      ? `이 행사로 분류된 <b>사진 ${fmt(n)}장</b>이 <b>행사 미지정</b>으로 돌아갑니다. 사진과 사용 이력은 지워지지 않습니다.`
      : '체크리스트 · 약속 · 카테고리도 함께 사라집니다.',
    onOk: () => {
      S.cat.events = S.cat.events.filter(x => x.id !== id);
      Object.values(S.cat.photos).forEach(p => { if (p.event === id) p.event = null; });
      touch();
      popAll();
      renderAll();
      toast('일정을 삭제했어요');
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
    openSheet(`<h3>${isNew ? '일정 추가' : '일정 편집'}</h3>`
      + `<p class="lead">${isNew ? '날짜를 넣으면 디데이로 세어주고, 같은 날짜의 사진을 이 행사로 제안합니다.' : ''}</p>`
      + `<div class="fld"><label for="ev-name">행사 이름</label>`
      + `<input id="ev-name" maxlength="60" value="${esc(e ? e.name : '')}" placeholder="예: 케이퍼리 2026"></div>`
      + `<div class="fld"><label>기간</label><div id="ev-seg"></div></div>`
      + `<div class="fld"><label for="ev-date">${multi ? '시작일' : '날짜'}</label>`
      + `<input id="ev-date" type="date" value="${e && e.date ? e.date : ''}"></div>`
      + (multi
        ? `<div class="fld"><label for="ev-end">종료일</label>`
          + `<input id="ev-end" type="date" value="${e && e.endDate ? e.endDate : ''}">`
          + `<div class="hint">여러 날 묶는 컨벤션이면 종료일까지 넣어 주세요. 그 안의 약속은 <b>행사 안의 약속</b>으로 따로 적습니다.</div></div>`
        : '')
      + `<div class="fld"><label for="ev-place">장소 (선택)</label>`
      + `<input id="ev-place" maxlength="40" value="${esc(e && e.place ? e.place : '')}" placeholder="예: 킨텍스 제2전시장"></div>`
      + `<div class="fld"><label for="ev-note">메모 (선택)</label>`
      + `<input id="ev-note" maxlength="80" value="${esc(e && e.note ? e.note : '')}" placeholder="예: 입장 10시 · 단체샷 14시"></div>`
      + `<div class="fld"><label>참가</label><div id="ev-go"></div>`
      + `<div class="hint">갈까 말까 정하지 못했으면 <b>미정</b>으로 등록해 두세요. 홈 디데이는 확정된 행사부터 잡습니다.</div></div>`
      + `<button class="btn" id="ev-save">${isNew ? '추가' : '저장'}</button>`);

    /* 기간 전환 시 입력값을 잃지 않도록 옮겨 담는다 */
    $('#ev-seg').appendChild(segment([['one', '하루'], ['many', '여러 날']], multi ? 'many' : 'one', v => {
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

    const goSeg = segment([['yes', '확정'], ['maybe', '미정']], going ? 'yes' : 'maybe', v => {
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
      toast(isNew ? `"${name}" 일정을 추가했어요` : '저장했어요');
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
  openSheet(`<h3>행사 카테고리</h3><p class="lead">사진 태그와는 별개 목록입니다.</p>`
    + `<div class="opts" id="et-list"></div>`
    + `<button class="btn sub" id="et-new" style="width:100%">${ic('plus', 17, 2.2)}카테고리 만들기</button>`);
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
    if (!pool.length) box.innerHTML = `<div class="note">${ic('info', 17)}<span>아래에서 카테고리를 만들어 주세요.</span></div>`;
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
  push('체크리스트', sc => paintChecklist(sc, id));
}

function paintChecklist(sc, id) {
  const e = S.cat.events.find(x => x.id === id);
  if (!e) { sc.innerHTML = `<div class="sec" style="padding-top:40px"><div class="note bad">삭제된 일정입니다.</div></div>`; return; }
  keepScroll(sc, () => {
    sc.innerHTML = '';
    const d = ddayLabel(e);
    const t = el('div', 'gtitle');
    t.innerHTML = `<h2>${esc(e.name)}</h2><div class="m">${esc([fmtRange(e), d.sub].filter(Boolean).join(' · '))}</div>`;
    sc.appendChild(t);

    /* 사전 준비 */
    const prep = e.prep || (e.prep = []);
    const s1 = el('div', 'sec');
    s1.appendChild(ckHead('사전 준비', prepDone(e), prep.length));
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
    if (!prep.length) b1.appendChild(el('div', 'ck-row', `<span class="tx" style="color:var(--g500);font-weight:600">아직 없어요. 아래에서 추가하세요.</span>`));
    s1.appendChild(b1);
    const ar = el('div', 'addrow');
    ar.style.marginTop = '10px';
    ar.innerHTML = `<input id="pp-in" placeholder="할 일 추가" maxlength="40"><button id="pp-add">추가</button>`;
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
    s2.appendChild(ckHead('짐 챙기기', packDone(e), packing.length));
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
    if (!packing.length) b2.appendChild(el('div', 'ck-row', `<span class="tx" style="color:var(--g500);font-weight:600">공용 목록이 비어 있어요.</span>`));
    s2.appendChild(b2);
    const go = el('button', 'btn sub', `${ic('sliders', 17, 2)}공용 목록 편집`);
    go.style.cssText = 'width:100%;margin-top:12px';
    go.onclick = () => openPacking();
    s2.appendChild(go);
    sc.appendChild(s2);

    const reset = el('div', 'sec');
    reset.style.marginTop = '18px';
    const rb = el('button', 'btn sub', `${ic('refresh', 17, 2)}이 행사 체크 모두 지우기`);
    rb.style.width = '100%';
    rb.onclick = () => confirmSheet({
      title: '체크를 모두 지울까요?', ok: '모두 지우기', danger: true,
      lead: '항목은 남고 체크만 풀립니다. 다음 행사에 다시 쓸 때 편합니다.',
      onOk: () => {
        e.packed = [];
        (e.prep || []).forEach(x => { x.done = false; });
        touch(); paintChecklist(sc, id); renderAll(); toast('체크를 지웠어요');
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
  push('짐 챙기기 목록', sc => paintPacking(sc));
}

function paintPacking(sc) {
  keepScroll(sc, () => {
    sc.innerHTML = '';
    const list = S.cat.packing;
    const t = el('div', 'gtitle');
    t.innerHTML = `<h2>짐 챙기기 목록</h2><div class="m">모든 행사가 함께 쓰는 공용 목록입니다. 체크 상태는 행사별로 따로 남으니, 여기서는 항목만 관리하세요.</div>`;
    sc.appendChild(t);

    const s = el('div', 'sec');
    s.style.marginTop = '18px';
    const ar = el('div', 'addrow');
    ar.innerHTML = `<input id="pk-in" placeholder="챙길 것 추가" maxlength="40"><button id="pk-add">추가</button>`;
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
          title: `"${item.text}" 를 지울까요?`, danger: true, ok: '삭제',
          lead: used ? `이미 체크해 둔 행사 <b>${used}건</b>에서도 함께 빠집니다.` : '공용 목록에서 사라집니다.',
          onOk: () => {
            S.cat.packing = list.filter(x => x.id !== item.id);
            S.cat.events.forEach(e => { if (e.packed) e.packed = e.packed.filter(x => x !== item.id); });
            touch(); paintPacking(sc); renderAll();
          },
        });
      };
      r.appendChild(up);
      r.appendChild(del);
      box.appendChild(r);
    });
    if (!list.length) box.appendChild(el('div', 'ck-row', `<span class="tx" style="color:var(--g500);font-weight:600">항목이 없어요.</span>`));
    s.appendChild(box);
    sc.appendChild(s);

    const add = () => {
      const v = ar.querySelector('#pk-in').value.trim();
      if (!v) return;
      if (list.some(x => x.text === v)) { toast('이미 있는 항목이에요'); return; }
      list.push({ id: uid('pk'), text: v });
      touch();
      paintPacking(sc);
    };
    ar.querySelector('#pk-add').onclick = add;
    ar.querySelector('#pk-in').addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });

    const n = el('div', 'sec');
    n.style.marginTop = '20px';
    n.appendChild(el('div', 'note', `${ic('info', 17)}<span>기본 항목은 예시로 넣어둔 것입니다. 필요 없는 건 지우고 본인 목록으로 바꾸세요.</span>`));
    sc.appendChild(n);
  });
}
