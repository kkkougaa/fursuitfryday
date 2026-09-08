/* suits.js — 프로필 탭. 내 프로필과 퍼슈트 대장.
 *
 * 캐릭터를 별도 컬렉션으로 두지 않는다. 사진에 붙는 것은 p.people[] 이고
 * 내 캐릭터도 사진에 찍히니 같은 종류의 것이다. 그래서 슈트를 만들 때
 * people[] 에 짝을 같이 만들고 suit.personId 로 가리킨다 — 지정 시트·필터·
 * 모아보기가 지금 코드 그대로 동작한다.
 *
 * 캐릭터를 사진에 붙이는 일은 **행사 단위로** 한다(schedule.js).
 * "이 행사에 무엇을 데려갔나" 를 적으면 그 안에서 사진을 가른다.
 * 전역 "현재 캐릭터" 상태는 두지 않는다 — 뭐가 켜져 있는지 잊는 순간
 * 수십 장이 잘못 붙는데, 행사 단위면 그럴 여지가 없고 슈트가 하나면
 * 입력이 아예 없다.
 */
import {
  S, touch, touchNow, markDeleted, uid, CAT_COLORS, photos,
  suitById, addSuit, suitWears, suitPhotoCount, careSplit, wearsSince,
  onlySuit, tagEverything,
} from './store.js';
import {
  $, el, ic, esc, fmt, avatarHTML, push, popAll, openSheet, closeSheet,
  toast, confirmSheet, keepScroll, result,
} from './ui.js';
import { V, NO_FILTER, goTab, renderAll, wireXField } from './screens.js';
import { openSettings, meSheet } from './screens2.js';
import { squareDataURL, pickImage } from './imgutil.js';
import * as sug from './suggest.js';
import { t, locale, sortByName } from './i18n.js';

/* ---------- 탭 ---------- */

export function renderProfile() {
  const b = $('#prof-body');
  if (!b) return;
  keepScroll(b, () => paintProfile(b));
}

