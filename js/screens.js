/* screens.js — 화면 렌더 */
import {
  S, photos, isUsed, isUnfiled, isPlanned, setPlanned,
  eventById, shooterById, personById,
  addEvent, addShooter, addPerson, normX, touch, flush, copyTextFor, channelOf, hashtagify,
  unknownShooter, UNKNOWN_SHOOTER, unknownEvent, catColor,
} from './store.js';
import { renderProfile } from './suits.js';
import * as sug from './suggest.js';
import * as th from './thumbs.js';
import * as av from './avatar.js';
import {
  $, el, ic, esc, fmt, avatarHTML, flipSwitch, push, pop, popAll, openSheet, closeSheet,
  toast, confirmSheet, wireScroll, segment, countUp, setNavRight, keepScroll, openX, icFill,
  searchRow,
  result,
} from './ui.js';
/* screens2.js 와는 순환 참조다. 서로 함수 선언만 쓰고 모듈 평가 시점에
   접근하지 않으므로 ES 모듈에서 안전하다. */
import {
  openPhoto, usageSheet, entitySheet, openTagManage, openTagBrowse, renderSettings,
} from './screens2.js';
import { renderSchedule, ddayCard } from './schedule.js';
import { fridayCard } from './friday.js';
import { t, sortByName, matches } from './i18n.js';

/* unset: '' | 'any' | 'event' | 'shooter' | 'both'
   칩 하나를 누를 때마다 돌아간다. 예전에는 미분류·행사 미지정·사진사 미지정이
   칩 세 개였는데, 셋이 겹치는 뜻이라 무엇이 켜져 있는지 읽기 어려웠다.
   'any'(둘 중 하나라도 없음)는 홈의 "정할 사진" 에서 들어올 때만 쓴다. */
/* 묶음 보기 상태는 기기에만 남긴다.
   접어 둔 것이 새로 열 때마다 다 펼쳐져 있으면 접는 의미가 없다.
   카탈로그(드라이브)에는 넣지 않는다 — 화면 상태라 기기마다 다른 게
   자연스럽고, 동기화 충돌을 늘릴 이유가 없다.
   펼친 장수(gLimit)는 남기지 않는다: 새로 열 때는 다시 12장부터가 맞다. */
const VIEW_KEY = 'cd.view.v1';

function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    if (v.group === null || ['event', 'shooter', 'person'].includes(v.group)) V.group = v.group;
    if (Array.isArray(v.collapsed)) V.collapsed = new Set(v.collapsed);
    if (typeof v.keepSel === 'boolean') V.keepSel = v.keepSel;
  } catch { /* 값이 깨졌으면 기본값으로 둔다 */ }
}

function saveView() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ group: V.group, collapsed: [...V.collapsed], keepSel: V.keepSel }));
  } catch { /* 프라이빗 모드 */ }
}

export const NO_FILTER = () => ({ unset: '', unused: false, planned: false, event: null, shooter: null, person: null, tag: null });
export const hasFilter = f => !!f.unset || f.unused || f.planned || !!f.event || !!f.shooter || !!f.person || !!f.tag;

export const V = {
  tab: 'home',
  axis: 'event',
  filter: { unset: '', unused: false, planned: false, event: null, shooter: null, person: null, tag: null },
  /* 사진 탭 임시 묶음. null 이면 예전처럼 한 덩어리. */
  group: 'event',
  collapsed: new Set(),   // 접어 둔 묶음 열쇠
  gLimit: new Map(),      // 묶음별로 몇 장까지 펼쳤나
  limit: 60,
  selecting: false,
  sel: new Set(),
  onSync: null,   // app.js 가 주입
  onPickFolders: null,
  keepSel: false,   // 지정 후 선택 모드를 유지할지 (연속 지정)
  onPrefetch: null,
};

loadView();

