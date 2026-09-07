/* screens.js — 화면 렌더 */
import {
  S, photos, isUsed, isUnfiled, eventById, shooterById, personById,
  addEvent, addShooter, addPerson, normX, touch, flush, copyTextFor, channelOf, hashtagify,
  unknownShooter, UNKNOWN_SHOOTER, catColor,
} from './store.js';
import * as sug from './suggest.js';
import * as th from './thumbs.js';
import * as av from './avatar.js';
import {
  $, el, ic, esc, fmt, avatarHTML, push, pop, popAll, openSheet, closeSheet,
  toast, confirmSheet, wireScroll, segment, countUp, setNavRight, keepScroll, openX, icFill,
} from './ui.js';
/* screens2.js 와는 순환 참조다. 서로 함수 선언만 쓰고 모듈 평가 시점에
   접근하지 않으므로 ES 모듈에서 안전하다. */
import {
  openPhoto, usageSheet, entitySheet, openTagManage, openTagBrowse, renderSettings,
} from './screens2.js';
import { renderSchedule, ddayCard } from './schedule.js';
import { fridayCard } from './friday.js';

export const NO_FILTER = () => ({ unfiled: false, unused: false, event: null, shooter: null, person: null, tag: null });
export const hasFilter = f => f.unfiled || f.unused || !!f.event || !!f.shooter || !!f.person || !!f.tag;

export const V = {
  tab: 'home',
  axis: 'event',
  filter: { unfiled: false, unused: false, event: null, shooter: null, person: null, tag: null },
  limit: 90,
  selecting: false,
  sel: new Set(),
  onSync: null,   // app.js 가 주입
  onPickFolders: null,
};

const TABS = () => [
  ['home', S.cat.opts.homeTab || S.cat.opts.homeTitle || '모아보기', 'layers'],
  ['photos', '사진', 'grid'],
  ['schedule', '일정', 'cal'],
  ['settings', '설정', 'sliders'],
];

let lastTabIdx = -1;

/**
 * 탭바는 한 번만 만들고 이후엔 `--i` 만 옮긴다.
 * 매번 innerHTML 을 새로 쓰면 알약이 새로 생겨나 슬라이드가 안 된다.
 */
export function renderTabs() {
  const bar = $('#tabbar');
  const items = TABS();
  const idx = Math.max(0, items.findIndex(([k]) => k === V.tab));

  if (!bar.querySelector('.tabknob')) {
    bar.innerHTML = '<div class="tablight"></div><div class="tabknob"><i></i></div>'
      + items.map(([k, , icon]) => `<button class="tab" data-tab="${k}">`
        + `<span class="ico"><span class="out">${ic(icon, 24, 1.9)}</span>`
        + `<span class="fill">${icFill(icon, 24)}</span></span>`
        + `<span class="dot" hidden></span><span class="lb"></span></button>`).join('');
  }
  bar.style.setProperty('--n', String(items.length));
  bar.style.setProperty('--i', String(idx));

  const pend = sug.build().length;
  bar.querySelectorAll('.tab').forEach((b, i) => {
    const [k, label] = items[i];
    const on = k === V.tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', String(on));
    b.querySelector('.lb').textContent = label;
    b.querySelector('.dot').hidden = !(k === 'home' && pend);
  });

  // 탭이 바뀐 순간에만 물방울처럼 늘어났다 줄어든다.
  // 이동 거리가 멀수록 더 늘어나야 관성이 있어 보인다.
  if (idx !== lastTabIdx) {
    const knob = bar.querySelector('.tabknob');
    if (lastTabIdx !== -1) {
      const dist = Math.abs(idx - lastTabIdx);
      knob.style.setProperty('--dir', idx > lastTabIdx ? '1' : '-1');
      knob.style.setProperty('--sx', String(Math.min(0.40, 0.20 + (dist - 1) * 0.08)));
      knob.classList.remove('pop');
      void knob.offsetWidth;
      knob.classList.add('pop');
    }
    lastTabIdx = idx;
  }
}

export function goTab(k) {
  V.tab = k;
  document.querySelectorAll('.screen').forEach(s => {
    const on = s.dataset.screen === k;
    s.classList.toggle('on', on);
    if (on) { s.classList.remove('enter'); void s.offsetWidth; s.classList.add('enter'); }
  });
  renderTabs();
  if (k === 'home') renderHome();
  if (k === 'photos') renderPhotos();
  if (k === 'schedule') renderSchedule();
  if (k === 'settings') renderSettings();
}

export function renderAll() {
  renderTabs();
  renderHome();
  renderPhotos();
  renderSchedule();
  renderSettings();
}

/* ============================ 모아보기 ============================ */

function counts(list) {
  const u = list.filter(isUsed).length;
  return `${fmt(list.length)}장${u ? ` · <span class="hi">사용 ${fmt(u)}</span>` : ''}`;
}