function paintProfile(b) {
  b.innerHTML = '';
  const set = $('#prof-set');
  if (set) set.onclick = () => openSettings();

  /* 내 프로필 — 사람으로서의 나(핸들·아바타). 캐릭터와는 다른 층이다. */
  const me = S.cat.me || {};
  const mp = el('div', 'sec');
  const mbox = el('div', 'card');
  if (me.nick || me.x) {
    const r = el('button', 'row big');
    r.innerHTML = avatarHTML(me.nick || me.x || '?', me.avatar)
      + `<span class="grow"><span class="t">${esc(me.nick || me.x)}</span>`
      + `<span class="d${me.x ? ' x' : ''}">${me.x ? '@' + esc(me.x) : t('common.noXId')}</span></span>`
      + `<span class="chev">${ic('chev', 18, 2.1)}</span>`;
    r.onclick = () => meSheet();
    mbox.appendChild(r);
  } else {
    const r = el('button', 'row', `<span class="row-ico" style="background:var(--blue-fill);color:var(--blue)">${ic('user', 18)}</span>`
      + `<span class="grow"><span class="t" style="color:var(--blue)">${t('set.profileSetup')}</span></span>`
      + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
    r.onclick = () => meSheet();
    mbox.appendChild(r);
  }
  mp.appendChild(mbox);
  b.appendChild(mp);

  /* 내 퍼슈트 */
  const live = sortByName(S.cat.suits.filter(x => !x.retiredAt));
  const retired = sortByName(S.cat.suits.filter(x => x.retiredAt));

  const ss = el('div', 'sec');
  const slb = el('div', 'sec-lb', `<h2>${t('suit.sec')}</h2>`);
  if (live.length || retired.length) {
    // 목록이 있을 때는 헤더 끝의 + 로 추가한다 — 목록 아래 버튼은 스크롤해야 닿는다
    const plus = el('button', 'catpick', ic('plus', 15, 2.6));
    plus.setAttribute('aria-label', t('suit.add'));
    plus.onclick = () => suitSheet(null);
    slb.appendChild(plus);
  }
  ss.appendChild(slb);

  if (!live.length && !retired.length) {
    /* 처음 들어온 화면. 무엇을 하는 곳인지 한 줄로 알려 주고 바로 만들게 한다. */
    ss.appendChild(result({
      icon: 'user',
      title: t('suit.emptyTitle'),
      lead: t('suit.emptyLead'),
      cta: t('suit.add'),
      onCta: () => suitSheet(null),
    }));
  } else {
    const box = el('div', 'card stagger');
    live.forEach(x => box.appendChild(suitRow(x)));
    ss.appendChild(box);
  }
  b.appendChild(ss);

  if (retired.length) {
    const rs = el('div', 'sec');
    rs.appendChild(el('div', 'sec-lb', `<h2>${t('suit.retiredSec')}</h2><span class="n">${retired.length}</span>`));
    const box = el('div', 'card');
    retired.forEach(x => box.appendChild(suitRow(x)));
    rs.appendChild(box);
    b.appendChild(rs);
  }

  /* 관리 태그는 관리 기록 시트 안에서 손댄다 — 태그가 필요해지는 자리가 거기다. */
}

/** 목록의 슈트 한 줄. 안 한 관리가 있으면 그것부터 보여 준다. */
function suitRow(x) {
  const w = suitWears(x);
  const { todo } = careSplit(x);
  const bits = [];
  if (w.n) bits.push(t('suit.wearN', { n: fmt(w.n) }));
  if (x.maker) bits.push(esc(x.maker));
  const r = el('button', 'row' + (x.retiredAt ? ' dim' : ''));
  r.innerHTML = avatarHTML(x.name, x.avatar)
    + `<span class="grow"><span class="t">${esc(x.name)}</span>`
    + `<span class="d">${bits.join(' · ') || t('suit.noRecord')}</span></span>`
    + (todo.length ? `<span class="pill todo">${ic('info', 13, 2.6)}${fmt(todo.length)}</span>` : '')
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`;
  r.onclick = () => suitScreen(x.id);
  return r;
}

/* ---------- 슈트 상세 ---------- */

export function suitScreen(id) {
  push(esc(suitById(id)?.name || ''), (sc, v) => {
    sc.id = 'suit-body';
    sc.dataset.suit = id;
    paintSuit(sc, id);
  });
}

/** 열려 있으면 다시 그린다. */
function reSuit() {
  const b = $('#suit-body');
  if (b?.dataset.suit) keepScroll(b, () => paintSuit(b, b.dataset.suit));
}

function paintSuit(sc, id) {
  sc.innerHTML = '';
  const x = suitById(id);
  if (!x) { sc.appendChild(result({ icon: 'info', title: t('suit.gone') })); return; }

  const w = suitWears(x);
  const nPhoto = suitPhotoCount(x);

  /* 머리 — 대표 사진과 이름 */
  const head = el('div', 'sec suit-head');
  head.innerHTML = `<div class="suit-face">${avatarHTML(x.name, x.avatar, 'xl')}</div>`
    + `<h2>${esc(x.name)}</h2>`
    + (x.x ? `<div class="x">@${esc(x.x)}</div>` : '');
  const ed = el('button', 'btn sub', `${ic('user', 17, 2.1)}${t('suit.edit')}`);
  ed.onclick = () => suitSheet(x);
  head.appendChild(ed);
  sc.appendChild(head);

  /* 숫자 두 개 — 착용 횟수와 사진 수. 둘 다 저장하지 않고 세어 낸다. */
  const st = el('div', 'sec');
  const stb = el('div', 'suit-stat');
  const wear = el('div', 'k');
  wear.innerHTML = `<b>${fmt(w.n)}</b><span>${t('suit.wearLb')}</span>`;
  stb.appendChild(wear);
  const ph = el('button', 'k');
  ph.innerHTML = `<b>${fmt(nPhoto)}</b><span>${t('suit.photoLb')}</span>`;
  ph.onclick = () => {
    if (!nPhoto) { toast(t('suit.noPhoto')); return; }
    V.filter = NO_FILTER();
    V.filter.person = x.personId;
    V.limit = 60;
    popAll();
    goTab('photos');
  };
  stb.appendChild(ph);
  st.appendChild(stb);
  sc.appendChild(st);

  /* 기록 — 메이커·데뷔일·생일. 없는 줄은 안 그린다. */
  const rows = [
    ['suit.maker', x.maker && esc(x.maker)],
    ['suit.debut', x.debutAt && dateWithAge(x.debutAt, 'suit.debutAge')],
    ['suit.birthday', x.birthday && birthdayText(x.birthday)],
    ['suit.lastWear', w.last && sug.fmtDate(w.last)],
  ].filter(([, v]) => v);
  if (rows.length) {
    const kv = el('div', 'sec');
    const box = el('dl', 'kv');
    rows.forEach(([k, val]) => {
      const d = el('div', '', `<dt>${t(k)}</dt><dd>${val}</dd>`);
      box.appendChild(d);
    });
    kv.appendChild(box);
    sc.appendChild(kv);
  }

  if (x.memo) {
    const m = el('div', 'sec');
    m.appendChild(el('div', 'note', `${ic('info', 17)}<span>${esc(x.memo)}</span>`));
    sc.appendChild(m);
  }

  /* 관리 — 할 일과 완료를 한 타임라인에. 안 한 것이 위로 온다. */
  const { todo, done } = careSplit(x);
  const cs = el('div', 'sec');
  const lb = el('div', 'sec-lb', `<h2>${t('care.sec')}</h2>`);
  const addBtn = el('button', 'catpick', `${ic('plus', 13, 2.6)}${t('care.add')}`);
  addBtn.onclick = () => careSheet(x, null);
  lb.appendChild(addBtn);
  cs.appendChild(lb);

  if (!todo.length && !done.length) {
    cs.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t('care.empty')}</span>`));
  } else {
    const box = el('div', 'card');
    todo.forEach(l => box.appendChild(careRow(x, l, false)));
    done.forEach(l => box.appendChild(careRow(x, l, true)));
    cs.appendChild(box);
  }
  sc.appendChild(cs);

  /* 태그별 "지난 관리 이후 N회 착용" — 세탁 주기의 실제 기준 */
  const seen = [...new Set(done.flatMap(l => l.kinds || []))];
  if (seen.length && w.n) {
    const ws = el('div', 'sec');
    ws.appendChild(el('div', 'sec-lb', `<h2>${t('care.sinceSec')}</h2>`));
    const box = el('dl', 'kv');
    seen.forEach(name => {
      const r = wearsSince(x, name);
      box.appendChild(el('div', '', `<dt>${esc(name)}</dt>`
        + `<dd>${t('care.sinceN', { n: fmt(r.n) })}</dd>`));
    });
    ws.appendChild(box);
    sc.appendChild(ws);
  }

  /* 끝 — 은퇴와 삭제 */
  const act = el('div', 'sec');
  act.style.marginTop = '18px';
  const ret = el('button', 'btn sub', x.retiredAt
    ? `${ic('refresh', 17, 2.1)}${t('suit.unretire')}`
    : `${ic('bookmark', 17, 2.1)}${t('suit.retire')}`);
  ret.style.width = '100%';
  ret.onclick = () => {
    x.retiredAt = x.retiredAt ? null : new Date().toISOString();
    touch();
    toast(t(x.retiredAt ? 'suit.retired' : 'suit.unretired', { name: esc(x.name) }));
    reSuit();
    renderProfile();
  };
  act.appendChild(ret);

  const del = el('button', 'btn danger', `${ic('trash', 17, 2)}${t('suit.delete')}`);
  del.style.marginTop = '8px';
  del.onclick = () => confirmSheet({
    title: t('suit.deleteQ', { name: esc(x.name) }),
    lead: nPhoto ? t('suit.deleteLeadN', { n: fmt(nPhoto) }) : t('suit.deleteLead'),
    danger: true,
    ok: t('common.delete'),
    onOk: () => {
      /* people[] 짝과 사진에 붙은 것은 남긴다 — 사진에 "누가 찍혔나" 는
         슈트를 대장에서 지운 것과 다른 사실이다. 행사 기록에서만 뺀다. */
      S.cat.suits = S.cat.suits.filter(z => z.id !== x.id);
      S.cat.events.forEach(e => {
        if ((e.suits || []).includes(x.id)) e.suits = e.suits.filter(z => z !== x.id);
      });
      markDeleted('suits', x.id);
      touchNow();
      popAll();
      toast(t('suit.deleted', { name: esc(x.name) }));
      renderAll();
      renderProfile();
    },
  });
  act.appendChild(del);
  sc.appendChild(act);
}