const TABS = () => [
  ['home', S.cat.opts.homeTab || S.cat.opts.homeTitle || t('tab.home'), 'layers'],
  ['photos', t('tab.photos'), 'grid'],
  ['schedule', t('tab.schedule'), 'cal'],
  ['profile', t('tab.profile'), 'user'],
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
    /* .g-sheen 은 테두리 색 번짐(색수차 흉내) 한 겹.
       배경 처리를 중앙/테두리로 나눠 굴절을 흉내내 봤지만, 실제 아이폰에서
       중앙 층의 윤곽이 드러나 뿌연 덩어리로 분리돼 보였다. 필터는 한 번만
       걸고 테두리는 그려서 만든다(.tabbar::before). */
    bar.innerHTML = '<div class="g-sheen"></div>'
      + '<div class="tablight"></div><div class="tabknob"><i></i></div>'
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

/* 지금 안 보이는 탭 중 다시 그려야 할 것들.
 *
 * 화면은 display:none 이라 안 보이는 탭의 타일은 스크롤 로딩이 걸리지 않는다.
 * 그런데 warm() 의 "앞쪽 몇 장" 은 보이든 말든 즉시 받는다. renderAll() 이
 * 네 화면을 다 그렸으니, 앱을 열자마자 네 화면 몫의 썸네일이 한꺼번에
 * 쏟아졌다 — 정작 눈에 보이는 건 한 화면인데.
 *
 * 그래서 보이는 탭만 그리고 나머지는 표시만 해둔다. 그 탭으로 넘어가는
 * 순간 그린다. 사용자가 보는 것은 똑같고, 한 번에 받는 양은 1/4 이 된다. */
const stale = new Set();

function paintTab(k) {
  stale.delete(k);
  if (k === 'home') renderHome();
  else if (k === 'photos') renderPhotos();
  else if (k === 'schedule') renderSchedule();
  else if (k === 'profile') renderProfile();
}

export function goTab(k) {
  V.tab = k;
  document.querySelectorAll('.screen').forEach(s => {
    const on = s.dataset.screen === k;
    s.classList.toggle('on', on);
    if (on) { s.classList.remove('enter'); void s.offsetWidth; s.classList.add('enter'); }
  });
  renderTabs();
  paintTab(k);
}

/* index.html 에 박아 둔 라벨들. 언어를 바꾸면 이것들도 같이 따라와야 한다.
   화면마다 흩어 두면 하나씩 빠뜨리게 되므로 한 곳에서 다 쓴다. */
function applyStaticLabels() {
  const set = (sel, tx) => { const n = document.querySelector(sel); if (n) n.textContent = tx; };
  set('[data-screen="schedule"] .hdr h1', t('tab.schedule'));
  set('[data-screen="profile"] .hdr h1', t('tab.profile'));
  /* 설정은 아이콘만 둔다 — 글자를 같이 두면 헤더가 좁아진다.
     읽어 주는 이름은 aria-label 로 남긴다. */
  const ps = $('#prof-set');
  if (ps) {
    ps.innerHTML = ic('sliders', 20, 2.1);
    ps.setAttribute('aria-label', t('tab.settings'));
  }
  /* 아이콘이 붙었으니 textContent 로 쓰면 아이콘이 지워진다. */
  const sb = $('#home-sync');
  if (sb) sb.innerHTML = `${ic('refresh', 15, 2.3)}<span>${t('home.sync')}</span>`;
  set('#flt-reset', t('filter.reset'));
  set('#sel-toggle', V.selecting ? t('photos.cancel') : t('photos.select'));
  set('#sb-more', t('sel.more'));
}

export function renderAll() {
  applyStaticLabels();
  renderTabs();
  ['home', 'photos', 'schedule', 'profile'].forEach(k => { if (k !== V.tab) stale.add(k); });
  paintTab(V.tab);
}

/* ============================ 모아보기 ============================ */

function counts(list) {
  const u = list.filter(isUsed).length;
  return `${t('group.meta', { n: fmt(list.length) })}${u ? ` · <span class="hi">${t('group.metaUsed', { n: fmt(u) })}</span>` : ''}`;
}

function groups(axis) {
  const all = photos();
  if (axis === 'event') {
    const out = S.cat.events.map(e => {
      const list = all.filter(p => p.event === e.id);
      return { key: e.id, title: e.name, meta: `${sug.fmtDate(e.date)}${e.date ? ' · ' : ''}${counts(list)}`, list, cover: true, ev: e };
    });
    const un = all.filter(p => !p.event);
    if (un.length) out.push({ key: null, title: t('group.noneEvent'), meta: counts(un), list: un, cover: true, unfiled: true });
    return out;
  }
  if (axis === 'shooter') {
    const out = S.cat.shooters.map(s => {
      const list = all.filter(p => p.shooter === s.id);
      return { key: s.id, title: s.name, meta: `${s.x ? '@' + s.x : t('common.noXId')} · ${counts(list)}`, list, av: s, ent: s };
    }).sort((a, b) => b.list.length - a.list.length);
    const un = all.filter(p => !p.shooter);
    if (un.length) out.push({ key: null, title: t('group.noneShooter'), meta: counts(un), list: un, unfiled: true });
    return out;
  }
  return S.cat.people.map(p => {
    const list = all.filter(x => (x.people || []).includes(p.id));
    return { key: p.id, title: p.name, meta: `${p.role || (p.x ? '@' + p.x : t('group.noRole'))} · ${counts(list)}`, list, av: p, ent: p };
  }).filter(g => g.list.length).sort((a, b) => b.list.length - a.list.length);
}

export function renderHome() {
  const sc = $('#home-scroll');
  if (!sc) return;
  const h1 = document.querySelector('[data-screen="home"] .hdr h1');
  if (h1) h1.textContent = S.cat.opts.homeTitle || t('tab.home');
  keepScroll(sc, () => paintHome(sc));
}

/** 홈 헤더의 동기화 버튼. app.js 의 wireShell 에서 한 번만 배선한다. */
export function wireHomeSync() {
  const b = $('#home-sync');
  if (b) b.onclick = () => V.onSync?.();
}

/** "3시간 전" 처럼. 방금 돌린 건지 어제 것인지가 지금 눌러야 할지를 정한다. */
function agoText(iso) {
  if (!iso) return t('ago.never');
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return t('ago.just');
  if (m < 60) return t('ago.min', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('ago.hour', { n: h });
  return t('ago.day', { n: Math.floor(h / 24) });
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
  const all6 = sug.build();
  /* 제안은 최대 6개까지 만들어지고 카드마다 썸네일이 붙는다. 홈을 열자마자
     그게 전부 로딩되니 첫 화면이 제일 무거웠다. 한 번에 처리할 수 있는 건
     어차피 하나뿐이라 세 장만 놓고, 하나 처리하면 다음 것이 올라온다. */
  const list = all6.slice(0, 3);
  if (list.length) {
    const s = el('div', 'sec');
    const lb = el('div', 'sec-lb', `<h2>${t('sug.head')}</h2><span class="n">${all6.length}</span>`);
    lb.style.marginTop = '4px';
    s.appendChild(lb);
    const box = el('div', '');
    list.forEach((g, i) => box.appendChild(sugCard(g, i === 0)));
    s.appendChild(box);
    sc.appendChild(s);
  }

  /* --- 스트립 --- */
  const strips = el('div', 'sec stagger');
  strips.style.marginTop = '20px';
  const unfiled = all.filter(isUnfiled).length;
  const planned = all.filter(isPlanned).length;

  if (unfiled) {
    const b = el('button', 'strip blue', `<span class="k">${t('home.toFile')}</span><span class="v">${t('common.photoN', { n: fmt(unfiled) })}</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
    b.onclick = () => { V.filter = { ...NO_FILTER(), unset: 'any' }; V.limit = 60; goTab('photos'); };
    strips.appendChild(b);
  }

  /* 예전에는 "아직 안 올린 사진" 이 여기 있었다. 그 숫자는 대개 수백 장이라
     보고도 할 일이 정해지지 않았다. 내가 올리기로 고른 것만 세는 편이
     행동으로 이어진다. 미사용 전체는 사진 탭의 "미사용만" 칩에 남아 있다.

     0장이어도 줄은 남긴다 — 홈에서 예정 목록으로 들어가는 길이 여기뿐이라,
     비었다고 사라지면 담아둔 걸 확인하는 방법을 잃는다. 대신 색은 빼서
     할 일이 없다는 걸 보이게 한다. */
  const b2 = el('button', 'strip' + (planned ? ' plan' : ''),
    `<span class="k">${t('home.planned')}</span><span class="v">${t('common.photoN', { n: fmt(planned) })}</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
  b2.style.marginTop = unfiled ? '8px' : '0';
  b2.onclick = () => {
    if (!planned) { toast(t('home.plannedHint')); return; }
    V.filter = { ...NO_FILTER(), planned: true }; V.limit = 60; goTab('photos');
  };
  strips.appendChild(b2);

  sc.appendChild(strips);

  /* 마지막 동기화 시각은 헤더의 동기화 버튼 왼쪽에 작게 붙인다.
     예전에는 목록 아래에 한 줄을 통째로 차지했는데, 자주 보는 값이 아니라
     자리값이 아까웠다. 눌러야 하는 버튼 옆이 읽는 자리로도 맞다. */
  const agoEl = $('#home-ago');
  if (agoEl) agoEl.textContent = agoText(S.cat.syncedAt);

  /* --- 축 --- */
  // 축을 바꿀 때 홈 전체를 다시 그리면 세그먼트가 새로 생겨 알약이 안 움직인다.
  // 그래서 목록만 갈아 끼운다.
  const segw = segment(
    [['event', t('axis.event')], ['shooter', t('axis.shooter')], ['person', t('axis.person')]],
    V.axis,
    v => { V.axis = v; paintGroups($('#home-groups')); },
  );
  /* 같은 기준으로 사진을 훑고 싶을 때가 있다. 모아보기는 묶음 목록이지만
     여기서는 사진 자체를 봐야 한다. 그래서 사진 탭으로 넘기고 그 탭에서
     같은 기준으로 묶어 보여준다. */
  const go = el('button', 'axis-go', ic('chev', 20, 2.4));
  go.setAttribute('aria-label', t('axis.goPhotos'));
  go.onclick = () => {
    V.group = V.axis;
    V.filter = NO_FILTER();
    /* 접어 둔 것은 그대로 둔다 — 열쇠에 축 접두사(e:/s:/p:)가 붙어 있어
       축을 옮겨도 섞이지 않고, 돌아오면 접어 뒀던 상태가 복원된다. */
    V.gLimit.clear();
    saveView();
    goTab('photos');
  };
  segw.appendChild(go);
  sc.appendChild(segw);

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
  const lb = el('div', 'sec-lb', `<h2>${t(V.axis === 'event' ? 'group.event' : V.axis === 'shooter' ? 'group.shooter' : 'group.person')}</h2><span class="n">${gs.length}</span>`);
  lb.style.marginTop = '4px';
  wrap.appendChild(lb);

  if (!gs.length) {
    wrap.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t(V.axis === 'person' ? 'group.emptyPerson' : 'group.empty')}</span>`));
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
  th.warm(box.querySelectorAll('img[data-fid]'), 4);
}

/* 사진이 0장인 두 경우를 갈라 준다.
 *
 * 폴더를 아직 안 붙였을 때와, 붙였는데 한 번도 동기화하지 않았을 때는
 * 해야 할 일이 다르다. 예전에는 둘 다 "폴더 고르기" 를 내밀었는데, 폴더를
 * 이미 붙여 둔 사람에게는 그게 고장으로 보인다 — 붙였는데 왜 또 고르라는지.
 * 동기화가 안 된 경우에는 동기화 버튼을 내민다. */
function emptyState() {
  if (S.cat.folders.length && !S.cat.syncedAt) {
    return result({
      icon: 'refresh',
      title: t('res.syncTitle'),
      lead: t('res.syncLead'),
      cta: t('set.syncNow'),
      onCta: () => V.onSync?.(),
    });
  }
  return result({
    icon: 'folder',
    title: t('empty.title'),
    lead: t('empty.lead'),
    cta: t('empty.pick'),
    onCta: () => V.onPickFolders?.(),
  });
}

function sugCard(g, eager = false) {
  const c = el('div', 'sug');
  // 다섯 장은 무엇에 대한 제안인지 알기에 과했다. 세 장이면 충분하다.
  const thumbs = g.ids.slice(0, 3).map(id => `<img data-fid="${id}" alt="" decoding="async">`).join('');
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
  const MAKES = g.kind === 'newEvent' || g.kind === 'folderEvent';
  const yes = el('button', 'yes', t(MAKES ? 'sug.make' : 'sug.yes'));
  const no = el('button', '', t(MAKES ? 'sug.later' : 'sug.no'));
  yes.onclick = () => {
    if (g.kind === 'newEvent') { newEventSheet(g); return; }
    /* 폴더 제안은 만들 이름이 필요하다. 먼저 사진을 훑어 아닌 것을 빼고,
       그 다음에 이름을 정한다 — 사진을 보고 나서야 이름이 맞는지 안다. */
    if (g.kind === 'folderEvent') {
      /* 폴더가 곧 새 행사인 경우가 많지만, 이미 만들어 둔 행사에 넣고 싶을
         때도 있다(같은 행사를 폴더 두 개로 나눠 뒀거나, 다른 기기에서 이미
         만들었거나). 날짜 뭉치 제안과 같은 시트를 쓰면 그 선택이 그대로
         따라온다 — 기존 행사 목록 / 새 행사 만들기 / 검토까지. */
      const day = g.ids.map(id => S.cat.photos[id]?.shotAt).filter(Boolean).sort()[0]?.slice(0, 10) || '';
      newEventSheet({ ...g, date: day, name: g.folderName, folderName: g.folderName });
      return;
    }
    if (g.kind === 'folderShooter') {
      reviewSheet({
        title: g.folderName || g.q,
        ids: g.ids,
        okKey: 'sug.folderReview',
        onApply: keep => folderSheet(g, keep, () => { dropCard(c); renderTabs(); }),
      });
      return;
    }
    reviewSheet({
      title: g.q,
      ids: g.ids,
      onApply: keep => {
        sug.accept(g, { always, ids: keep });
        closeSheet();
        dropCard(c);
        const out = g.ids.length - keep.length;
        toast(out ? t('sug.appliedSome', { n: fmt(keep.length), out: fmt(out) }) : t('sug.applied', { n: fmt(keep.length) }));
        renderTabs();
      },
    });
  };
  no.onclick = () => {
    if (MAKES) sug.later(g.key); else sug.dismiss(g.key);
    dropCard(c);
    renderTabs();
  };
  acts.appendChild(yes); acts.appendChild(no);
  c.appendChild(acts);
  // 맨 위 카드만 바로 받는다. 나머지는 화면에 들어올 때 받는다.
  requestAnimationFrame(() => th.warm(c.querySelectorAll('img[data-fid]'), eager ? 3 : 0));
  return c;
}

/* 제안을 받아들이기 전에 아닌 사진을 빼는 화면.
 *
 * 카메라·날짜로 묶은 제안은 대개 맞지만 항상 맞지는 않다 — 같은 날 다른
 * 행사에 갔거나, 남의 카메라를 잠깐 썼거나. 예전에는 "맞아요" 가 묶음
 * 전체에 그대로 들어가서, 틀린 것을 나중에 한 장씩 되돌려야 했다.
 * 그래서 받아들이기 전에 눈으로 훑고 뺄 수 있게 한다.
 *
 * 처음에는 전부 켜져 있다. 대개 맞기 때문에, 맞는 것을 고르는 것보다
 * 아닌 것을 빼는 쪽이 손이 덜 간다.
 */
/**
 * 격자에서 아닌 것을 빼는 화면.
 * @param preset 처음부터 켜져 있을 id 들. 안 주면 전부 켜진 상태로 시작한다.
 *   행사에서 캐릭터를 가를 때는 이미 그 캐릭터로 붙은 사진만 켜져 있어야
 *   해서 이 값을 쓴다 — 전부 켜진 채로 열면 뺐던 것이 다시 붙는다.
 */
function reviewSheet({ title, ids, onApply, okKey = 'sug.reviewApply', preset = null }) {
  const keep = new Set(preset || ids);

  openSheet(`<h3>${esc(title)}</h3>`
    + `<p class="lead">${t('sug.reviewLead')}</p>`
    + `<div class="sug-rev" id="sr-grid"></div>`
    + `<button class="btn sub" id="sr-all" style="width:100%;margin-top:10px"></button>`
    + `<button class="btn" id="sr-ok" style="margin-top:8px"></button>`);

  const g = { ids };
  const grid = $('#sr-grid');
  const paint = () => {
    const n = keep.size;
    const ok = $('#sr-ok');
    ok.textContent = n ? t(okKey, { n: fmt(n) }) : t('sug.reviewNone');
    ok.disabled = !n;
    $('#sr-all').textContent = t(n === g.ids.length ? 'sug.reviewAllOff' : 'sug.reviewAllOn');
  };

  g.ids.forEach(id => {
    const p = S.cat.photos[id];
    const cell2 = el('button', 'cell' + (keep.has(id) ? ' sel' : ''));
    cell2.innerHTML = `<img data-fid="${id}" alt="${esc(p?.name || '')}" decoding="async">`
      + `<span class="pick"><i>${ic('check', 12, 3)}</i></span>`;
    cell2.onclick = () => {
      const on = keep.has(id);
      if (on) keep.delete(id); else keep.add(id);
      cell2.classList.toggle('sel', !on);
      paint();
    };
    grid.appendChild(cell2);
  });
  paint();

  $('#sr-all').onclick = () => {
    const clearAll = keep.size === g.ids.length;   // 전부 켜져 있으면 전부 뺀다
    keep.clear();
    if (!clearAll) g.ids.forEach(id => keep.add(id));
    grid.querySelectorAll('.cell').forEach(x => x.classList.toggle('sel', !clearAll));
    paint();
  };

  $('#sr-ok').onclick = () => {
    if (!keep.size) return;
    onApply([...keep]);
  };

  // 검토하려면 다 보여야 한다 — 카드 썸네일과 달리 넉넉히 받는다.
  requestAnimationFrame(() => th.warm(grid.querySelectorAll('img[data-fid]'), 16));
}

/* 폴더 → 사진사 제안을 받아들이는 시트.
 *
 * 자동으로 만들지 않는 이유: 폴더 이름이 늘 쓸 만하지는 않다.
 * `2026-07-19`, `정리`, `보정`, `new` 같은 이름이 흔하다. 그래서 미리 채운
 * 칸을 보여주고 고칠 기회를 준다. 날짜는 그 폴더 사진 중 가장 이른 날로 채운다.
 */
function folderSheet(g, keep, done) {
  openSheet(`<h3>${esc(g.q)}</h3><p class="lead">${t('sug.folderNameLead')}</p>`
    + `<div class="fld"><label for="fs-name">${t('ent.name')}</label>`
    + `<input id="fs-name" maxlength="60" value="${esc(g.folderName || '')}"></div>`
    + `<div class="fld"><label for="fs-x">${t('nx.xOpt')}</label>`
    + `<input id="fs-x" maxlength="60" placeholder="${t('nx.xPh')}" autocapitalize="off" autocorrect="off">`
    + `<div class="detect" id="fs-det"></div></div>`
    + `<button class="btn" id="fs-save">${t('sug.folderMake', { n: fmt(keep.length) })}</button>`);

  const nameEl = $('#fs-name');
  const xf = wireXField($('#fs-x'), $('#fs-det'));

  $('#fs-save').onclick = async () => {
    const nm = nameEl.value.trim();
    if (!nm) { nameEl.focus(); return; }
    const btn = $('#fs-save');
    btn.disabled = true;

    btn.textContent = t('xf.checking');
    const avatar = await xf.settle();

    const ent = addShooter(nm, $('#fs-x').value);
    if (avatar) ent.avatar = avatar;

    // 이미 지정된 사진은 건드리지 않는다 — 사용자가 손으로 정한 것이 우선이다
    keep.forEach(id => {
      const p = S.cat.photos[id];
      if (p && !p.shooter) p.shooter = ent.id;
    });

    sug.dismiss(g.key);
    touch();
    closeSheet();
    toast(t('sug.folderDone', { name: esc(nm), n: fmt(keep.length) }));
    done();
  };
  setTimeout(() => nameEl.focus(), 340);
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

    openSheet(`<h3>${g.folderName
      ? t('sug.folderDone', { name: esc(g.folderName), n: fmt(g.ids.length) })
      : t('ne.title', { date: sug.fmtDate(g.date), n: fmt(g.ids.length) })}</h3>`
      + `<p class="lead">${t('ne.lead')}</p>`
      + `<div id="ne-seg"></div>`
      + (mode === 'join'
        ? `<div class="opts" id="ne-list">`
          + near.map(({ e, gap }) => `<button class="opt" data-id="${e.id}">`
            + `<span class="l">${e.icon ? esc(e.icon) + ' ' : ''}${esc(e.name)}</span>`
            + `<span class="n">${e.date ? (gap === 0 ? t('ne.sameDay') : gap <= 3 ? t('ne.gapDays', { n: gap }) : sug.fmtDate(e.date)) : t('sched.noDate')}</span>`
            + `<span class="c">${ic('chev', 17, 2.2)}</span></button>`).join('')
          + `</div>`
        : `<div class="fld"><label for="ne-name">${t('ne.name')}</label>`
          + `<input id="ne-name" placeholder="${t('ne.namePh')}" maxlength="60" value="${esc(g.name || '')}">`
          + (g.folderName ? `<div class="hint">${t('sug.folderNameLead')}</div>` : '')
          + `</div>`
          + `<div class="fld"><label for="ne-date">${t('ne.date')}</label><input id="ne-date" type="date" value="${g.date}"></div>`
          + `<button class="btn" id="ne-save">${t('ne.save', { n: fmt(g.ids.length) })}</button>`));

    if (S.cat.events.length) {
      $('#ne-seg').appendChild(segment([['join', t('ne.join')], ['new', t('ne.new')]], mode, v => { mode = v; render(); }));
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
    const label = esc(newName || e?.name || '');
    /* 날짜 뭉치도 통째로 맞지는 않는다 — 이틀짜리 행사에 걸치거나, 같은 날
       다른 데를 들렀거나. 붙이기 전에 아닌 것을 뺄 수 있게 한 번 보여준다. */
    reviewSheet({
      title: t('rev.title', { label }),
      ids: g.ids,
      onApply: keep => {
        keep.forEach(id => { const p = S.cat.photos[id]; if (p && !p.event) p.event = eventId; });
        sug.dismiss(g.key);
        touch();
        closeSheet();
        const out = g.ids.length - keep.length;
        toast(out ? t('rev.doneOut', { label, n: fmt(keep.length), out: fmt(out) }) : t('rev.done', { label, n: fmt(keep.length) }));
        renderAll();
      },
    });
  };

  render();
}

/* ============================ 그룹 상세 ============================ */

function openGroup(axis, g) {
  const u = g.list.filter(isUsed).length;
  push(g.title, sc => {
    const hd = el('div', 'gtitle');
    const sub = axis === 'event'
      ? (g.ev?.date ? sug.fmtDate(g.ev.date) : t('sched.noDate'))
      : axis === 'shooter' ? (g.ent?.x ? '' : t('common.noXId'))
        : (g.ent?.role || '');
    hd.innerHTML = `<h2>${esc(g.title)}</h2>`
      + `<div class="m">${[sub, t('common.photoN', { n: fmt(g.list.length) }),
        t('group.usedN', { n: fmt(u) })].filter(Boolean).join(' · ')}</div>`
      + (g.ent?.x ? `<div class="x">@${esc(g.ent.x)}</div>` : '');
    sc.appendChild(hd);

    const s1 = el('div', 'sec');
    s1.style.marginTop = '18px';
    const strip = el('button', 'strip blue', `<span class="k">${t('grp.notPosted')}</span><span class="v">${t('common.photoN', { n: fmt(g.list.length - u) })}</span><span class="chev">${ic('chev', 17, 2.2)}</span>`);
    strip.onclick = () => {
      applyAxis(axis, g.key);
      V.filter.unused = true; V.limit = 60;
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
      sec.appendChild(el('div', 'sec-lb', `<h2>${t('grp.shooters')}</h2><span class="n">${t('grp.peopleN', { n: crew.length })}</span>`));
      const box = el('div', 'card');
      crew.forEach(({ s, n }) => {
        const r = el('button', 'row');
        r.innerHTML = avatarHTML(s.name, s.avatar)
          + `<span class="grow"><span class="t">${esc(s.name)}</span><span class="d${s.x ? ' x' : ''}">${s.x ? '@' + esc(s.x) : t('common.noXId')}</span></span>`
          + `<span class="n-sm">${t('common.photoN', { n: fmt(n) })}</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
        r.onclick = () => { applyAxis('event', g.key); V.filter.shooter = s.id; V.limit = 60; goTab('photos'); popAll(); };
        box.appendChild(r);
      });
      if (none) {
        /* 카메라 모델별로 묶어 제안한다. 같은 바디로 찍힌 사진은 대개 같은
           사진사라, 여기서 한 번 지정하면 그 묶음이 통째로 정리된다.
           이게 "확인할 것" 의 카메라→사진사 제안이 학습할 씨앗도 된다. */
        const byCam = new Map();
        g.list.filter(p => !p.shooter).forEach(p => {
          const k = p.cameraModel || t('sched.noCamera');
          if (!byCam.has(k)) byCam.set(k, []);
          byCam.get(k).push(p.id);
        });
        [...byCam.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([cam, ids]) => {
          const r = el('button', 'row');
          r.innerHTML = `<span class="row-ico" style="background:var(--amber-fill);color:var(--amber)">${ic('cam', 18)}</span>`
            + `<span class="grow"><span class="t" style="color:var(--amber)">${t('grp.assignShooter')}</span>`
            + `<span class="d">${esc(cam)}</span></span>`
            + `<span class="n-sm">${t('common.photoN', { n: fmt(ids.length) })}</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
          /* 일정 탭의 같은 행과 동작을 맞춘다 — 먼저 어떤 사진인지 보여주고
             아닌 것을 뺀 뒤에 사진사를 고른다. */
          r.onclick = () => {
            reviewSheet({
              title: esc(cam),
              ids,
              okKey: 'sug.reviewPick',
              onApply: keep => {
                V.sel = new Set(keep);
                assignSheet('shooter', () => { popAll(); renderAll(); });
              },
            });
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
      const b = el('button', 'btn sub', `${ic('user', 17, 2)}${t('grp.editInfo')}`);
      b.style.width = '100%';
      b.onclick = () => entitySheet(axis === 'shooter' ? 'shooter' : 'person', g.ent, () => { popAll(); renderAll(); });
      sec.appendChild(b);
      sc.appendChild(sec);
    }

    const lb = el('div', 'sec');
    lb.appendChild(el('div', 'sec-lb', `<h2>${t('grp.unusedFirst')}</h2><span class="n">${t('common.photoN', { n: fmt(g.list.length - u) })}</span>`));
    sc.appendChild(lb);
    const sorted = [...g.list].sort((a, b) => (isUsed(a) ? 1 : 0) - (isUsed(b) ? 1 : 0));
    const grid = el('div', 'grid');
    sorted.slice(0, 60).forEach(p => grid.appendChild(cell(p)));
    sc.appendChild(grid);
    th.warm(grid.querySelectorAll('img[data-fid]'), 6);
  });
}

function applyAxis(axis, key) {
  V.filter = NO_FILTER();
  if (key == null) { V.filter.unset = axis === 'shooter' ? 'shooter' : 'event'; return; }
  if (axis === 'event') V.filter.event = key;
  else if (axis === 'shooter') V.filter.shooter = key;
  else V.filter.person = key;
}

/* ============================ 사진 ============================ */

function filtered() {
  const f = V.filter;
  return photos().filter(p => {
    /* 한쪽만 없는 것과 둘 다 없는 것은 다른 일이다. 사진사만 없는 사진은
       행사가 이미 정해져 있어서, 행사별로 훑으며 사진사만 붙이면 된다. */
    if (f.unset === 'any' && !isUnfiled(p)) return false;
    if (f.unset === 'event' && p.event) return false;
    if (f.unset === 'shooter' && p.shooter) return false;
    if (f.unset === 'both' && (p.event || p.shooter)) return false;
    if (f.unused && isUsed(p)) return false;
    if (f.planned && !isPlanned(p)) return false;
    if (f.event && p.event !== f.event) return false;
    if (f.shooter && p.shooter !== f.shooter) return false;
    if (f.person && !(p.people || []).includes(f.person)) return false;
    if (f.tag && !(p.tags || []).includes(f.tag)) return false;
    return true;
  }).sort(f.planned
    /* 대기열은 담은 순서가 곧 올릴 순서다. 촬영 시각으로 정렬하면
       "먼저 담은 것" 이 뒤로 밀려 줄이 뜻을 잃는다. */
    ? (a, b) => String(a.plannedAt || '').localeCompare(String(b.plannedAt || ''))
    : (a, b) => String(b.shotAt || '').localeCompare(String(a.shotAt || '')));
}

export function renderPhotos() {
  const sc = $('#ph-scroll');
  if (!sc) return;
  keepScroll(sc, () => paintPhotos(sc));
}

const GROUP_PAGE = 12;   // 묶음 하나에서 한 번에 보여줄 장수

const AXIS_LB = () => ({ event: t('axis.event'), shooter: t('axis.shooter'), person: t('axis.person') });

/* 사진 탭의 **임시** 묶음.
 * 사진 자체에는 순서(촬영시각)밖에 없다. 그래도 정리할 때는 "이 행사 것만
 * 모아 놓고 훑는" 편이 훨씬 빠르다. 그래서 화면에서만 묶는다 —
 * 카탈로그에는 아무것도 쓰지 않고, 필터를 걸면 그 결과 안에서 다시 묶는다.
 *
 * 퍼슈트는 한 사진에 여러 명이 붙을 수 있어서 같은 사진이 여러 묶음에
 * 나온다. 그게 맞다 — "이 친구와 찍은 컷" 을 보러 온 것이니까.
 */
function groupFiltered(axis, list) {
  const mk = (key, title, sub, arr) => ({ key, title, sub, list: arr });
  let out;
  if (axis === 'event') {
    out = eventsByDate().map(e => mk('e:' + e.id, e.name, e.date ? sug.fmtDate(e.date) : t('sched.noDate'), list.filter(p => p.event === e.id)));
    out.push(mk('e:none', t('group.noneEvent'), '', list.filter(p => !p.event)));
  } else if (axis === 'shooter') {
    out = S.cat.shooters.map(x => mk('s:' + x.id, x.name, x.x ? '@' + x.x : '', list.filter(p => p.shooter === x.id)))
      .sort((a, b) => b.list.length - a.list.length);
    out.push(mk('s:none', t('group.noneShooter'), '', list.filter(p => !p.shooter)));
  } else {
    out = S.cat.people.map(x => mk('p:' + x.id, x.name, x.role || (x.x ? '@' + x.x : ''), list.filter(p => (p.people || []).includes(x.id))))
      .sort((a, b) => b.list.length - a.list.length);
    out.push(mk('p:none', t('group.nonePerson'), '', list.filter(p => !(p.people || []).length)));
  }
  return out.filter(g => g.list.length);   // 빈 묶음은 접을 것도 없다
}

/** 묶음 하나의 사진 격자. 더 보기는 그 묶음 안에서만 늘어난다. */
function fillGroup(body, g) {
  body.innerHTML = '';
  const lim = V.gLimit.get(g.key) || GROUP_PAGE;
  const grid = el('div', 'grid');
  g.list.slice(0, lim).forEach((p, i) => grid.appendChild(cell(p, i)));
  body.appendChild(grid);
  th.warm(grid.querySelectorAll('img[data-fid]'), 6);
  if (g.list.length > lim) {
    const f = el('div', 'gridfoot');
    const b = el('button', 'more', t('photos.more', { n: fmt(Math.min(GROUP_PAGE, g.list.length - lim)) }));
    b.onclick = () => { V.gLimit.set(g.key, lim + GROUP_PAGE); fillGroup(body, g); };
    f.appendChild(b);
    body.appendChild(f);
  }
}

/* 필터가 이미 그 축의 한 항목으로 좁혀 놨으면 묶을 것이 없다 —
   묶음이 하나뿐인 화면에 헤더만 얹히면 방해만 된다. */
const pinned = axis => !!V.filter[axis];

function paintGrouped(sc, list) {
  const gs = groupFiltered(V.group, list);

  const bar = el('div', 'gbar', `<span>${t('group.mode', { axis: AXIS_LB()[V.group] })}</span>`);
  const off = el('button', '', t('group.off'));
  off.onclick = () => { V.group = null; saveView(); renderPhotos(); };
  bar.appendChild(off);
  sc.appendChild(bar);

  gs.forEach(g => {
    const open = !V.collapsed.has(g.key);
    const head = el('button', 'ghead' + (open ? ' on' : ''),
      `${ic('chev', 17, 2.4)}<span class="t">${esc(g.title)}</span>`
      + (g.sub ? `<span class="s">${esc(g.sub)}</span>` : '')
      + `<span class="n">${t('common.photoN', { n: fmt(g.list.length) })}</span>`);
    const body = el('div', 'gbody');
    sc.appendChild(head);
    sc.appendChild(body);
    if (open) fillGroup(body, g);

    /* 접기는 제자리에서 처리한다. 목록 전체를 다시 그리면 화살표가 도는
       애니메이션이 죽고 스크롤이 튄다. */
    head.onclick = () => {
      const wasClosed = V.collapsed.has(g.key);
      if (wasClosed) V.collapsed.delete(g.key); else V.collapsed.add(g.key);
      head.classList.toggle('on', wasClosed);
      saveView();
      if (wasClosed) fillGroup(body, g); else body.innerHTML = '';
    };
  });
}

function paintFlat(sc, list) {
  const grid = el('div', 'grid');
  list.slice(0, V.limit).forEach((p, i) => grid.appendChild(cell(p, i)));
  sc.appendChild(grid);
  th.warm(grid.querySelectorAll('img[data-fid]'), 6);

  if (list.length > V.limit) {
    const f = el('div', 'gridfoot');
    const b = el('button', 'more', t('photos.more', { n: fmt(Math.min(60, list.length - V.limit)) }));
    b.onclick = () => { V.limit += 60; renderPhotos(); };
    f.appendChild(b);
    sc.appendChild(f);
  }
}

function paintPhotos(sc) {
  applyStaticLabels();
  const list = filtered();
  $('#ph-title').textContent = t('photos.count', { n: fmt(list.length) });
  $('#ph-chips').innerHTML = chipsHTML();
  $('#flt-reset').hidden = !hasFilter(V.filter);
  sc.innerHTML = '';

  if (!photos().length) {
    /* 사진이 한 장도 없으면 필터 칩은 고를 것이 없다 — 처음 들어온 사람
       화면에 동작하지 않는 줄이 하나 떠 있는 셈이라 접는다.
       필터가 다 걸러낸 경우(아래)는 반대로 칩이 남아 있어야 한다. */
    $('#ph-chips').hidden = true;
    sc.appendChild(emptyState());
    wireScroll();
    return;
  }
  $('#ph-chips').hidden = false;

  if (!list.length) {
    /* 여기까지 왔으면 사진은 있고 필터가 다 걸러낸 것이다. 안내만 띄우면
       필터를 어디서 푸는지 다시 찾아 올라가야 하니 푸는 버튼을 같이 준다. */
    sc.appendChild(result({
      icon: 'sliders',
      title: t('res.filterTitle'),
      lead: t('res.filterLead', { n: fmt(photos().length) }),
      cta: t('filter.reset'),
      onCta: () => {
        V.filter = NO_FILTER();
        V.limit = 60;
        saveView();
        renderPhotos();
        toast(t('filter.resetDone'));
      },
    }));
  } else if (V.group && !pinned(V.group)) {
    paintGrouped(sc, list);
  } else {
    paintFlat(sc, list);
  }

  $('#app').classList.toggle('selecting', V.selecting);
  wireScroll();
}

/* 미지정 칩의 상태와 표시. 누르면 다음 상태로 돌아간다. */
const UNSET_LB = () => ({ '': t('chip.unset'), any: t('chip.unset'), event: t('chip.unset.event'), shooter: t('chip.unset.shooter'), both: t('chip.unset.both') });
const UNSET_NEXT = { '': 'event', any: 'event', event: 'shooter', shooter: 'both', both: '' };

function chipsHTML() {
  const f = V.filter;
  const ev = f.event && eventById(f.event);
  const sh = f.shooter && shooterById(f.shooter);
  const pe = f.person && personById(f.person);
  return [
    `<button class="chip${f.unset ? ' on' : ''}" data-c="unset">${f.unset ? ic('check', 14, 2.6) : ''}${UNSET_LB()[f.unset]}</button>`,
    `<button class="chip${f.unused ? ' on' : ''}" data-c="unused">${f.unused ? ic('check', 14, 2.6) : ''}${t('chip.unused')}</button>`,
    `<button class="chip${f.planned ? ' on' : ''}" data-c="planned">${f.planned ? ic('check', 14, 2.6) : ic('bookmark', 13, 2.2)}${t('chip.planned')}</button>`,
    `<button class="chip${ev ? ' on' : ''}" data-c="event">${ev ? esc(ev.name) : t('chip.event')}${ic('chev', 13, 2.4)}</button>`,
    `<button class="chip${sh ? ' on' : ''}" data-c="shooter">${sh ? esc(sh.name) : t('chip.shooter')}${ic('chev', 13, 2.4)}</button>`,
    `<button class="chip${pe ? ' on' : ''}" data-c="person">${pe ? esc(pe.name) : t('chip.person')}${ic('chev', 13, 2.4)}</button>`,
    f.tag ? `<button class="chip on" data-c="tag">${esc(f.tag)}${ic('x', 13, 2.6)}</button>` : '',
  ].join('');
}

function cell(p, i) {
  const c = el('div', 'cell');
  /* 예정 표시가 사용됨보다 앞선다 — 지금 손이 가야 할 상태가 무엇인지가
     이미 끝난 일보다 먼저 보여야 한다. */
  const badge = isPlanned(p)
    ? `<span class="bdg plan">${ic('bookmark', 11, 2.6)}</span>`
    : isUsed(p)
      ? `<span class="bdg used">${ic('check', 13, 3)}</span>`
      : '';
  const flag = isUnfiled(p) ? `<span class="flag">${t('photos.unfiled')}</span>` : '';
  // 대기열을 보는 중이면 몇 번째로 올릴 것인지 적는다
  const seq = (V.filter.planned && i != null) ? `<span class="cnt">${i + 1}</span>` : '';
  c.innerHTML = `<img data-fid="${p.id}" alt="${esc(p.name || '')}" decoding="async">${badge}${flag}${seq}`
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
    V.limit = 60;
    if (c === 'unset') { f.unset = UNSET_NEXT[f.unset] ?? ''; renderPhotos(); }
    else if (c === 'unused') { f.unused = !f.unused; renderPhotos(); }
    else if (c === 'planned') { f.planned = !f.planned; renderPhotos(); }
    else if (c === 'tag') { f.tag = null; renderPhotos(); }
    else if (c === 'event') pickSheet(t('pick.event'), eventsByDate().map(e2 => ({ v: e2.id, l: e2.name, n: photos().filter(p => p.event === e2.id).length })), f.event, v => { f.event = v; renderPhotos(); });
    else if (c === 'shooter') pickSheet(t('pick.shooter'), sortByName(S.cat.shooters).map(s => ({ v: s.id, l: s.name, n: photos().filter(p => p.shooter === s.id).length })), f.shooter, v => { f.shooter = v; renderPhotos(); });
    else if (c === 'person') pickSheet(t('pick.person'), sortByName(S.cat.people).map(s => ({ v: s.id, l: s.name, n: photos().filter(p => (p.people || []).includes(s.id)).length })), f.person, v => { f.person = v; renderPhotos(); });
  });

  $('#flt-reset').onclick = () => {
    V.filter = NO_FILTER();
    V.limit = 60;
    renderPhotos();
    $('#ph-scroll').scrollTop = 0;
    toast(t('filter.resetDone'));
  };

  $('#sel-toggle').onclick = () => {
    V.selecting = !V.selecting;
    if (!V.selecting) V.sel.clear();
    $('#sel-toggle').textContent = V.selecting ? t('photos.cancel') : t('photos.select');
    updateSelbar();
    renderPhotos();
  };
  $('#sb-assign').onclick = () => assignBothSheet();
  $('#sb-more').onclick = () => moreSheet();
}

function updateSelbar() {
  const on = V.selecting, n = V.sel.size;
  $('#selbar').classList.toggle('on', on);
  $('#tabbar').style.display = on ? 'none' : '';
  $('#sb-assign').textContent = n ? t('sel.assignN', { n }) : t('sel.assign');
  ['#sb-assign', '#sb-more'].forEach(s => { $(s).disabled = !n; });
}

/* 지정을 끝낸 뒤 무엇을 할지.
 *
 * 예전에는 항상 선택 모드를 껐다. 그런데 실제 정리는 "이 묶음은 A행사,
 * 다음 묶음은 B행사" 처럼 연달아 이어지므로, 매번 선택 → 지정 → (모드 꺼짐)
 * → 다시 선택 을 반복해야 했다. 켜 두면 고른 것만 비우고 모드는 남긴다. */
function afterAssign() {
  if (!V.keepSel) { exitSelect(); return; }
  V.sel.clear();
  updateSelbar();
}

function exitSelect() {
  V.selecting = false; V.sel.clear();
  $('#sel-toggle').textContent = t('photos.select');
  updateSelbar();
}

/* 행사를 고르는 목록의 순서. 사진을 정리하는 시점은 대개 행사 직후라,
   방금 다녀온 것이 손에 가장 가깝다. 그래서 최근 날짜가 위로 온다.
   날짜를 아직 안 넣은 행사는 비교할 기준이 없으니 맨 아래로 보낸다. */
const eventsByDate = () => [...S.cat.events].sort((a, b) => {
  // "행사 미상" 은 날짜가 없어도 날짜 미정 행사와 뜻이 다르다 — 항상 맨 아래.
  if (!!a.unknown !== !!b.unknown) return a.unknown ? 1 : -1;
  if (!a.date && !b.date) return (a.name || '').localeCompare(b.name || '', 'ko');
  if (!a.date) return 1;
  if (!b.date) return -1;
  return b.date.localeCompare(a.date);
});

/* ---------- 지정 시트 (행사 / 작가 / 인물) ---------- */

function assignSheet(kind, after) {
  const ids = [...V.sel];
  /* 행사는 날짜순을 지킨다 — 최근 것이 위에 와야 찾기 쉽다. 이름순으로 세우면
     "코믹월드 겨울" 여러 해가 뒤섞인다. 사람은 날짜가 없으니 이름순으로. */
  const list = kind === 'event' ? eventsByDate()
    : sortByName(kind === 'shooter' ? S.cat.shooters : S.cat.people);
  const label = t(kind === 'event' ? 'assign.event' : kind === 'shooter' ? 'assign.shooter' : 'assign.person');
  const rowHTML = x => {
    const n = ids.filter(id => {
      const p = S.cat.photos[id];
      return kind === 'person' ? (p?.people || []).includes(x.id) : p?.[kind] === x.id;
    }).length;
    const sub = kind === 'event' ? sug.fmtDate(x.date) : x.x ? '@' + x.x : '';
    return `<button class="opt${n === ids.length ? ' on' : ''}" data-id="${x.id}"><span class="l">${esc(x.name)}${sub ? ` <span class="n">${esc(sub)}</span>` : ''}</span>${n && n < ids.length ? `<span class="n">${n}/${ids.length}</span>` : '<span class="n"></span>'}<span class="c">${ic('check', 18, 2.8)}</span></button>`;
  };

  openSheet(`<h3>${t('assign.pick', { label })}</h3><p class="lead">${t('assign.lead', { n: fmt(ids.length) })}</p>`
    + `<div id="as-srch"></div>`
    + `<div class="opts" id="as-list"></div>`
    + `<button class="btn sub" id="as-new" style="width:100%">${ic('plus', 17, 2.2)}${t('assign.new', { label })}</button>`
    + (kind === 'person' ? '' : `<button class="btn sub" id="as-unknown" style="width:100%;margin-top:8px">${ic('info', 17, 2)}${t('assign.unknown', { label })}</button>`)
    + (list.length ? `<button class="btn sub" id="as-clear" style="width:100%;margin-top:8px">${t('assign.clear', { label })}</button>` : ''));

  const listBox = $('#as-list');
  const paintList = q => {
    const hit = list.filter(x => matches(q, x.name, x.x));
    listBox.innerHTML = hit.length
      ? hit.map(rowHTML).join('')
      : `<div class="nohit">${t('srch.none')}</div>`;
  };
  if (list.length >= 8) {
    $('#as-srch').appendChild(searchRow(t('srch.ph', { label }), paintList));
  }
  paintList('');

  listBox.onclick = e => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    apply(b.dataset.id);
  };
  $('#as-new').onclick = () => newEntitySheet(kind, id => apply(id));
  $('#as-unknown')?.addEventListener('click', () => apply(kind === 'event' ? unknownEvent().id : unknownShooter().id));
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
    const name = id ? (list.find(x => x.id === id)?.name ?? '') : t('assign.release');
    toast(`${t('common.photoN', { n: fmt(ids.length) })} · ${esc(name)}`);
    afterAssign();
    if (after) after(); else renderAll();
  }
}

/* ---------- 행사 · 사진사 한 번에 지정 ----------
 *
 * 예전에는 버튼이 따로였다. 같은 사진 묶음에 둘 다 붙이려면
 *   선택 → 행사 지정 → (선택이 풀린다) → 다시 선택 → 사진사 지정
 * 을 해야 했다. 실제 작업은 "이 묶음은 A 행사에서 B 가 찍은 것" 이라
 * 한 번에 정해지므로, 한 시트에서 둘 다 고르고 마지막에 한 번 적용한다.
 *
 * 고르지 않은 쪽은 건드리지 않는다("그대로"). 그래서 행사만, 사진사만
 * 지정하는 예전 흐름도 그대로 된다.
 */
function assignBothSheet(after, st) {
  const ids = [...V.sel];
  if (!ids.length) return;

  // 고른 사진이 이미 전부 같은 값이면 그것을 보여준다. 섞여 있으면 비운다.
  const same = k => {
    const v = S.cat.photos[ids[0]]?.[k] ?? null;
    return ids.every(id => (S.cat.photos[id]?.[k] ?? null) === v) ? v : null;
  };
  const s = st || { ev: same('event'), sh: same('shooter'), evSet: false, shSet: false };

  const lbl = (id, set, byId) => (id ? (byId(id)?.name ?? '') : t(set ? 'assign.cleared' : 'assign.asIs'));
  const row = (id, icon, title, val) =>
    `<button class="row" id="${id}"><span class="row-ico" style="background:var(--fill);color:var(--g600)">${ic(icon, 18)}</span>`
    + `<span class="grow"><span class="t">${title}</span><span class="d">${esc(val)}</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span></button>`;

  openSheet(`<h3>${t('assign.title')}</h3><p class="lead">${t('assign.lead', { n: fmt(ids.length) })}</p>`
    + `<div class="card">`
    + row('ab-ev', 'cal', t('assign.event'), lbl(s.ev, s.evSet, eventById))
    + row('ab-sh', 'user', t('assign.shooter'), lbl(s.sh, s.shSet, shooterById))
    + `<div class="row"><span class="row-ico" style="background:var(--fill);color:var(--g600)">${ic('layers', 18)}</span>`
    + `<span class="grow"><span class="t">${t('assign.keep')}</span><span class="d">${t('assign.keepDesc')}</span></span>`
    + `<button class="sw${V.keepSel ? ' on' : ''}" id="ab-keep" aria-pressed="${V.keepSel}"><i></i></button></div>`
    + `</div>`
    + `<button class="btn" id="ab-save" style="margin-top:12px"${s.evSet || s.shSet ? '' : ' disabled'}>${t('assign.apply')}</button>`);

  const kw = $('#ab-keep');
  kw.onclick = () => { V.keepSel = flipSwitch(kw, !V.keepSel); saveView(); };
  $('#ab-ev').onclick = () => pickInto('event', s, after);
  $('#ab-sh').onclick = () => pickInto('shooter', s, after);
  $('#ab-save').onclick = () => {
    ids.forEach(pid => {
      const p = S.cat.photos[pid];
      if (!p) return;
      if (s.evSet) p.event = s.ev;
      if (s.shSet) p.shooter = s.sh;
    });
    touch();
    closeSheet();
    const parts = [];
    if (s.evSet) parts.push(s.ev ? (eventById(s.ev)?.name ?? t('assign.event')) : t('assign.clearedEvent'));
    if (s.shSet) parts.push(s.sh ? (shooterById(s.sh)?.name ?? t('assign.shooter')) : t('assign.clearedShooter'));
    toast(`${t('common.photoN', { n: fmt(ids.length) })} · ${parts.join(' · ')}${V.keepSel ? ' · ' + t('assign.continue') : ''}`);
    afterAssign();
    if (after) after(); else renderAll();
  };
}

/** 위 시트에서 한 칸을 고른다. 고르면 값만 담고 원래 시트로 돌아온다. */
function pickInto(kind, s, after) {
  const list = kind === 'event' ? eventsByDate() : S.cat.shooters;
  const label = t(kind === 'event' ? 'assign.event' : 'assign.shooter');
  const cur = kind === 'event' ? s.ev : s.sh;

  const set = v => {
    if (kind === 'event') { s.ev = v; s.evSet = true; } else { s.sh = v; s.shSet = true; }
    assignBothSheet(after, s);
  };

  const rows = list.map(x => {
    const sub = kind === 'event' && x.date ? ` <span class="n">${esc(sug.fmtDate(x.date))}</span>` : '';
    return `<button class="opt${cur === x.id ? ' on' : ''}" data-id="${x.id}">`
      + `<span class="l">${esc(x.name)}${sub}</span><span class="n"></span>`
      + `<span class="c">${ic('check', 18, 2.8)}</span></button>`;
  }).join('');

  openSheet(`<h3>${t('assign.pick', { label })}</h3>`
    + `<p class="lead">${t(kind === 'event' ? 'assign.pickEventLead' : 'assign.pickShooterLead')}</p>`
    + `<div class="opts" id="ab-list">${rows}</div>`
    + `<button class="btn sub" id="ab-new" style="width:100%">${ic('plus', 17, 2.2)}${t('assign.new', { label })}</button>`
    + `<button class="btn sub" id="ab-unk" style="width:100%;margin-top:8px">${ic('info', 17, 2)}${t('assign.unknown', { label })}</button>`
    + `<button class="btn sub" id="ab-none" style="width:100%;margin-top:8px">${t('assign.clear', { label })}</button>`
    + `<button class="btn sub" id="ab-back" style="width:100%;margin-top:8px">${ic('chevL', 17, 2.2)}${t('assign.back')}</button>`);

  $('#ab-list').onclick = e => {
    const b = e.target.closest('[data-id]');
    if (b) set(b.dataset.id);
  };
  $('#ab-new').onclick = () => newEntitySheet(kind, id => set(id));
  $('#ab-unk')?.addEventListener('click', () => set(kind === 'event' ? unknownEvent().id : unknownShooter().id));
  $('#ab-none').onclick = () => set(null);
  $('#ab-back').onclick = () => assignBothSheet(after, s);
}

function moreSheet() {
  const ids = [...V.sel];
  const n = ids.length;
  /* 고른 것이 전부 담겨 있으면 "해제", 아니면 "표시". 켜기·끄기를 따로
     두면 매번 어느 쪽인지 읽고 골라야 한다. 상태를 보고 하나만 준다. */
  const allPlanned = n > 0 && ids.every(id => isPlanned(S.cat.photos[id] || {}));

  openSheet(`<h3>${t('common.photoN', { n: fmt(n) })}</h3><p class="lead">${t('more.lead')}</p><div class="opts">`
    + `<button class="opt" data-a="plan"><span class="l">${t(allPlanned ? 'more.planOff' : 'more.planOn')}</span>${ic('bookmark', 17, 2.2)}</button>`
    + (allPlanned ? `<button class="opt" data-a="first"><span class="l">${t('more.first')}</span>${ic('chevL', 17, 2.2)}</button>` : '')
    + `<button class="opt" data-a="person"><span class="l">${t('more.person')}</span>${ic('chev', 17, 2.2)}</button>`
    + `<button class="opt" data-a="tag"><span class="l">${t('more.tag')}</span>${ic('chev', 17, 2.2)}</button>`
    + `<button class="opt" data-a="use"><span class="l">${t('more.use')}</span>${ic('chev', 17, 2.2)}</button>`
    + `</div>`);
  $('#sheet').querySelector('.opts').onclick = e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'plan') {
      const changed = setPlanned(ids, !allPlanned);
      closeSheet();
      toast(t(allPlanned ? 'more.planOffDone' : 'more.planOnDone', { n: fmt(changed) }));
      exitSelect();
      renderAll();
    } else if (a === 'first') {
      /* 담은 시각을 지금 있는 것들보다 앞으로 당긴다 — 정렬 기준이
         plannedAt 이라 그것만 바꾸면 줄 순서가 바뀐다. */
      const earliest = photos().filter(isPlanned)
        .map(p => p.plannedAt).sort()[0] || new Date().toISOString();
      let ts = new Date(earliest).getTime();
      ids.forEach(id => {
        const p = S.cat.photos[id];
        if (p) { ts -= 1000; p.plannedAt = new Date(ts).toISOString(); }
      });
      touch();
      closeSheet();
      toast(t('more.firstDone', { n: fmt(ids.length) }));
      exitSelect();
      renderAll();
    } else if (a === 'person') assignSheet('person');
    else if (a === 'tag') tagSheet([...V.sel], () => { exitSelect(); renderAll(); });
    else usageSheet([...V.sel], () => { exitSelect(); renderAll(); });
  };
}

function newEntitySheet(kind, done) {
  const label = t(kind === 'event' ? 'assign.event' : kind === 'shooter' ? 'assign.shooter' : 'assign.person');
  const today = new Date().toISOString().slice(0, 10);
  openSheet(`<h3>${t('nx.title', { label })}</h3><p class="lead">${t(kind === 'event' ? 'nx.eventLead' : 'nx.xLead')}</p>`
    + `<div class="fld"><label for="nx-name">${t('nx.name')}</label><input id="nx-name" maxlength="60" placeholder="${t(kind === 'event' ? 'nx.eventPh' : 'nx.personPh')}"></div>`
    + (kind === 'event'
      ? `<div class="fld"><label for="nx-date">${t('nx.date')}</label><input id="nx-date" type="date" value="${today}"></div>`
      : (kind === 'person' ? `<div class="fld"><label for="nx-role">${t('nx.roleOpt')}</label><input id="nx-role" maxlength="30" placeholder="${t('nx.rolePh')}"></div>` : '')
      + `<div class="fld"><label for="nx-x">${t('nx.xOpt')}</label><input id="nx-x" maxlength="60" placeholder="${t('nx.xPh')}" autocapitalize="off" autocorrect="off"><div class="detect" id="nx-det"></div></div>`)
    + `<button class="btn" id="nx-save">${t('nx.make')}</button>`);

  const name = $('#nx-name');
  const xf = kind !== 'event' ? wireXField($('#nx-x'), $('#nx-det')) : null;

  $('#nx-save').onclick = async () => {
    const v = name.value.trim();
    if (!v) { name.focus(); return; }
    const btn = $('#nx-save');
    btn.disabled = true;
    // 사진을 받는 동안 누를 것이 없으니 버튼에 상황을 적는다
    let avatar = null;
    if (xf) { btn.textContent = t('xf.checking'); avatar = await xf.settle(); }
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

/** X 아이디 입력란: 붙여넣기를 관대하게 받고, 아바타를 받아 미리 보여준다.
 *
 * 저장 버튼이 이 결과를 **기다려야 한다.** 예전에는 클로저 변수 하나에
 * 담아만 뒀는데, 입력하고 바로 저장을 누르면 (폰에서는 그게 기본 동작이다)
 *   · 새 시트면 아직 null 이라 아바타 없이 저장되고
 *   · 앞서 다른 핸들을 받아뒀으면 **엉뚱한 사람 사진**이 저장됐다.
 * 그래서 핸들과 사진을 한 쌍으로 묶고, settle() 로 확정한다.
 *
 * @returns {{settle:()=>Promise<string|null>, refresh:()=>Promise<string|null>}}
 */
function wireXField(input, det, onAvatar) {
  let timer = 0;
  let got = null;       // { h, dataUrl, reason } — 핸들에 묶인 확정 결과
  let inflight = null;  // { h, p }              — 진행 중인 요청

  const show = html => { if (det.isConnected) det.innerHTML = html; };
  const SEEK = `<span class="sk" style="width:26px;height:26px;border-radius:50%"></span><span>${t('xf.seeking')}</span>`;
  const FOUND = d => `<span class="av" style="width:30px;height:30px"><img alt="" src="${d}"></span><span style="color:var(--green);font-weight:700">${t('xf.found')}</span>`;

  /* 같은 핸들을 다시 받지 않는다 — unavatar 한도를 아낀다.
     실패(404)도 기억해서 키를 누를 때마다 두드리지 않게 한다. */
  function grab(h) {
    if (got && got.h === h) return Promise.resolve(got.dataUrl);
    if (inflight && inflight.h === h) return inflight.p;
    const p = av.fetchAvatar(h).then(r => {
      got = r.ok ? { h, dataUrl: r.dataUrl } : { h, dataUrl: null, reason: r.reason };
      return got.dataUrl;
    });
    inflight = { h, p };
    return p;
  }

  const run = async () => {
    clearTimeout(timer);
    const h = normX(input.value);
    if (!h) {
      show(input.value.trim() ? `<span style="color:var(--amber)">${t('xf.badId')}</span>` : '');
      onAvatar?.(null);
      return null;
    }
    if (!(got && got.h === h)) show(SEEK);
    const d = await grab(h);
    if (normX(input.value) !== h) return d;   // 그 사이 바뀌면 그리지 않는다
    show(d ? FOUND(d) : `${ic('info', 15)}<span>${av.REASON[got.reason] || av.REASON.error}. ${t('xf.savedAnyway')}</span>`);
    onAvatar?.(d);
    return d;
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 500); });
  input.addEventListener('blur', run);

  return {
    /* 저장 바로 전에 부른다. 지금 입력값에 맞는 사진을 확실하게 확보한다 —
       디바운스가 아직 안 돌았으면 지금 받고, 받는 중이면 그것을 기다린다. */
    async settle() {
      clearTimeout(timer);
      const h = normX(input.value);
      if (!h) return null;
      return grab(h);
    },
    /* 같은 핸들이어도 강제로 다시 받는다 (아바타 새로 받기). */
    async refresh() {
      got = null; inflight = null;
      return run();
    },
  };
}

/* ---------- 태그 적용 ---------- */

function tagSheet(ids, after) {
  const tags = S.cat.tags;
  if (!tags.length) {
    openSheet(`<h3>${t('tg.noneTitle')}</h3><p class="lead">${t('tg.noneLead')}</p>`
      + `<button class="btn" id="tg-go">${t('tg.go')}</button>`);
    // 태그 관리는 설정 안으로 들어갔다. 프로필 탭으로 옮긴 뒤 그 화면을 띄운다.
    $('#tg-go').onclick = () => { closeSheet(); goTab('profile'); openTagManage(); };
    return;
  }
  const cnt = new Map(tags.map(tag => [tag, ids.filter(i => (S.cat.photos[i]?.tags || []).includes(tag)).length]));
  openSheet(`<h3>${t('tg.title')}</h3><p class="lead">${ids.length > 1 ? t('tg.leadMany', { n: fmt(ids.length) }) : t('tg.leadOne')} ${t('tg.leadTail')}</p><div class="opts" id="tg-list"></div>`);
  const box = $('#tg-list');
  tags.forEach(tag => {
    const all = cnt.get(tag) === ids.length;
    const o = el('button', 'opt' + (all ? ' on' : ''), `<span class="l">${esc(tag)}</span><span class="n">${cnt.get(tag) && !all ? `${cnt.get(tag)}/${ids.length}` : ''}</span><span class="c">${ic('check', 18, 2.8)}</span>`);
    o.onclick = () => {
      const on = cnt.get(tag) === ids.length;
      ids.forEach(i => {
        const p = S.cat.photos[i];
        if (!p) return;
        p.tags = p.tags || [];
        if (on) p.tags = p.tags.filter(x => x !== tag);
        else if (!p.tags.includes(tag)) p.tags.push(tag);
      });
      cnt.set(tag, on ? 0 : ids.length);
      o.classList.toggle('on', !on);
      o.querySelector('.n').textContent = '';
      touch();
      toast(t(on ? 'tg.removed' : 'tg.applied', { tag: esc(tag), n: fmt(ids.length) }));
      after?.();
    };
    box.appendChild(o);
  });
}

function pickSheet(title, items, cur, apply) {
  if (!items.length) {
    openSheet(`<h3>${esc(title)}</h3><p class="lead">${t('pk.emptyLead')}</p><button class="btn sub" id="pk-x" style="width:100%">${t('common.close')}</button>`);
    $('#pk-x').onclick = closeSheet;
    return;
  }
  openSheet(`<h3>${esc(title)}</h3><p class="lead">${t('pk.oneOnly')}</p>`
    + `<div id="pk-srch"></div><div class="opts" id="pk"></div>`
    + `<button class="btn sub" id="pk-clear" style="width:100%">${t('pk.clear')}</button>`);
  const box = $('#pk');
  /* 정렬은 부르는 쪽이 정한다 — 행사는 날짜순, 사람은 이름순이 맞다. */
  const paint = q => {
    box.innerHTML = '';
    const hit = items.filter(it => matches(q, it.l));
    if (!hit.length) { box.appendChild(el('div', 'nohit', t('srch.none'))); return; }
    hit.forEach(it => {
      const o = el('button', 'opt' + (cur === it.v ? ' on' : ''), `<span class="l">${esc(it.l)}</span><span class="n">${t('common.photoN', { n: fmt(it.n) })}</span><span class="c">${ic('check', 18, 2.8)}</span>`);
      o.onclick = () => { apply(it.v); closeSheet(); };
      box.appendChild(o);
    });
  };
  if (items.length >= 8) {
    $('#pk-srch').appendChild(searchRow(t('srch.phShort'), paint));
  }
  paint('');
  $('#pk-clear').onclick = () => { apply(null); closeSheet(); };
}

export {
  assignSheet, newEntitySheet, tagSheet, pickSheet, wireXField, reviewSheet,
  updateSelbar, exitSelect, applyAxis, cell, groups, counts, emptyState,
};
export {
  openPhoto, usageSheet, useSheet, entitySheet, openTagManage, openTagBrowse,
  renderSettings, openCopyOptions,
} from './screens2.js';
export { renderSchedule, openEvent, openChecklist, eventSheet, openPacking, ddayCard } from './schedule.js';