function groups(axis) {
  const all = photos();
  if (axis === 'event') {
    const out = S.cat.events.map(e => {
      const list = all.filter(p => p.event === e.id);
      return { key: e.id, title: e.name, meta: `${sug.fmtDate(e.date)}${e.date ? ' · ' : ''}${counts(list)}`, list, cover: true, ev: e };
    });
    const un = all.filter(p => !p.event);
    if (un.length) out.push({ key: null, title: '행사 미지정', meta: counts(un), list: un, cover: true, unfiled: true });
    return out;
  }
  if (axis === 'shooter') {
    const out = S.cat.shooters.map(s => {
      const list = all.filter(p => p.shooter === s.id);
      return { key: s.id, title: s.name, meta: `${s.x ? '@' + s.x : 'X 아이디 없음'} · ${counts(list)}`, list, av: s, ent: s };
    }).sort((a, b) => b.list.length - a.list.length);
    const un = all.filter(p => !p.shooter);
    if (un.length) out.push({ key: null, title: '사진사 미지정', meta: counts(un), list: un, unfiled: true });
    return out;
  }
  return S.cat.people.map(p => {
    const list = all.filter(x => (x.people || []).includes(p.id));
    return { key: p.id, title: p.name, meta: `${p.role || (p.x ? '@' + p.x : '역할 없음')} · ${counts(list)}`, list, av: p, ent: p };
  }).filter(g => g.list.length).sort((a, b) => b.list.length - a.list.length);
}

export function renderHome() {
  const sc = $('#home-scroll');
  if (!sc) return;
  const h1 = document.querySelector('[data-screen="home"] .hdr h1');
  if (h1) h1.textContent = S.cat.opts.homeTitle || '모아보기';
  keepScroll(sc, () => paintHome(sc));
}