function careRow(suit, l, isDone) {
  const tags = (l.kinds || []).map(k => {
    const c = S.cat.careTags.find(z => z.name === k);
    return `<span class="cat c-${c ? c.color : 'gray'} sm">${esc(k)}</span>`;
  }).join('');
  const when = isDone ? sug.fmtDate(l.doneAt.slice(0, 10)) : t('care.todo');
  const r = el('button', 'row' + (isDone ? '' : ' todo'));
  r.innerHTML = `<span class="row-ico"${isDone ? '' : ' style="background:var(--amber-fill);color:var(--amber)"'}>`
    + `${ic(isDone ? 'check' : 'info', 18)}</span>`
    + `<span class="grow"><span class="t">${tags || t('care.noTag')}</span>`
    + `<span class="d">${when}${l.note ? ' · ' + esc(l.note) : ''}</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`;
  r.onclick = () => careSheet(suit, l);
  return r;
}

/* ---------- 시트 ---------- */

/** 슈트 만들기 / 편집. 만들 때는 people[] 짝을 같이 만든다(addSuit). */
function suitSheet(x) {
  const isNew = !x;
  let avatar = x?.avatar || null;

  const render = () => {
    openSheet(`<h3>${t(isNew ? 'suit.newTitle' : 'suit.editTitle')}</h3>`
      + `<p class="lead">${t('suit.newLead')}</p>`
      + `<div class="logorow"><span class="suit-pick">${avatarHTML(x?.name || '?', avatar, 'xl')}</span>`
      + `<span class="lg-t"><b>${t('suit.cover')}</b><em>${t(avatar ? 'suit.coverSet' : 'suit.coverNone')}</em></span></div>`
      + `<div class="splitrow" style="margin-top:10px"><button id="su-pick">${ic('grid', 17, 2.1)}${t(avatar ? 'lg.pickOther' : 'lg.pick')}</button>`
      + (avatar ? `<button id="su-clear">${t('lg.clear')}</button>` : '') + `</div>`
      + `<div class="fld" style="margin-top:18px"><label for="su-name">${t('suit.name')}</label>`
      + `<input id="su-name" maxlength="40" placeholder="${t('suit.namePh')}" value="${esc(x?.name || '')}"></div>`
      + `<div class="fld"><label for="su-x">${t('suit.xOpt')}</label>`
      + `<input id="su-x" maxlength="60" placeholder="${t('nx.xPh')}" autocapitalize="off" autocorrect="off" value="${esc(x?.x || '')}">`
      + `<div class="detect" id="su-det"></div></div>`
      + `<div class="fld"><label for="su-maker">${t('suit.maker')}</label>`
      + `<input id="su-maker" maxlength="60" placeholder="${t('suit.makerPh')}" value="${esc(x?.maker || '')}"></div>`
      + `<div class="splitrow">`
      + `<div class="fld" style="flex:1"><label for="su-debut">${t('suit.debut')}</label>`
      + `<input id="su-debut" type="date" value="${x?.debutAt ? x.debutAt.slice(0, 10) : ''}"></div>`
      + `<div class="fld" style="flex:1"><label for="su-bd">${t('suit.birthday')}</label>`
      + `<input id="su-bd" type="date" value="${x?.birthday || ''}"></div></div>`
      + `<div class="fld"><label for="su-memo">${t('suit.memo')}</label>`
      + `<textarea id="su-memo" rows="2" maxlength="300" placeholder="${t('suit.memoPh')}">${esc(x?.memo || '')}</textarea>`
      + `<div class="hint">${t('suit.memoHint')}</div></div>`
      + `<button class="btn" id="su-save">${t(isNew ? 'suit.create' : 'common.save')}</button>`);

    /* 핸들을 넣으면 프로필 사진을 자동으로 받아 온다. 직접 고른 사진이
       있으면 덮지 않는다 — 사용자가 정한 것이 우선이다. */
    const xf = wireXField($('#su-x'), $('#su-det'), got => { if (!avatar) avatar = got; });

    $('#su-pick').onclick = async () => {
      const file = await pickImage();
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast(t('lg.notImage')); return; }
      try {
        const keep = { name: $('#su-name').value, x: $('#su-x').value, maker: $('#su-maker').value,
          debut: $('#su-debut').value, bd: $('#su-bd').value, memo: $('#su-memo').value };
        avatar = await squareDataURL(file, 96);
        render();
        // 다시 그리면 입력값이 날아가므로 되돌려 넣는다
        $('#su-name').value = keep.name; $('#su-x').value = keep.x;
        $('#su-maker').value = keep.maker; $('#su-debut').value = keep.debut;
        $('#su-bd').value = keep.bd; $('#su-memo').value = keep.memo;
        toast(t('lg.loaded'));
      } catch { toast(t('lg.procFail')); }
    };
    const clr = $('#su-clear');
    if (clr) clr.onclick = () => { avatar = null; render(); };

    $('#su-save').onclick = async () => {
      const name = $('#su-name').value.trim();
      if (!name) { $('#su-name').focus(); return; }
      const btn = $('#su-save');
      btn.disabled = true;
      btn.textContent = t('xf.checking');
      const got = await xf.settle();
      if (got && !avatar) avatar = got;

      const fields = {
        name,
        x: $('#su-x').value.trim() || null,
        avatar,
        maker: $('#su-maker').value.trim() || null,
        debutAt: $('#su-debut').value || null,
        birthday: $('#su-bd').value || null,
        memo: $('#su-memo').value.trim() || null,
      };

      if (isNew) {
        const made = addSuit(name, fields);
        closeSheet();
        toast(t('suit.created', { name: esc(name) }));
        renderProfile();
        renderAll();
        // 하나뿐이면 지금 있는 사진·행사에 한 번에 붙일 수 있다
        if (onlySuit()?.id === made.id) setTimeout(() => bulkSheet(made), 360);
        return;
      }
      // 여기부터는 편집 경로다 — 새로 만드는 쪽은 위에서 끝냈다
      Object.assign(x, fields);
      /* people[] 짝도 같이 맞춘다 — 사진 목록에 뜨는 이름과 프사가 그쪽이다. */
      const per = S.cat.people.find(z => z.id === x.personId);
      if (per) { per.name = name; per.x = fields.x; per.avatar = avatar; }
      touch();
      closeSheet();
      toast(t('common.saved'));
      renderProfile();
      reSuit();
      renderAll();
    };
    setTimeout(() => { if (isNew) $('#su-name').focus(); }, 340);
  };
  render();
}

/* 슈트가 하나뿐일 때, 지금 있는 것에 한 번에 붙인다.
 *
 * 사진을 이미 수백 장 분류해 둔 사람에게 행사마다 버튼을 누르게 하면
 * 그게 곧 "귀찮아서 안 쓴다" 가 된다. 답이 정해져 있으니 한 번 묻고 끝낸다. */
function bulkSheet(suit) {
  const nP = photos().filter(p => !(p.people || []).length).length;
  const nE = S.cat.events.filter(e => !e.unknown && e.going !== false && !(e.suits || []).includes(suit.id)).length;
  if (!nP && !nE) return;

  confirmSheet({
    title: t('suit.bulkTitle'),
    lead: t('suit.bulkLead', { name: esc(suit.name), n: fmt(nP), m: fmt(nE) }),
    ok: t('suit.bulkOk'),
    onOk: () => {
      const r = tagEverything(suit);
      toast(t('suit.bulkDone', { n: fmt(r.photos), m: fmt(r.events) }));
      renderProfile();
      renderAll();
    },
  });
}

/** 관리 기록 하나. doneAt 이 없으면 "해야 할 것" 이다. */
function careSheet(suit, l) {
  const isNew = !l;
  let kinds = [...(l?.kinds || [])];
  let done = !!l?.doneAt;

  const render = () => {
    const chips = S.cat.careTags.map(c => {
      const on = kinds.includes(c.name);
      return `<button class="cat c-${c.color}${on ? ' on' : ''}" data-k="${esc(c.name)}">`
        + `${on ? ic('check', 13, 3) : ''}${esc(c.name)}</button>`;
    }).join('');

    openSheet(`<h3>${t(isNew ? 'care.newTitle' : 'care.editTitle')}</h3>`
      + `<p class="lead">${t('care.lead')}</p>`
      + `<div class="fld"><label>${t('care.kinds')}</label><div class="cats" id="ca-tags">${chips}</div>`
      + `<button class="optlink" id="ca-tagmgr">${ic('tag', 15, 2.1)}${t('care.tagManage')}</button></div>`
      + `<div class="fld"><label for="ca-note">${t('care.note')}</label>`
      + `<input id="ca-note" maxlength="120" placeholder="${t('care.notePh')}" value="${esc(l?.note || '')}"></div>`
      + `<div class="fld"><label>${t('care.state')}</label>`
      + `<div class="seg" id="ca-seg"><button class="${done ? '' : 'on'}" data-v="todo">${t('care.stTodo')}</button>`
      + `<button class="${done ? 'on' : ''}" data-v="done">${t('care.stDone')}</button></div>`
      + `<div class="hint">${t('care.stateHint')}</div></div>`
      + (done ? `<div class="fld"><label for="ca-at">${t('care.doneAt')}</label>`
        + `<input id="ca-at" type="date" value="${(l?.doneAt || new Date().toISOString()).slice(0, 10)}"></div>` : '')
      + `<button class="btn" id="ca-save">${t('common.save')}</button>`
      + (isNew ? '' : `<button class="btn danger" id="ca-del" style="width:100%;margin-top:8px">${t('common.delete')}</button>`));

    $('#ca-tags').querySelectorAll('[data-k]').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.k;
        kinds = kinds.includes(k) ? kinds.filter(z => z !== k) : [...kinds, k];
        render();
      };
    });
    /* 태그를 고르다가 없는 것을 발견하는 자리라 여기서 바로 들어가게 둔다.
       돌아왔을 때 고르던 것이 남아 있어야 하므로 시트를 닫고 다시 그린다. */
    $('#ca-tagmgr').onclick = () => { closeSheet(); openCareTags(() => render()); };

    $('#ca-seg').querySelectorAll('[data-v]').forEach(b => {
      b.onclick = () => { done = b.dataset.v === 'done'; render(); };
    });

    $('#ca-save').onclick = () => {
      const note = $('#ca-note').value.trim() || null;
      const doneAt = done ? ($('#ca-at')?.value || new Date().toISOString().slice(0, 10)) : null;
      if (isNew) {
        suit.log = [...(suit.log || []), {
          id: uid('cl'), kinds, note, at: new Date().toISOString(), doneAt,
        }];
      } else {
        Object.assign(l, { kinds, note, doneAt });
      }
      touch();
      closeSheet();
      toast(t(done ? 'care.savedDone' : 'care.savedTodo'));
      reSuit();
      renderProfile();
    };
    const d = $('#ca-del');
    if (d) d.onclick = () => confirmSheet({
      title: t('care.deleteQ'), danger: true, ok: t('common.delete'),
      onOk: () => {
        suit.log = suit.log.filter(z => z.id !== l.id);
        touchNow();
        closeSheet();
        reSuit();
        renderProfile();
      },
    });
  };
  render();
}