function paintHome(sc) {
  sc.innerHTML = '';
  const all = photos();

  /* 금요일이면 그 위에 FursuitFriday — 오늘 할 일이 디데이보다 급하다 */
  const fri = fridayCard();
  if (fri) {
    const f = el('div', 'sec');
    f.style.paddingTop = '2px';
    f.appendChild(fri);
    sc.appendChild(f);
  }

  /* 접속하면 다음 행사 디데이 — 사진이 없어도 보여준다 */
  const dd = el('div', 'sec');
  dd.style.paddingTop = fri ? '10px' : '2px';
  dd.appendChild(ddayCard());
  sc.appendChild(dd);

  if (!all.length) { sc.appendChild(emptyState()); return; }

  /* --- 확인할 것 --- */
  const list = sug.build();
  if (list.length) {
    const s = el('div', 'sec');
    const lb = el('div', 'sec-lb', `<h2>확인할 것</h2><span class="n">${list.length}</span>`);
    lb.style.marginTop = '4px';
    s.appendChild(lb);
    const box = el('div', '');
    list.forEach(g => box.appendChild(sugCard(g)));
    s.appendChild(box);
    sc.appendChild(s);
  }

  /* --- 스트립 --- */
  const strips = el('div', 'sec stagger');
  strips.style.marginTop = '20px';
  const unfiled = all.filter(isUnfiled).length;
  const unused = all.filter(p => !isUsed(p)).length;

  if (unfiled) {
    const b = el('button', 'strip blue', `<span class="k">행사·사진사를 정할 사진</span><span class="v">${fmt(unfiled)}장</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
    b.onclick = () => { V.filter = { ...NO_FILTER(), unfiled: true }; V.limit = 90; goTab('photos'); };
    strips.appendChild(b);
  }
  const b2 = el('button', 'strip', `<span class="k">아직 안 올린 사진</span><span class="v">${fmt(unused)}장</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
  b2.style.marginTop = unfiled ? '8px' : '0';
  b2.onclick = () => { V.filter = { ...NO_FILTER(), unused: true }; V.limit = 90; goTab('photos'); };
  strips.appendChild(b2);
  sc.appendChild(strips);

  /* --- 축 --- */
  // 축을 바꿀 때 홈 전체를 다시 그리면 세그먼트가 새로 생겨 알약이 안 움직인다.
  // 그래서 목록만 갈아 끼운다.
  sc.appendChild(segment(
    [['event', '행사별'], ['shooter', '사진사별'], ['person', '퍼슈트별']],
    V.axis,
    v => { V.axis = v; paintGroups($('#home-groups')); },
  ));

  const wrap = el('div', 'sec');
  wrap.id = 'home-groups';
  sc.appendChild(wrap);
  paintGroups(wrap);
  wireScroll();
}

/** 모아보기 목록만 다시 그린다 (축 전환용) */
function paintGroups(wrap) {
  if (!wrap) return;
  wrap.innerHTML = '';
  const gs = groups(V.axis);
  const lb = el('div', 'sec-lb', `<h2>${V.axis === 'event' ? '행사' : V.axis === 'shooter' ? '사진사' : '같이 찍은 퍼슈트'}</h2><span class="n">${gs.length}</span>`);
  lb.style.marginTop = '4px';
  wrap.appendChild(lb);

  if (!gs.length) {
    wrap.appendChild(el('div', 'note', `${ic('info', 17)}<span>${V.axis === 'person' ? '사진에 퍼슈트를 지정하면 여기 모입니다.' : '아직 등록된 항목이 없어요.'}</span>`));
    return;
  }
  const box = el('div', 'card stagger');
  gs.forEach(g => {
    const b = el('button', 'row big');
    const lead = g.cover
      ? (g.ev?.logo
        ? `<img class="thumb" alt="" src="${g.ev.logo}">`
        : `<img class="thumb" data-fid="${g.list[0]?.id || ''}" alt="">`)
      : avatarHTML(g.title, g.av?.avatar);
    b.innerHTML = lead + `<span class="grow"><span class="t">${esc(g.title)}</span><span class="d">${g.meta}</span></span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
    b.onclick = () => openGroup(V.axis, g);
    box.appendChild(b);
  });
  wrap.appendChild(box);
  th.warm(box.querySelectorAll('img[data-fid]'), 8);
}

function emptyState() {
  const s = el('div', 'sec');
  s.style.paddingTop = '28px';
  s.innerHTML = `<div class="gtitle" style="padding:0"><h2>사진 폴더를 연결해 주세요</h2>`
    + `<div class="m">구글 드라이브에서 행사 사진이 담긴 폴더를 고르면, 목록을 읽어와 여기 모아 보여드려요. 사진은 읽기만 하고 절대 수정하지 않습니다.</div></div>`;
  const b = el('button', 'btn', `${ic('folder', 19, 2.1)}폴더 고르기`);
  b.style.marginTop = '24px';
  b.onclick = () => V.onPickFolders?.();
  s.appendChild(b);
  return s;
}

function sugCard(g) {
  const c = el('div', 'sug');
  const thumbs = g.ids.slice(0, 5).map(id => `<img data-fid="${id}" alt="">`).join('');
  c.innerHTML = `<div class="why">${esc(g.why)}</div><p class="q">${esc(g.q)}</p>`
    + (g.note ? `<div class="why" style="margin-top:6px;color:var(--amber)">${esc(g.note)}</div>` : '')
    + `<div class="thumbs">${thumbs}</div>`;

  let always = false;
  if (g.alwaysLabel) {
    const a = el('button', 'always', `<span class="box">${ic('check', 13, 3)}</span><span>${esc(g.alwaysLabel)}</span>`);
    a.onclick = () => { always = !always; a.classList.toggle('on', always); };
    c.appendChild(a);
  }

  const acts = el('div', 'acts');
  const yes = el('button', 'yes', g.kind === 'newEvent' ? '만들기' : '맞아요');
  const no = el('button', '', g.kind === 'newEvent' ? '나중에' : '아니요');
  yes.onclick = () => {
    if (g.kind === 'newEvent') { newEventSheet(g); return; }
    sug.accept(g, { always });
    dropCard(c);
    toast(`${fmt(g.ids.length)}장에 적용했어요`);
    renderTabs();
  };
  no.onclick = () => {
    if (g.kind === 'newEvent') sug.later(g.key); else sug.dismiss(g.key);
    dropCard(c);
    renderTabs();
  };
  acts.appendChild(yes); acts.appendChild(no);
  c.appendChild(acts);
  requestAnimationFrame(() => th.warm(c.querySelectorAll('img[data-fid]'), 5));
  return c;
}

function dropCard(c) {
  c.classList.add('out');
  setTimeout(() => { c.remove(); renderHome(); }, 240);
}

/**
 * 날짜 뭉치를 처리하는 시트.
 * 같은 날짜의 행사가 있으면 제안이 따로 뜨지만, 이틀짜리 컨벤션이나 카메라
 * 시계가 어긋난 경우엔 날짜가 안 맞는다. 그래서 여기서 **기존 행사에 편입**도
 * 할 수 있게 두고, 날짜가 가까운 행사를 위로 올려 준다.
 */
function newEventSheet(g) {
  let mode = S.cat.events.length ? 'join' : 'new';

  const render = () => {
    const near = [...S.cat.events]
      .map(e => ({ e, gap: e.date ? Math.abs(sug.daysBetween(e.date, g.date)) : 999 }))
      .sort((a, b) => a.gap - b.gap);

    openSheet(`<h3>${sug.fmtDate(g.date)} · ${fmt(g.ids.length)}장</h3>`
      + `<p class="lead">이 사진들을 어디로 묶을까요?</p>`
      + `<div id="ne-seg"></div>`
      + (mode === 'join'
        ? `<div class="opts" id="ne-list">`
          + near.map(({ e, gap }) => `<button class="opt" data-id="${e.id}">`
            + `<span class="l">${e.icon ? esc(e.icon) + ' ' : ''}${esc(e.name)}</span>`
            + `<span class="n">${e.date ? (gap === 0 ? '같은 날' : gap <= 3 ? `${gap}일 차이` : sug.fmtDate(e.date)) : '날짜 미정'}</span>`
            + `<span class="c">${ic('chev', 17, 2.2)}</span></button>`).join('')
          + `</div>`
        : `<div class="fld"><label for="ne-name">행사 이름</label><input id="ne-name" placeholder="예: 케이퍼리 2026" maxlength="60"></div>`
          + `<div class="fld"><label for="ne-date">행사 날짜</label><input id="ne-date" type="date" value="${g.date}"></div>`
          + `<button class="btn" id="ne-save">${fmt(g.ids.length)}장을 이 행사로</button>`));

    if (S.cat.events.length) {
      $('#ne-seg').appendChild(segment([['join', '기존 행사'], ['new', '새 행사']], mode, v => { mode = v; render(); }));
      $('#ne-seg .segwrap').style.padding = '0 0 16px';
    }

    if (mode === 'join') {
      $('#ne-list').onclick = ev => {
        const b = ev.target.closest('[data-id]');
        if (b) attach(b.dataset.id);
      };
    } else {
      const inp = $('#ne-name');
      $('#ne-save').onclick = () => {
        const name = inp.value.trim();
        if (!name) { inp.focus(); return; }
        const e = addEvent(name, $('#ne-date').value || g.date);
        attach(e.id, name);
      };
      setTimeout(() => inp.focus(), 340);
    }
  };

  const attach = (eventId, newName) => {
    const e = S.cat.events.find(x => x.id === eventId);
    g.ids.forEach(id => { const p = S.cat.photos[id]; if (p && !p.event) p.event = eventId; });
    sug.dismiss(g.key);
    touch();
    closeSheet();
    toast(`${esc(newName || e?.name || '')} · ${fmt(g.ids.length)}장`);
    renderAll();
  };

  render();
}

/* ============================ 그룹 상세 ============================ */

function openGroup(axis, g) {
  const u = g.list.filter(isUsed).length;
  push(g.title, sc => {
    const t = el('div', 'gtitle');
    const sub = axis === 'event'
      ? (g.ev?.date ? sug.fmtDate(g.ev.date) : '날짜 미정')
      : axis === 'shooter' ? (g.ent?.x ? '' : 'X 아이디 없음')
        : (g.ent?.role || '');
    t.innerHTML = `<h2>${esc(g.title)}</h2>`
      + `<div class="m">${[sub, `${fmt(g.list.length)}장`, `사용 ${fmt(u)}장`].filter(Boolean).join(' · ')}</div>`
      + (g.ent?.x ? `<div class="x">@${esc(g.ent.x)}</div>` : '');
    sc.appendChild(t);

    const s1 = el('div', 'sec');
    s1.style.marginTop = '18px';
    const strip = el('button', 'strip blue', `<span class="k">아직 안 올린 사진</span><span class="v">${fmt(g.list.length - u)}장</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
    strip.onclick = () => {
      applyAxis(axis, g.key);
      V.filter.unused = true; V.limit = 90;
      goTab('photos'); popAll();
    };
    s1.appendChild(strip);
    sc.appendChild(s1);

    if (axis === 'event') {
      const crew = [...new Set(g.list.map(p => p.shooter).filter(Boolean))]
        .map(id => ({ s: shooterById(id), n: g.list.filter(p => p.shooter === id).length }))
        .filter(x => x.s).sort((a, b) => b.n - a.n);
      const none = g.list.filter(p => !p.shooter).length;
      const sec = el('div', 'sec');
      sec.appendChild(el('div', 'sec-lb', `<h2>사진사</h2><span class="n">${crew.length}명</span>`));
      const box = el('div', 'card');
      crew.forEach(({ s, n }) => {
        const r = el('button', 'row');
        r.innerHTML = avatarHTML(s.name, s.avatar)
          + `<span class="grow"><span class="t">${esc(s.name)}</span><span class="d${s.x ? ' x' : ''}">${s.x ? '@' + esc(s.x) : 'X 아이디 없음'}</span></span>`
          + `<span class="n-sm">${fmt(n)}장</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
        r.onclick = () => { applyAxis('event', g.key); V.filter.shooter = s.id; V.limit = 90; goTab('photos'); popAll(); };
        box.appendChild(r);
      });
      if (none) {
        /* 카메라 모델별로 묶어 제안한다. 같은 바디로 찍힌 사진은 대개 같은
           사진사라, 여기서 한 번 지정하면 그 묶음이 통째로 정리된다.
           이게 "확인할 것" 의 카메라→사진사 제안이 학습할 씨앗도 된다. */
        const byCam = new Map();
        g.list.filter(p => !p.shooter).forEach(p => {
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
            assignSheet('shooter', () => { popAll(); renderAll(); });
          };
          box.appendChild(r);
        });
      }
      sec.appendChild(box);
      sc.appendChild(sec);
    }

    if (g.ent) {
      const sec = el('div', 'sec');
      sec.style.marginTop = '20px';
      const b = el('button', 'btn sub', `${ic('user', 17, 2)}정보 편집`);
      b.style.width = '100%';
      b.onclick = () => entitySheet(axis === 'shooter' ? 'shooter' : 'person', g.ent, () => { popAll(); renderAll(); });
      sec.appendChild(b);
      sc.appendChild(sec);
    }

    const lb = el('div', 'sec');
    lb.appendChild(el('div', 'sec-lb', `<h2>미사용 먼저</h2><span class="n">${fmt(g.list.length - u)}장</span>`));
    sc.appendChild(lb);
    const sorted = [...g.list].sort((a, b) => (isUsed(a) ? 1 : 0) - (isUsed(b) ? 1 : 0));
    const grid = el('div', 'grid');
    sorted.slice(0, 60).forEach(p => grid.appendChild(cell(p)));
    sc.appendChild(grid);
    th.warm(grid.querySelectorAll('img[data-fid]'), 24);
  });
}

function applyAxis(axis, key) {
  V.filter = NO_FILTER();
  if (key == null) { V.filter.unfiled = true; return; }
  if (axis === 'event') V.filter.event = key;
  else if (axis === 'shooter') V.filter.shooter = key;
  else V.filter.person = key;
}

/* ============================ 사진 ============================ */

function filtered() {
  const f = V.filter;
  return photos().filter(p => {
    if (f.unfiled && !isUnfiled(p)) return false;
    if (f.unused && isUsed(p)) return false;
    if (f.event && p.event !== f.event) return false;
    if (f.shooter && p.shooter !== f.shooter) return false;
    if (f.person && !(p.people || []).includes(f.person)) return false;
    if (f.tag && !(p.tags || []).includes(f.tag)) return false;
    return true;
  }).sort((a, b) => String(b.shotAt || '').localeCompare(String(a.shotAt || '')));
}

export function renderPhotos() {
  const sc = $('#ph-scroll');
  if (!sc) return;
  keepScroll(sc, () => paintPhotos(sc));
}

function paintPhotos(sc) {
  const list = filtered();
  $('#ph-title').textContent = `${fmt(list.length)}장`;
  $('#ph-chips').innerHTML = chipsHTML();
  $('#flt-reset').hidden = !hasFilter(V.filter);
  sc.innerHTML = '';

  if (!photos().length) { sc.appendChild(emptyState()); wireScroll(); return; }

  const grid = el('div', 'grid');
  list.slice(0, V.limit).forEach(p => grid.appendChild(cell(p)));
  sc.appendChild(grid);
  th.warm(grid.querySelectorAll('img[data-fid]'), 30);

  if (list.length > V.limit) {
    const f = el('div', 'gridfoot');
    const b = el('button', 'more', `+${fmt(Math.min(90, list.length - V.limit))}개 더 보기`);
    b.onclick = () => { V.limit += 90; renderPhotos(); };
    f.appendChild(b);
    sc.appendChild(f);
  }
  if (!list.length) {
    const n = el('div', 'sec');
    n.style.paddingTop = '40px';
    n.appendChild(el('div', 'note', `${ic('info', 17)}<span>조건에 맞는 사진이 없어요. 위 필터를 조정해 보세요.</span>`));
    sc.appendChild(n);
  }
  $('#app').classList.toggle('selecting', V.selecting);
  wireScroll();
}

function chipsHTML() {
  const f = V.filter;
  const ev = f.event && eventById(f.event);
  const sh = f.shooter && shooterById(f.shooter);
  const pe = f.person && personById(f.person);
  return [
    `<button class="chip${f.unfiled ? ' on' : ''}" data-c="unfiled">${f.unfiled ? ic('check', 14, 2.6) : ''}미분류만</button>`,
    `<button class="chip${f.unused ? ' on' : ''}" data-c="unused">${f.unused ? ic('check', 14, 2.6) : ''}미사용만</button>`,
    `<button class="chip${ev ? ' on' : ''}" data-c="event">${ev ? esc(ev.name) : '행사'}${ic('chev', 13, 2.4)}</button>`,
    `<button class="chip${sh ? ' on' : ''}" data-c="shooter">${sh ? esc(sh.name) : '사진사'}${ic('chev', 13, 2.4)}</button>`,
    `<button class="chip${pe ? ' on' : ''}" data-c="person">${pe ? esc(pe.name) : '퍼슈트'}${ic('chev', 13, 2.4)}</button>`,
    f.tag ? `<button class="chip on" data-c="tag">${esc(f.tag)}${ic('x', 13, 2.6)}</button>` : '',
  ].join('');
}

function cell(p) {
  const c = el('div', 'cell');
  const badge = isUsed(p)
    ? `<span class="bdg used">${ic('check', 13, 3)}</span>`
    : '';
  const flag = isUnfiled(p) ? '<span class="flag">미분류</span>' : '';
  c.innerHTML = `<img data-fid="${p.id}" alt="${esc(p.name || '')}">${badge}${flag}`
    + `<span class="pick"><i>${ic('check', 12, 3)}</i></span>`;
  if (V.sel.has(p.id)) c.classList.add('sel');
  c.onclick = () => {
    if (V.selecting) {
      V.sel.has(p.id) ? V.sel.delete(p.id) : V.sel.add(p.id);
      c.classList.toggle('sel', V.sel.has(p.id));
      updateSelbar();
    } else openPhoto(p.id);
  };
  return c;
}

export function wirePhotoChrome() {
  $('#ph-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const c = b.dataset.c, f = V.filter;
    V.limit = 90;
    if (c === 'unfiled') { f.unfiled = !f.unfiled; renderPhotos(); }
    else if (c === 'unused') { f.unused = !f.unused; renderPhotos(); }
    else if (c === 'tag') { f.tag = null; renderPhotos(); }
    else if (c === 'event') pickSheet('행사 선택', S.cat.events.map(e2 => ({ v: e2.id, l: e2.name, n: photos().filter(p => p.event === e2.id).length })), f.event, v => { f.event = v; renderPhotos(); });
    else if (c === 'shooter') pickSheet('사진사 선택', S.cat.shooters.map(s => ({ v: s.id, l: s.name, n: photos().filter(p => p.shooter === s.id).length })), f.shooter, v => { f.shooter = v; renderPhotos(); });
    else if (c === 'person') pickSheet('퍼슈트 선택', S.cat.people.map(s => ({ v: s.id, l: s.name, n: photos().filter(p => (p.people || []).includes(s.id)).length })), f.person, v => { f.person = v; renderPhotos(); });
  });

  $('#flt-reset').onclick = () => {
    V.filter = NO_FILTER();
    V.limit = 90;
    renderPhotos();
    $('#ph-scroll').scrollTop = 0;
    toast('필터를 모두 해제했어요');
  };

  $('#sel-toggle').onclick = () => {
    V.selecting = !V.selecting;
    if (!V.selecting) V.sel.clear();
    $('#sel-toggle').textContent = V.selecting ? '취소' : '선택';
    updateSelbar();
    renderPhotos();
  };
  $('#sb-event').onclick = () => assignSheet('event');
  $('#sb-shooter').onclick = () => assignSheet('shooter');
  $('#sb-more').onclick = () => moreSheet();
}

function updateSelbar() {
  const on = V.selecting, n = V.sel.size;
  $('#selbar').classList.toggle('on', on);
  $('#tabbar').style.display = on ? 'none' : '';
  $('#sb-event').textContent = n ? `행사 ${n}` : '행사';
  $('#sb-shooter').textContent = n ? `사진사 ${n}` : '사진사';
  ['#sb-event', '#sb-shooter', '#sb-more'].forEach(s => { $(s).disabled = !n; });
}

function exitSelect() {
  V.selecting = false; V.sel.clear();
  $('#sel-toggle').textContent = '선택';
  updateSelbar();
}

/* ---------- 지정 시트 (행사 / 작가 / 인물) ---------- */

function assignSheet(kind, after) {
  const ids = [...V.sel];
  const list = kind === 'event' ? S.cat.events : kind === 'shooter' ? S.cat.shooters : S.cat.people;
  const label = kind === 'event' ? '행사' : kind === 'shooter' ? '사진사' : '퍼슈트';
  const rows = list.map(x => {
    const n = ids.filter(id => {
      const p = S.cat.photos[id];
      return kind === 'person' ? (p?.people || []).includes(x.id) : p?.[kind] === x.id;
    }).length;
    const sub = kind === 'event' ? sug.fmtDate(x.date) : x.x ? '@' + x.x : '';
    return `<button class="opt${n === ids.length ? ' on' : ''}" data-id="${x.id}"><span class="l">${esc(x.name)}${sub ? ` <span class="n">${esc(sub)}</span>` : ''}</span>${n && n < ids.length ? `<span class="n">${n}/${ids.length}</span>` : '<span class="n"></span>'}<span class="c">${ic('check', 18, 2.8)}</span></button>`;
  }).join('');

  openSheet(`<h3>${label} 지정</h3><p class="lead">${fmt(ids.length)}장에 한 번에 적용돼요.</p>`
    + `<div class="opts" id="as-list">${rows || ''}</div>`
    + `<button class="btn sub" id="as-new" style="width:100%">${ic('plus', 17, 2.2)}새 ${label} 만들기</button>`
    + (kind === 'shooter' ? `<button class="btn sub" id="as-unknown" style="width:100%;margin-top:8px">${ic('info', 17, 2)}사진사 미상으로 표시</button>` : '')
    + (list.length ? `<button class="btn sub" id="as-clear" style="width:100%;margin-top:8px">${label} 지정 해제</button>` : ''));

  $('#as-list').onclick = e => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    apply(b.dataset.id);
  };
  $('#as-new').onclick = () => newEntitySheet(kind, id => apply(id));
  $('#as-unknown')?.addEventListener('click', () => apply(unknownShooter().id));
  $('#as-clear')?.addEventListener('click', () => apply(null));

  function apply(id) {
    ids.forEach(pid => {
      const p = S.cat.photos[pid];
      if (!p) return;
      if (kind === 'person') {
        p.people = p.people || [];
        if (id === null) p.people = [];
        else if (!p.people.includes(id)) p.people.push(id);
      } else p[kind] = id;
    });
    touch();
    closeSheet();
    const name = id ? (list.find(x => x.id === id)?.name ?? '') : '해제';
    toast(`${fmt(ids.length)}장 · ${esc(name)}`);
    exitSelect();
    if (after) after(); else renderAll();
  }
}

function moreSheet() {
  const n = V.sel.size;
  openSheet(`<h3>${fmt(n)}장</h3><p class="lead">무엇을 할까요?</p><div class="opts">`
    + `<button class="opt" data-a="person"><span class="l">퍼슈트 지정</span>${ic('chev', 17, 2.2)}</button>`
    + `<button class="opt" data-a="tag"><span class="l">태그 적용</span>${ic('chev', 17, 2.2)}</button>`
    + `<button class="opt" data-a="use"><span class="l">사용 기록</span>${ic('chev', 17, 2.2)}</button>`
    + `</div>`);
  $('#sheet').querySelector('.opts').onclick = e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'person') assignSheet('person');
    else if (a === 'tag') tagSheet([...V.sel], () => { exitSelect(); renderAll(); });
    else usageSheet([...V.sel], () => { exitSelect(); renderAll(); });
  };
}

function newEntitySheet(kind, done) {
  const label = kind === 'event' ? '행사' : kind === 'shooter' ? '사진사' : '퍼슈트';
  const today = new Date().toISOString().slice(0, 10);
  openSheet(`<h3>새 ${label}</h3><p class="lead">${kind === 'event' ? '이름과 날짜를 넣으면 이후 같은 날짜 사진을 자동으로 제안해요.' : 'X 아이디를 넣으면 프로필 사진을 불러옵니다.'}</p>`
    + `<div class="fld"><label for="nx-name">이름</label><input id="nx-name" maxlength="60" placeholder="${kind === 'event' ? '예: 여름 사내 페스타' : '예: 김도현'}"></div>`
    + (kind === 'event'
      ? `<div class="fld"><label for="nx-date">날짜</label><input id="nx-date" type="date" value="${today}"></div>`
      : (kind === 'person' ? `<div class="fld"><label for="nx-role">역할 (선택)</label><input id="nx-role" maxlength="30" placeholder="예: PR 매니저"></div>` : '')
      + `<div class="fld"><label for="nx-x">X 아이디 (선택)</label><input id="nx-x" maxlength="60" placeholder="@handle 또는 x.com/handle" autocapitalize="off" autocorrect="off"><div class="detect" id="nx-det"></div></div>`)
    + `<button class="btn" id="nx-save">만들기</button>`);

  const name = $('#nx-name');
  let avatar = null;
  if (kind !== 'event') wireXField($('#nx-x'), $('#nx-det'), d => { avatar = d; });

  $('#nx-save').onclick = async () => {
    const v = name.value.trim();
    if (!v) { name.focus(); return; }
    let ent;
    if (kind === 'event') ent = addEvent(v, $('#nx-date').value);
    else if (kind === 'shooter') ent = addShooter(v, $('#nx-x').value);
    else ent = addPerson(v, $('#nx-role')?.value, $('#nx-x').value);
    if (avatar) { ent.avatar = avatar; touch(); }
    closeSheet();
    done?.(ent.id);
  };
  setTimeout(() => name.focus(), 340);
}

/** X 아이디 입력란: 붙여넣기를 관대하게 받고, 멈추면 아바타를 미리 받아 보여준다. */
function wireXField(input, det, onAvatar) {
  let timer, last = '';
  const run = async () => {
    const h = normX(input.value);
    if (!h) { det.innerHTML = input.value.trim() ? `<span style="color:var(--amber)">X 아이디 형식이 아니에요 (영문·숫자·밑줄 15자)</span>` : ''; onAvatar(null); return; }
    if (h === last) return;
    last = h;
    det.innerHTML = `<span class="sk" style="width:26px;height:26px;border-radius:50%"></span><span>프로필 사진을 찾는 중…</span>`;
    const r = await av.fetchAvatar(h);
    if (normX(input.value) !== h) return;
    if (r.ok) {
      det.innerHTML = `<span class="av" style="width:30px;height:30px"><img alt="" src="${r.dataUrl}"></span><span style="color:var(--green);font-weight:700">프로필 사진을 찾았어요</span>`;
      onAvatar(r.dataUrl);
    } else {
      det.innerHTML = `${ic('info', 15)}<span>${av.REASON[r.reason]}. 아이디는 저장돼요.</span>`;
      onAvatar(null);
    }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 600); });
  input.addEventListener('blur', run);
}

/* ---------- 태그 적용 ---------- */

function tagSheet(ids, after) {
  const tags = S.cat.tags;
  if (!tags.length) {
    openSheet(`<h3>태그가 없어요</h3><p class="lead">태그는 설정에서 만들 수 있어요. 여기서는 만든 태그를 고르기만 합니다.</p>`
      + `<button class="btn" id="tg-go">설정에서 태그 만들기</button>`);
    $('#tg-go').onclick = () => { closeSheet(); goTab('settings'); openTagManage(); };
    return;
  }
  const cnt = new Map(tags.map(t => [t, ids.filter(i => (S.cat.photos[i]?.tags || []).includes(t)).length]));
  openSheet(`<h3>태그 적용</h3><p class="lead">${ids.length > 1 ? `${fmt(ids.length)}장에 한 번에 적용돼요.` : '이 사진에 적용돼요.'} 새 태그는 설정에서 만듭니다.</p><div class="opts" id="tg-list"></div>`);
  const box = $('#tg-list');
  tags.forEach(t => {
    const all = cnt.get(t) === ids.length;
    const o = el('button', 'opt' + (all ? ' on' : ''), `<span class="l">${esc(t)}</span><span class="n">${cnt.get(t) && !all ? `${cnt.get(t)}/${ids.length}` : ''}</span><span class="c">${ic('check', 18, 2.8)}</span>`);
    o.onclick = () => {
      const on = cnt.get(t) === ids.length;
      ids.forEach(i => {
        const p = S.cat.photos[i];
        if (!p) return;
        p.tags = p.tags || [];
        if (on) p.tags = p.tags.filter(x => x !== t);
        else if (!p.tags.includes(t)) p.tags.push(t);
      });
      cnt.set(t, on ? 0 : ids.length);
      o.classList.toggle('on', !on);
      o.querySelector('.n').textContent = '';
      touch();
      toast(`${esc(t)} 태그를 ${on ? '뺐어요' : '적용했어요'} · ${fmt(ids.length)}장`);
      after?.();
    };
    box.appendChild(o);
  });
}

function pickSheet(title, items, cur, apply) {
  if (!items.length) {
    openSheet(`<h3>${esc(title)}</h3><p class="lead">아직 등록된 항목이 없어요. 사진을 선택해서 지정하면 여기 목록이 생깁니다.</p><button class="btn sub" id="pk-x" style="width:100%">닫기</button>`);
    $('#pk-x').onclick = closeSheet;
    return;
  }
  openSheet(`<h3>${esc(title)}</h3><p class="lead">하나만 고를 수 있어요.</p><div class="opts" id="pk"></div>`
    + `<button class="btn sub" id="pk-clear" style="width:100%">필터 해제</button>`);
  const box = $('#pk');
  items.forEach(it => {
    const o = el('button', 'opt' + (cur === it.v ? ' on' : ''), `<span class="l">${esc(it.l)}</span><span class="n">${fmt(it.n)}장</span><span class="c">${ic('check', 18, 2.8)}</span>`);
    o.onclick = () => { apply(it.v); closeSheet(); };
    box.appendChild(o);
  });
  $('#pk-clear').onclick = () => { apply(null); closeSheet(); };
}

export {
  assignSheet, newEntitySheet, tagSheet, pickSheet, wireXField,
  updateSelbar, exitSelect, applyAxis, cell, groups, counts, emptyState,
};
export {
  openPhoto, usageSheet, useSheet, entitySheet, openTagManage, openTagBrowse,
  renderSettings, openCopyOptions,
} from './screens2.js';
export { renderSchedule, openEvent, openChecklist, eventSheet, openPacking, ddayCard } from './schedule.js';