/* ---------- 관리 태그 관리 ---------- */
/* 행사 카테고리(eventTags)와 구조가 같다 — 이름 + 색 + 쓰인 수 + 삭제.
   그래서 화면 모양도 그쪽(paintEventTagManage/catSheet)을 그대로 따른다. */

export function openCareTags(onBack) {
  const v = push(t('care.tagManage'), sc => paintCareTags(sc));
  if (onBack) {
    // 뒤로 눌러 돌아오면 고르던 시트를 다시 띄운다
    const back = v.querySelector('.back');
    const prev = back.onclick;
    back.onclick = () => { prev(); setTimeout(onBack, 340); };
  }
}

function paintCareTags(sc) {
  keepScroll(sc, () => {
    sc.innerHTML = '';
    const hd = el('div', 'gtitle');
    hd.innerHTML = `<h2>${t('care.tagManage')}</h2><div class="m">${t('care.tagLead')}</div>`;
    sc.appendChild(hd);

    const s2 = el('div', 'sec');
    s2.style.marginTop = '18px';
    const box = el('div', 'card');
    S.cat.careTags.forEach(tag => {
      const used = S.cat.suits.reduce((n, x) =>
        n + (x.log || []).filter(l => (l.kinds || []).includes(tag.name)).length, 0);
      const r = el('button', 'row');
      r.innerHTML = `<span class="cat c-${tag.color}" style="pointer-events:none">${esc(tag.name)}</span>`
        + `<span class="grow"></span><span class="n-sm">${t('care.tagUsed', { n: fmt(used) })}</span>`
        + `<span class="chev">${ic('chev', 18, 2.1)}</span>`;
      r.onclick = () => careTagSheet(tag, () => paintCareTags(sc));
      box.appendChild(r);
    });
    if (!S.cat.careTags.length) {
      box.appendChild(el('div', 'row', `<span class="grow"><span class="t" style="color:var(--g500)">${t('care.tagEmptyT')}</span>`
        + `<span class="d">${t('care.tagEmptyD')}</span></span>`));
    }
    s2.appendChild(box);
    const nb = el('button', 'btn sub', `${ic('plus', 17, 2.2)}${t('care.tagMake')}`);
    nb.style.cssText = 'width:100%;margin-top:12px';
    nb.onclick = () => careTagSheet(null, () => paintCareTags(sc));
    s2.appendChild(nb);
    sc.appendChild(s2);
  });
}

/** 관리 태그 만들기 / 이름·색 편집 / 삭제. */
function careTagSheet(tag, after) {
  const isNew = !tag;
  let color = tag ? tag.color : CAT_COLORS[Math.floor(Math.random() * CAT_COLORS.length)];

  const render = () => {
    const swatch = CAT_COLORS.map(c =>
      `<button class="cat c-${c}${c === color ? ' on' : ''}" data-c="${c}">`
      + `${c === color ? ic('check', 13, 3) : ''}${esc(t('care.colorDot'))}</button>`).join('');
    openSheet(`<h3>${t(isNew ? 'care.tagMake' : 'care.tagEdit')}</h3>`
      + `<div class="fld"><label for="ctg-name">${t('care.tagName')}</label>`
      + `<input id="ctg-name" maxlength="20" placeholder="${t('care.tagPh')}" value="${esc(tag?.name || '')}"></div>`
      + `<div class="fld"><label>${t('care.tagColor')}</label><div class="cats">${swatch}</div></div>`
      + `<button class="btn" id="ctg-save">${t(isNew ? 'common.add' : 'common.save')}</button>`
      + (isNew ? '' : `<button class="btn danger" id="ctg-del" style="width:100%;margin-top:8px">${t('common.delete')}</button>`));

    document.querySelectorAll('#sheet [data-c]').forEach(b => {
      b.onclick = () => { color = b.dataset.c; render(); };
    });

    $('#ctg-save').onclick = () => {
      const name = $('#ctg-name').value.trim();
      if (!name) { $('#ctg-name').focus(); return; }
      const dup = S.cat.careTags.some(z => z.name === name && z !== tag);
      if (dup) { toast(t('care.tagDup')); return; }
      if (isNew) {
        S.cat.careTags.push({ name, color });
      } else {
        // 이름이 바뀌면 기록에 박아 둔 이름도 같이 옮긴다
        if (tag.name !== name) {
          S.cat.suits.forEach(x => (x.log || []).forEach(l => {
            if ((l.kinds || []).includes(tag.name)) {
              l.kinds = l.kinds.map(z => (z === tag.name ? name : z));
            }
          }));
        }
        tag.name = name;
        tag.color = color;
      }
      touch();
      closeSheet();
      after?.();
      renderProfile();
    };

    const d = $('#ctg-del');
    if (d) d.onclick = () => {
      const used = S.cat.suits.reduce((n, x) =>
        n + (x.log || []).filter(l => (l.kinds || []).includes(tag.name)).length, 0);
      confirmSheet({
        title: t('care.tagDeleteQ', { name: esc(tag.name) }),
        lead: used ? t('care.tagDeleteUsed', { n: fmt(used) }) : null,
        danger: true,
        ok: t('common.delete'),
        onOk: () => {
          S.cat.careTags = S.cat.careTags.filter(z => z.name !== tag.name);
          S.cat.suits.forEach(x => (x.log || []).forEach(l => {
            if ((l.kinds || []).includes(tag.name)) l.kinds = l.kinds.filter(z => z !== tag.name);
          }));
          markDeleted('careTags', tag.name);
          touchNow();
          closeSheet();
          after?.();
          renderProfile();
        },
      });
    };
  };
  render();
}

/* ---------- 날짜 표현 ---------- */

/** 데뷔일에 "N년째" 를 붙인다. 홈 디데이와 같은 감각으로 읽히게. */
function dateWithAge(iso, key) {
  const d = sug.fmtDate(iso.slice(0, 10));
  const y = Math.floor((Date.now() - new Date(iso).getTime()) / 31557600000);
  return y >= 1 ? `${d} · ${t(key, { n: y })}` : d;
}

/** 생일은 해가 없어도 된다. 다음 생일까지 남은 날을 같이 보여 준다. */
function birthdayText(md) {
  const d = new Date(md);
  if (Number.isNaN(d.getTime())) return esc(md);
  const shown = d.toLocaleDateString(locale(), { month: 'long', day: 'numeric' });
  const now = new Date();
  const next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(now.getFullYear() + 1);
  const left = Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  return left === 0 ? `${shown} · ${t('suit.bdToday')}` : `${shown} · ${t('suit.bdIn', { n: left })}`;
}
