/* screens2.js — 사진 상세, 사용하기, 태그·설정 계열 화면 */
import {
  S, photos, isUsed, isUnfiled, isPlanned, setPlanned,
  eventById, shooterById, personById,
  normX, touch, touchNow, markDeleted, flush, copyTextFor, channelOf, hashtagify, uid,
  unknownShooter, UNKNOWN_SHOOTER, unknownEvent, CAT_COLORS, catColor, ACCENTS, accentName, applyAccent,
  parseHex, accentVars,
  listBackups, restoreBackup, backupIfDue,
} from './store.js';
import * as sug from './suggest.js';
import * as th from './thumbs.js';
import * as av from './avatar.js';
import {
  $, el, ic, esc, fmt, avatarHTML, push, popAll, openSheet, closeSheet,
  toast, confirmSheet, wireScroll, segment, keepScroll, openX, flipSwitch, addPopHook,
} from './ui.js';
import { squareDataURL, pickImage } from './imgutil.js';
import {
  V, NO_FILTER, renderAll, renderHome, renderTabs, goTab, tagSheet, assignSheet, wireXField, newEntitySheet,
} from './screens.js';
import { openPacking } from './schedule.js';
import { t, locale, LANGS, getLang, setLang, sortByName } from './i18n.js';
import { isFriday } from './friday.js';

/* ============================ 사진 상세 ============================ */

/* 사진 화면을 다 닫으면 1200px 미리보기를 놓아준다. 사진을 스무 장쯤
   넘겨보는 동안 그것만 쌓여도 사파리가 탭을 죽인다. */
addPopHook(() => th.releaseBig());

export function openPhoto(id) {
  push(t('ph.tab'), sc => paintPhoto(sc, id), (bar, sc) => {
    const b = el('button', 'btn', `${ic('copy', 18, 2.2)}${t('use.title')}`);
    b.onclick = () => useSheet(sc.dataset.cur || id, () => paintPhoto(sc, sc.dataset.cur || id));
    const g = el('button', 'btn sub', ic('ext', 18, 2));
    g.onclick = () => {
      const cur = sc.dataset.cur || id;
      window.open(`https://drive.google.com/file/d/${cur}/view`, '_blank', 'noopener');
    };
    bar.appendChild(b); bar.appendChild(g);
  });
}

async function paintPhoto(sc, id) {
  const p = S.cat.photos[id];
  if (!p) { sc.innerHTML = `<div class="sec" style="padding-top:40px"><div class="note bad">${t('ph.gone')}</div></div>`; return; }
  sc.dataset.cur = id;
  sc.innerHTML = '';

  const shot = el('div', 'shot', `<img alt="${esc(p.name || '')}" class="sk" style="aspect-ratio:3/2">`);
  sc.appendChild(shot);
  th.big(id, 1200).then(u => { if (u) { const i = shot.querySelector('img'); i.classList.remove('sk'); i.src = u; } });

  const used = isUsed(p);
  /* 예정을 맨 앞에 둔다. 담아둔 사진을 열었을 때 제일 먼저 확인하고 싶은 게
     "이거 올리기로 한 거였지" 이지, 몇 건 썼는지가 아니다. */
  const state = isPlanned(p)
    ? `<span class="pill plan">${ic('bookmark', 12, 2.6)}${t('ph.planned')}</span>`
    : used
      ? `<span class="pill used">${ic('check', 13, 3)}${t('ph.usedN', { n: p.usages.length })}</span>`
      : isUnfiled(p) ? `<span class="pill todo">${t('ph.needFile')}</span>` : `<span class="pill unused">${t('ph.unused')}</span>`;
  sc.appendChild(el('div', 'statebar', `${state}<span class="fn">${esc(p.name || '')}</span>`));

  /* 업로드 예정 토글 */
  const plSec = el('div', 'sec');
  plSec.style.marginTop = '14px';
  const plBox = el('div', 'card');
  const planDesc = () => (p.plannedAt
    ? t('ph.plannedAt', { date: sug.fmtDate(p.plannedAt.slice(0, 10)) })
    : (used ? t('ph.plannedHintAgain') : t('ph.plannedHint')));
  const plRow = el('div', 'row',
    `<span class="row-ico plan">${ic('bookmark', 18, 2)}</span>`
    + `<span class="grow"><span class="t">${t('ph.planned')}</span><span class="d">${esc(planDesc())}</span></span>`);
  const plSw = el('button', 'sw' + (p.plannedAt ? ' on' : ''), '<i></i>');
  plSw.setAttribute('aria-pressed', String(!!p.plannedAt));
  plSw.onclick = () => {
    // 화면 전체를 다시 그리면 스위치 애니메이션이 날아간다. 제자리에서 뒤집고
    // 영향받는 부분(알약·설명·다른 화면)만 손댄다.
    const on = flipSwitch(plSw, !p.plannedAt);
    setPlanned([id], on);
    const d = plRow.querySelector('.d');
    if (d) d.textContent = planDesc();
    const pill = sc.querySelector('.statebar .pill');
    if (pill) {
      pill.className = 'pill ' + (on ? 'plan' : used ? 'used' : isUnfiled(p) ? 'todo' : 'unused');
      pill.innerHTML = on ? `${ic('bookmark', 12, 2.6)}${t('ph.planned')}`
        : used ? `${ic('check', 13, 3)}${t('ph.usedN', { n: p.usages.length })}`
          : isUnfiled(p) ? t('ph.needFile') : t('ph.unused');
    }
    toast(t(on ? 'ph.plannedOn' : 'ph.plannedOff'));
    renderHome();
  };
  plRow.appendChild(plSw);
  plBox.appendChild(plRow);
  plSec.appendChild(plBox);
  sc.appendChild(plSec);

  /* 행사 · 작가 */
  const cls = el('div', 'sec');
  cls.appendChild(el('div', 'sec-lb', `<h2>${t('ph.filing')}</h2>`));
  const cbox = el('div', 'card');
  cbox.appendChild(assignRow(t('assign.event'), p.event && eventById(p.event)?.name, 'cal', () => oneSheet('event', id, () => paintPhoto(sc, id))));
  const sh = p.shooter && shooterById(p.shooter);
  cbox.appendChild(assignRow(t('assign.shooter'), sh?.name, 'cam', () => oneSheet('shooter', id, () => paintPhoto(sc, id)), sh?.x ? '@' + sh.x : null));
  cls.appendChild(cbox);
  sc.appendChild(cls);

  /* 사용 이력 */
  const us = el('div', 'sec');
  us.appendChild(el('div', 'sec-lb', `<h2>${t('ph.usageHist')}</h2><span class="n">${t('ph.countN', { n: p.usages.length })}</span>`));
  const ub = el('div', 'card');
  if (p.usages.length) {
    p.usages.forEach((u, i) => {
      const r = el('div', 'use', `<span class="ch ${channelOf(u.url) || 'etc'}">${chLabel(u.url)}</span>`
        + `<span class="grow"><span class="u">${esc(u.url)}</span><span class="w">${t('ph.postedOn', { date: sug.fmtDate(u.date) })}</span></span>`);
      const del = el('button', 'copy', ic('trash', 15, 2));
      del.onclick = () => confirmSheet({
        title: t('ph.delUsageQ'), danger: true, ok: t('ph.delUsage'),
        lead: t('ph.delUsageLead'),
        onOk: () => { p.usages.splice(i, 1); touch(); toast(t('ph.usageDeleted')); paintPhoto(sc, id); renderAll(); },
      });
      r.appendChild(del);
      ub.appendChild(r);
    });
  } else {
    ub.appendChild(el('div', 'use', `<span class="grow"><span class="u" style="color:var(--g500)">${t('ph.noUsage')}</span></span>`));
  }
  us.appendChild(ub);
  sc.appendChild(us);

  /* 사진사 크레딧 */
  if (sh && !sh.unknown) {
    const ss = el('div', 'sec');
    ss.appendChild(el('div', 'sec-lb', `<h2>${t('assign.shooter')}</h2>`));
    const sb = el('div', 'card');
    const r = el('div', 'row');
    r.innerHTML = avatarHTML(sh.name, sh.avatar)
      + `<span class="grow"><span class="t">${esc(sh.name)}</span><span class="d${sh.x ? ' x' : ''}">${sh.x ? '@' + esc(sh.x) : t('common.noXId')}</span></span>`;
    const cp = el('button', 'copy', `${ic('copy', 15, 2)}${t('ph.credit')}`);
    cp.onclick = async () => {
      if (!sh.x) { toast(t('ph.noXForCredit', { name: sh.name })); return; }
      const credit = `${S.cat.opts.emoji} ${S.cat.opts.prefix}${sh.x}`;
      toast((await writeText(credit)) ? t('ph.copied', { text: credit }) : t('ph.copyBlocked'));
    };
    r.appendChild(cp);
    sb.appendChild(r);
    ss.appendChild(sb);
    sc.appendChild(ss);
  }

  /* 인물 */
  const ps = el('div', 'sec');
  ps.appendChild(el('div', 'sec-lb', `<h2>${t('ph.people')}</h2><span class="n">${t('grp.peopleN', { n: (p.people || []).length })}</span>`));
  const pw = el('div', 'tagwrap');
  (p.people || []).forEach(pid => {
    const per = personById(pid);
    if (!per) return;
    const c = el('button', 'pchip', avatarHTML(per.name, per.avatar) + esc(per.name));
    c.onclick = () => { V.filter = { ...NO_FILTER(), person: pid }; V.limit = 60; goTab('photos'); popAll(); };
    pw.appendChild(c);
  });
  const addP = el('button', 'tg add', `${ic('plus', 14, 2.4)}${t('assign.person')}`);
  addP.onclick = () => manySheet('person', id, () => paintPhoto(sc, id));
  pw.appendChild(addP);
  ps.appendChild(pw);
  sc.appendChild(ps);

  /* 태그 */
  const ts = el('div', 'sec');
  ts.appendChild(el('div', 'sec-lb', `<h2>${t('ph.tags')}</h2>`));
  const tw = el('div', 'tagwrap');
  (p.tags || []).forEach(tag => tw.appendChild(el('span', 'tg', esc(tag))));
  const addT = el('button', 'tg add', `${ic('plus', 14, 2.4)}${t('ph.tags')}`);
  addT.onclick = () => tagSheet([id], () => paintPhoto(sc, id));
  tw.appendChild(addT);
  ts.appendChild(tw);
  sc.appendChild(ts);

  /* 촬영 정보 */
  const kv = el('div', 'sec');
  kv.appendChild(el('div', 'sec-lb', `<h2>${t('ph.exif')}</h2><span class="n">EXIF</span>`));
  const rows = [
    [t('ph.shotAt'), p.shotAt ? p.shotAt.replace('T', ' ').replace(/-/g, '.') : t('sched.none')],
    [t('ph.camera'), p.cameraModel || t('sched.none')],
    [t('ph.lens'), p.lens || t('sched.none')],
    [t('ph.exposure'), [p.exposure, p.iso ? `ISO ${p.iso}` : null].filter(Boolean).join(' · ') || t('sched.none')],
    [t('ph.size'), p.w && p.h ? `${fmt(p.w)} × ${fmt(p.h)}` : t('sched.none')],
    [t('ph.bytes'), p.size ? `${(p.size / 1048576).toFixed(1)} MB` : t('sched.none')],
  ];
  kv.appendChild(el('dl', 'kv', rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')));
  sc.appendChild(kv);
  sc.appendChild(el('div', '', '')).style.height = '12px';
}

function assignRow(label, value, icon, onClick, sub) {
  const r = el('button', 'row');
  const has = !!value;
  r.innerHTML = `<span class="row-ico"${has ? '' : ' style="background:var(--amber-fill);color:var(--amber)"'}>${ic(icon, 18)}</span>`
    + `<span class="grow"><span class="t"${has ? '' : ' style="color:var(--amber)"'}>${has ? esc(value) : esc(t('assign.setLabel', { label }))}</span>`
    + `<span class="d${sub ? ' x' : ''}">${sub ? esc(sub) : label}</span></span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
  r.onclick = onClick;
  return r;
}

/** 사진 한 장에 행사/작가 하나 지정 */
function oneSheet(kind, pid, after) {
  const label = t(kind === 'event' ? 'assign.event' : 'assign.shooter');
  // 미상은 목록 맨 아래로 — 고르는 순간 뜻이 달라지는 항목이라 섞이면 안 된다
  const list = [...(kind === 'event' ? S.cat.events : S.cat.shooters)]
    .sort((a, b) => (a.unknown ? 1 : 0) - (b.unknown ? 1 : 0));
  const cur = S.cat.photos[pid]?.[kind];
  openSheet(`<h3>${t('assign.pick', { label })}</h3><p class="lead">${t('ph.oneLead')}</p><div class="opts" id="os">`
    + list.map(x => `<button class="opt${cur === x.id ? ' on' : ''}" data-id="${x.id}"><span class="l">${esc(x.name)}</span><span class="n">${kind === 'event' ? esc(sug.fmtDate(x.date)) : x.x ? '@' + esc(x.x) : ''}</span><span class="c">${ic('check', 18, 2.8)}</span></button>`).join('')
    + `</div><button class="btn sub" id="os-new" style="width:100%">${ic('plus', 17, 2.2)}${t('assign.new', { label })}</button>`
    + `<button class="btn sub" id="os-unknown" style="width:100%;margin-top:8px">${ic('info', 17, 2)}${t('assign.unknown', { label })}</button>`
    + (cur ? `<button class="btn sub" id="os-clear" style="width:100%;margin-top:8px">${t('ph.assignClear')}</button>` : ''));
  const set = id => { S.cat.photos[pid][kind] = id; touch(); closeSheet(); after?.(); renderAll(); };
  $('#os').onclick = e => { const b = e.target.closest('[data-id]'); if (b) set(b.dataset.id); };
  $('#os-new').onclick = () => newEntitySheet(kind, id => set(id));
  $('#os-unknown')?.addEventListener('click', () => set(kind === 'event' ? unknownEvent().id : unknownShooter().id));
  $('#os-clear')?.addEventListener('click', () => set(null));
}

/** 사진 한 장에 인물 여러 명 */
function manySheet(kind, pid, after) {
  const p = S.cat.photos[pid];
  const list = S.cat.people;
  openSheet(`<h3>${t('more.person')}</h3><p class="lead">${t('ph.peopleLead')}</p><div class="opts" id="ms"></div>`
    + `<button class="btn sub" id="ms-new" style="width:100%">${ic('plus', 17, 2.2)}${t('ph.newPerson')}</button>`);
  const box = $('#ms');
  const paint = () => {
    box.innerHTML = '';
    list.forEach(x => {
      const on = (p.people || []).includes(x.id);
      const o = el('button', 'opt' + (on ? ' on' : ''), `<span class="l">${esc(x.name)}</span><span class="n">${esc(x.role || (x.x ? '@' + x.x : ''))}</span><span class="c">${ic('check', 18, 2.8)}</span>`);
      o.onclick = () => {
        p.people = p.people || [];
        p.people = on ? p.people.filter(v => v !== x.id) : [...p.people, x.id];
        touch(); paint(); after?.();
      };
      box.appendChild(o);
    });
    if (!list.length) box.innerHTML = `<div class="note">${ic('info', 17)}<span>${t('ph.noPerson')}</span></div>`;
  };
  paint();
  $('#ms-new').onclick = () => newEntitySheet('person', id => {
    p.people = [...(p.people || []), id];
    touch(); after?.();
    manySheet(kind, pid, after);
  });
}

const chLabel = url => ({ instagram: 'IG', x: 'X', blog: 'Blog', linkedin: 'in', threads: '@' }[channelOf(url)] || 'etc');

async function writeText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
}
/** blob → PNG blob. 클립보드는 PNG 만 확실히 받는다. */
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return new Promise(r => c.toBlob(r, 'image/png'));
}

/**
 * 사진과 텍스트를 한 번에 복사한다.
 * ClipboardItem 하나에 image/png 과 text/plain 두 표현을 담으면, 붙여넣는
 * 앱이 자기가 받을 수 있는 쪽을 골라 간다. 다만 대부분의 SNS 작성기는
 * 이미지 **또는** 텍스트 하나만 받으므로, 한 번 붙여서 둘이 같이 들어가는
 * 것은 앱에 따라 다르다. 그래서 개별 복사 버튼도 남겨 둔다.
 */
async function writeBoth(imgBlob, text) {
  try {
    const png = await toPng(imgBlob);
    const item = new ClipboardItem({
      'image/png': png,
      'text/plain': new Blob([text], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    return 'both';
  } catch {
    // 두 표현을 함께 못 쓰는 브라우저 — 사진만이라도 넣는다
    try {
      const png = await toPng(imgBlob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return 'image';
    } catch { return 'none'; }
  }
}

/* ============================ 사용하기 ============================ */

export async function useSheet(id, after) {
  const p = S.cat.photos[id];
  const txt = copyTextFor({ ...p });
  const s = openSheet(`<h3>${t('use.title')}</h3><p class="lead">${t('use.lead')}</p>`
    + `<div class="cpcard" id="c1"><div class="cphead"><span class="num">${ic('check', 13, 3)}</span>`
    + `<span class="lb">${t('use.block')}</span>`
    + `<span class="sm">${p.w ? `${fmt(p.w)} × ${fmt(p.h)}` : ''}</span></div>`
    + `<div class="cpimg"><img class="sk" style="aspect-ratio:3/2" alt=""></div>`
    + `<pre class="pv" data-empty="${esc(t('ph.pvEmpty'))}">${esc(txt)}</pre></div>`
    + `<button class="btn" id="c-copy" style="margin-top:12px">${ic('copy', 18, 2.2)}${t('use.copyBoth')}</button>`
    + `<div class="splitrow"><button id="c1b">${t('use.photoOnly')}</button><button id="c2b">${t('use.textOnly')}</button></div>`
    + `<button class="optlink" id="c-opt">${t('use.editOpts')}${ic('chev', 15, 2.2)}</button>`
    + `<button class="btn sub" id="c-next" style="width:100%">${t('use.next')}</button>`);

  const img = s.querySelector('.cpimg img');
  let blob = null;
  th.blobOf(id, 1600).then(async b => {
    blob = b;
    if (!b) return;
    /* 미리보기용 URL 은 이미지가 그려지는 순간 놓아준다. 디코딩이 끝나면
       화면에 남는 것은 브라우저가 관리하는 비트맵이고, URL 을 붙잡고 있을
       이유가 없다. 복사에 쓸 blob 자체는 위 변수에 그대로 있다. */
    const u = URL.createObjectURL(b);
    img.addEventListener('load', () => URL.revokeObjectURL(u), { once: true });
    img.classList.remove('sk');
    img.src = u;
  });

  $('#c-copy').onclick = async () => {
    if (!blob) { toast(t('use.stillLoading')); return; }
    const r = await writeBoth(blob, txt);
    $('#c1').classList.add('done');
    toast(r === 'both' ? t('use.copiedBoth')
      : r === 'image' ? t('use.copiedPhotoOnly')
        : t('use.blockedAll'));
  };
  $('#c1b').onclick = async () => {
    if (!blob) { toast(t('use.stillLoading')); return; }
    const r = await writeBoth(blob, '');
    toast(r === 'none' ? t('use.blockedPhoto') : t('use.copiedPhoto'));
  };
  $('#c2b').onclick = async () => {
    if (!txt) { toast(t('use.noText')); return; }
    toast((await writeText(txt)) ? t('use.copiedText') : t('ph.copyBlocked'));
  };
  $('#c-opt').onclick = () => { closeSheet(); openCopyOptions(); };
  $('#c-next').onclick = () => usageSheet([id], after);
}

export function usageSheet(ids, after) {
  const today = new Date().toISOString().slice(0, 10);
  openSheet(`<h3>${t('use.recTitle')}</h3><p class="lead">${ids.length > 1 ? t('use.recLeadMany', { n: fmt(ids.length) }) : t('use.recLeadOne')}</p>`
    + `<div class="fld"><label for="u-url">${t('use.url')}</label>`
    + `<input id="u-url" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://www.instagram.com/p/...">`
    + `<div class="detect" id="u-det">${t('use.detectHint')}</div></div>`
    + `<div class="fld"><label for="u-date">${t('use.date')}</label><input id="u-date" type="date" value="${today}"></div>`
    + `<button class="btn" id="u-save">${t('use.save')}</button>`);

  const inp = $('#u-url'), det = $('#u-det');
  inp.addEventListener('input', () => {
    const v = inp.value.trim(), k = channelOf(v);
    det.innerHTML = !v ? t('use.detectHint')
      : k ? `<span class="ch ${k}" style="width:26px;height:26px;border-radius:8px;font-size:var(--t9)">${chLabel(v)}</span><span style="color:var(--green);font-weight:700">${t('use.detected', { name: CHNAME[k] })}</span>`
        : `${ic('info', 15)}<span>${t('use.unknownDomain')}</span>`;
  });
  $('#u-save').onclick = () => {
    const url = inp.value.trim().replace(/^https?:\/\//, '');
    if (!url) { inp.focus(); det.innerHTML = `${ic('info', 15)}<span style="color:var(--blue);font-weight:700">${t('use.needUrl')}</span>`; return; }
    const date = $('#u-date').value || today;
    let unplanned = 0;
    ids.forEach(i => {
      const p = S.cat.photos[i];
      if (!p) return;
      (p.usages ||= []).push({ ch: channelOf(url) || 'etc', url, date });
      // 올렸으면 예정은 끝난 것이다. 손으로 또 지우게 두면 목록이 못 믿을 게 된다.
      if (p.plannedAt) { p.plannedAt = null; unplanned++; }
    });
    touch();
    closeSheet();
    toast(`${t('use.saved', { n: fmt(ids.length) })}${unplanned ? ' · ' + t('use.unplanned') : ''}`);
    after?.();
    renderAll();
  };
  setTimeout(() => inp.focus(), 340);
}

const CHNAME = { get instagram() { return t('ch.instagram'); }, x: 'X', get blog() { return t('ch.blog'); }, get linkedin() { return t('ch.linkedin'); }, get threads() { return t('ch.threads'); } };

/* ============================ 태그 탭 ============================ */

/* 태그 목록은 탭을 잡아먹지 않도록 설정 안의 푸시 화면으로 둔다. */
export function openTagBrowse() {
  push(t('find.title'), sc => paintTags(sc));
}

function paintTags(b) {
  b.innerHTML = '';
  const all = photos();
  const head = el('div', 'gtitle');
  head.innerHTML = `<h2>${t('find.title')}</h2><div class="m">${t('find.lead')}</div>`;
  b.appendChild(head);

  const mk = (label, items, kind) => {
    const s = el('div', 'sec');
    s.appendChild(el('div', 'sec-lb', `<h2>${label}</h2><span class="n">${items.length}</span>`));
    if (!items.length) {
      s.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t('find.emptyHere')}</span>`));
    } else {
      const box = el('div', 'card stagger');
      items.forEach(it => {
        const r = el('button', 'row');
        r.innerHTML = (it.av !== undefined ? avatarHTML(it.l, it.av) : `<span class="row-ico">${ic(kind === 'event' ? 'cal' : 'tag', 18)}</span>`)
          + `<span class="grow"><span class="t">${esc(it.l)}</span>${it.d ? `<span class="d${it.x ? ' x' : ''}">${esc(it.d)}</span>` : ''}</span>`
          + `<span class="n-sm">${t('common.photoN', { n: fmt(it.n) })}</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
        r.onclick = () => {
          V.filter = NO_FILTER();
          if (kind === 'event') V.filter.event = it.v;
          else if (kind === 'shooter') V.filter.shooter = it.v;
          else if (kind === 'person') V.filter.person = it.v;
          else V.filter.tag = it.v;
          V.limit = 60;
          goTab('photos');
          popAll();
        };
        box.appendChild(r);
      });
      s.appendChild(box);
    }
    b.appendChild(s);
  };

  mk(t('assign.event'), S.cat.events.map(e => ({ v: e.id, l: e.name, d: sug.fmtDate(e.date), n: all.filter(p => p.event === e.id).length })), 'event');
  mk(t('assign.shooter'), sortByName(S.cat.shooters).map(s => ({ v: s.id, l: s.name, d: s.x ? '@' + s.x : t('common.noXId'), x: !!s.x, av: s.avatar, n: all.filter(p => p.shooter === s.id).length })), 'shooter');
  mk(t('ph.people'), S.cat.people.map(s => ({ v: s.id, l: s.name, d: s.role || (s.x ? '@' + s.x : ''), av: s.avatar, n: all.filter(p => (p.people || []).includes(s.id)).length })).sort((a, c) => c.n - a.n), 'person');
  mk(t('find.freeTags'), S.cat.tags.map(tag => ({ v: tag, l: tag, n: all.filter(p => (p.tags || []).includes(tag)).length })).sort((a, c) => c.n - a.n), 'tag');

  const n = el('div', 'sec');
  n.style.marginTop = '20px';
  n.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t('find.note')}</span>`));
  b.appendChild(n);
}

/* ============================ 설정 ============================ */

/* 설정은 이제 탭이 아니라 프로필 탭에서 들어가는 push 화면이다.
   컨테이너에 id 를 박아 두어야 저장 후 다시 그릴 때 찾을 수 있다. */
export function openSettings() {
  push(t('tab.settings'), sc => { sc.id = 'settings-body'; paintSettings(sc); });
}

/** 열려 있을 때만 다시 그린다. 닫혀 있으면 아무 일도 하지 않는다. */
export function renderSettings() {
  const b = $('#settings-body');
  if (!b) return;
  keepScroll(b, () => paintSettings(b));
}

function paintSettings(b) {
  b.innerHTML = '';
  const all = photos();

  /* 내 프로필은 프로필 탭으로 옮겼다 — 여기는 설정만 남는다. */

  /* 표시 */
  const dp = el('div', 'sec');
  dp.appendChild(el('div', 'sec-lb', `<h2>${t('set.display')}</h2>`));
  const dbox = el('div', 'card');

  const accent = ACCENTS.find(a => a.k === (S.cat.opts.accent || 'blue')) || ACCENTS[0];
  const themeRow = el('button', 'row',
    `<span class="row-ico" style="background:var(--blue);color:var(--on-blue)">${ic('spark', 18, 2.1)}</span>`
    + `<span class="grow"><span class="t">${t('set.theme')}</span><span class="d">${t('set.themeDesc')}</span></span>`
    + `<span class="n-sm">${esc(accentName(accent.k))}</span><span class="chev">${ic('chev', 18, 2.1)}</span>`);
  themeRow.onclick = accentSheet;
  dbox.appendChild(themeRow);

  const langRow = el('button', 'row', `<span class="row-ico">${ic('info', 18)}</span>`
    + `<span class="grow"><span class="t">${t('set.lang')}</span><span class="d">${t('set.langDesc')}</span></span>`
    + `<span class="n-sm">${esc(LANGS.find(l => l.k === getLang())?.name || '')}</span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
  langRow.onclick = langSheet;
  dbox.appendChild(langRow);

  dbox.appendChild(navRow(t('set.homeName'),
    t('set.homeNameDesc', { title: S.cat.opts.homeTitle || t('tab.home'), tab: S.cat.opts.homeTab || S.cat.opts.homeTitle || t('tab.home') }),
    'cal', homeTitleSheet));

  const friRow = el('div', 'row',
    `<span class="row-ico">${ic('check', 18, 2.2)}</span>`
    + `<span class="grow"><span class="t">${t('set.fridayBlock')}</span>`
    + `<span class="d">${isFriday() ? t('set.fridayOn') : t('set.fridayOff')}</span></span>`);
  const friSw = el('button', 'sw' + (S.cat.opts.friday !== false ? ' on' : ''), '<i></i>');
  friSw.setAttribute('aria-pressed', String(S.cat.opts.friday !== false));
  friSw.onclick = () => {
    // 제자리에서 뒤집는다 — 설정 화면을 다시 그리면 애니메이션이 날아간다
    const on = flipSwitch(friSw, S.cat.opts.friday === false);
    S.cat.opts.friday = on;
    const d = friRow.querySelector('.d');
    if (d) d.textContent = on
      ? (isFriday() ? t('set.fridayOn') : t('set.fridayOff'))
      : t('set.hidden');
    touch();
    renderHome();          // 영향받는 화면만
  };
  friRow.appendChild(friSw);
  dbox.appendChild(friRow);


  dp.appendChild(dbox);
  b.appendChild(dp);

  /* 폴더 */
  const f = el('div', 'sec');
  const lb = el('div', 'sec-lb', `<h2>${t('set.folders')}</h2><span class="n">${S.cat.folders.length}</span>`);
  f.appendChild(lb);
  const fb = el('div', 'card');
  S.cat.folders.forEach(fo => {
    const r = el('div', 'row');
    r.innerHTML = `<span class="row-ico">${ic('folder', 18)}</span>`
      + `<span class="grow"><span class="t">${esc(fo.name)}</span><span class="d">${t('set.folderCount', { n: fmt(all.filter(p => true).length && fo.count != null ? fo.count : 0), when: S.cat.syncedAt ? t('set.syncedAt', { date: sug.fmtDate(S.cat.syncedAt.slice(0, 10)) }) : t('set.notSynced') })}</span></span>`;
    const x = el('button', 'copy', ic('x', 15, 2.4));
    x.onclick = () => confirmSheet({
      title: t('set.unlinkQ'), danger: true, ok: t('set.unlink'),
      lead: t('set.unlinkLead'),
      onOk: () => { S.cat.folders = S.cat.folders.filter(z => z.id !== fo.id); touch(); renderSettings(); toast(t('set.unlinked')); },
    });
    r.appendChild(x);
    fb.appendChild(r);
  });
  const add = el('button', 'row', `<span class="row-ico" style="background:var(--blue-fill);color:var(--blue)">${ic('plus', 18, 2.2)}</span>`
    + `<span class="grow"><span class="t" style="color:var(--blue)">${t('set.addFolder')}</span><span class="d">${t('set.addFolderDesc')}</span></span>`);
  add.onclick = () => V.onPickFolders?.();
  fb.appendChild(add);
  f.appendChild(fb);
  b.appendChild(f);

  /* 동기화 */
  const sy = el('div', 'sec');
  sy.appendChild(el('div', 'sec-lb', `<h2>${t('set.syncSec')}</h2>`));
  const syb = el('div', 'card');
  const goneN = Object.keys(S.cat.gone).length;
  syb.innerHTML = `<div class="row"><span class="row-ico">${ic('cloud', 18)}</span>`
    + `<span class="grow"><span class="t">catalog.json</span><span class="d">${S.cat.syncedAt ? new Date(S.cat.syncedAt).toLocaleString(locale()) : t('set.none')}</span></span>`
    /* 저장이 실패한 상태를 숨기면 사용자는 적은 것이 올라갔다고 믿는다.
       실패는 눈에 보여야 한다 — 다시 시도는 알아서 하지만 원인은 알려 준다. */
    + `<span class="n-sm"${S.saveError ? ' style="color:var(--red)"' : ''}>${S.saveError
      ? t('set.saveFailed')
      : S.dirty ? t('set.pendingSave') : S.lastSaveAt ? t('set.savedState') : ''}</span></div>`
    + (goneN ? `<div class="row"><span class="row-ico" style="background:var(--amber-fill);color:var(--amber)">${ic('info', 18)}</span>`
      + `<span class="grow"><span class="t">${t('set.goneN', { n: fmt(goneN) })}</span><span class="d">${t('set.goneDesc')}</span></span></div>` : '');
  const re = el('button', 'row', `<span class="row-ico">${ic('refresh', 18)}</span>`
    + `<span class="grow"><span class="t">${t('set.syncNow')}</span><span class="d">${t('set.syncNowDesc')}</span></span>`);
  re.onclick = () => V.onSync?.();
  syb.appendChild(re);

  /* 기록 백업 — catalog 한 파일에 전부 들어 있어서, 그게 어긋나면
     되돌릴 방법이 없었다. 하루 한 번 자동으로 사본을 남기고 여기서 되돌린다. */
  const bkRow = el('button', 'row', `<span class="row-ico">${ic('cloud', 18)}</span>`
    + `<span class="grow"><span class="t">${t('set.backup')}</span>`
    + `<span class="d">${S.cat.lastBackup ? t('set.backupLast', { d: S.cat.lastBackup }) : t('set.backupNone')}</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
  bkRow.onclick = openBackups;
  syb.appendChild(bkRow);

  /* 썸네일 캐시 — 기기에 남겨서 앱을 다시 열 때 그리드가 바로 채워진다 */
  const cacheRow = el('button', 'row', `<span class="row-ico">${ic('grid', 18)}</span>`
    + `<span class="grow"><span class="t">${t('set.thumbCache')}</span><span class="d">${t('set.counting')}</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
  th.cacheInfo().then(info => {
    const d = cacheRow.querySelector('.d');
    if (d) d.textContent = info.entries
      ? t('set.cacheHas', { n: fmt(info.entries) })
      : t('set.cacheEmpty');
  });
  cacheRow.onclick = () => confirmSheet({
    title: t('set.clearCacheQ'), ok: t('set.clearCache'), danger: true,
    lead: t('set.clearCacheLead'),
    onOk: async () => { await th.clearCache(); toast(t('set.cacheCleared')); renderSettings(); },
  });
  syb.appendChild(cacheRow);

  /* 미리 받기 — 그리드를 끝까지 스크롤해서 채우는 것과 결과는 같지만,
     화면에 띄우지 않으니 메모리가 안 늘고 중간에 튕기지 않는다. */
  const preRow = el('button', 'row', `<span class="row-ico">${ic('cloud', 18)}</span>`
    + `<span class="grow"><span class="t">${t('set.prefetch')}</span>`
    + `<span class="d">${t('set.prefetchDesc')}</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
  preRow.onclick = () => V.onPrefetch?.();
  syb.appendChild(preRow);

  if (S.demo) {
    const dr = el('button', 'row', `<span class="row-ico" style="background:var(--amber-fill);color:var(--amber)">${ic('refresh', 18)}</span>`
      + `<span class="grow"><span class="t" style="color:var(--amber)">${t('set.demoReset')}</span>`
      + `<span class="d">${t('set.demoResetDesc')}</span></span>`);
    dr.onclick = () => confirmSheet({
      title: t('set.demoResetQ'), ok: t('set.reset'), danger: true,
      lead: t('set.demoResetLead'),
      onOk: async () => {
        const { resetDemo } = await import('./demo.js');
        resetDemo();
        location.reload();
      },
    });
    syb.appendChild(dr);
  }

  sy.appendChild(syb);
  b.appendChild(sy);

  /* 사람 */
  const pe = el('div', 'sec');
  pe.appendChild(el('div', 'sec-lb', `<h2>${t('set.peopleSec')}</h2>`));
  const peb = el('div', 'card');
  const noX = [...S.cat.shooters, ...S.cat.people].filter(x => !x.x).length;
  peb.appendChild(navRow(t('assign.shooter'), t('set.shooterDesc', { n: S.cat.shooters.length }), 'cam', () => openEntityList('shooter')));
  peb.appendChild(navRow(t('ph.people'), t('set.peopleDesc', { n: S.cat.people.length }), 'user', () => openEntityList('person')));
  if (noX) peb.appendChild(navRow(t('set.bulkAvatar'), t('set.bulkAvatarDesc', { n: noX }), 'spark', openBulkAvatar, true));
  pe.appendChild(peb);
  b.appendChild(pe);

  /* 태그 · 복사 */
  const sd = el('div', 'sec');
  sd.appendChild(el('div', 'sec-lb', `<h2>${t('set.schedSec')}</h2>`));
  const sdb = el('div', 'card');
  sdb.appendChild(navRow(t('sched.packingList'), t('set.packingDesc', { n: S.cat.packing.length }), 'check', openPacking));
  sdb.appendChild(navRow(t('sched.evCats'), t('set.evCatsDesc', { n: S.cat.eventTags.length }), 'cal', openEventTagManage));
  sd.appendChild(sdb);
  b.appendChild(sd);

  const tg = el('div', 'sec');
  tg.appendChild(el('div', 'sec-lb', `<h2>${t('set.tagSec')}</h2>`));
  const tgb = el('div', 'card');
  tgb.appendChild(navRow(t('set.tagFind'), t('set.tagFindDesc'), 'grid', openTagBrowse));
  tgb.appendChild(navRow(t('set.tagManage'), t('set.tagManageDesc', { n: S.cat.tags.length }), 'tag', openTagManage));
  tgb.appendChild(navRow(t('set.copyTpl'), t('set.copyTplDesc', { n: S.cat.opts.tags.length + (S.cat.opts.eventTag ? 1 : 0), prefix: S.cat.opts.prefix }), 'copy', openCopyOptions));
  tg.appendChild(tgb);
  b.appendChild(tg);

  /* 키 · 권한 */
  const kb = el('div', 'sec');
  kb.appendChild(el('div', 'sec-lb', `<h2>${t('set.acctSec')}</h2>`));
  const kbb = el('div', 'card');
  kbb.appendChild(navRow(t('set.avKey'), av.keys.pub ? t('set.avKeyOn') : t('set.avKeyOff'), 'key', openAvatarKeys));
  // innerHTML += 를 쓰면 위에서 붙인 버튼의 리스너가 날아간다. 반드시 appendChild.
  kbb.appendChild(el('div', 'row', `<span class="row-ico">${ic('key', 18)}</span>`
    + `<span class="grow"><span class="t">drive.file</span><span class="d">${t('set.scopeDesc')}</span></span>`));
  const out = el('button', 'row', `<span class="row-ico" style="background:var(--red-fill);color:var(--red)">${ic('ext', 18)}</span>`
    + `<span class="grow"><span class="t" style="color:var(--red)">${t('auth.logout')}</span><span class="d">${t('set.logoutDesc')}</span></span>`);
  out.onclick = () => V.onLogout?.();
  kbb.appendChild(out);
  kb.appendChild(kbb);
  b.appendChild(kb);

  const note = el('div', 'sec');
  note.style.marginTop = '20px';
  note.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t('set.readOnlyNote')}</span>`));
  b.appendChild(note);
  wireScroll();
}

function navRow(t, d, icon, onClick, accent) {
  const r = el('button', 'row', `<span class="row-ico"${accent ? ' style="background:var(--blue-fill);color:var(--blue)"' : ''}>${ic(icon, 18)}</span>`
    + `<span class="grow"><span class="t">${esc(t)}</span><span class="d">${esc(d)}</span></span><span class="chev">${ic('chev', 18, 2.1)}</span>`);
  r.onclick = onClick;
  return r;
}

/* ---------- 작가 / 인물 목록 ---------- */

function openEntityList(kind) {
  const label = t(kind === 'shooter' ? 'assign.shooter' : 'ph.people');
  push(label, sc => paintEntityList(sc, kind, label));
}

function paintEntityList(sc, kind, label) {
  sc.innerHTML = '';
  // 가나다(일본어는 かな) 순. 많아지면 눈으로 찾을 수 있어야 한다.
  const list = sortByName(kind === 'shooter' ? S.cat.shooters : S.cat.people);
  const all = photos();
  const hd = el('div', 'gtitle');
  hd.innerHTML = `<h2>${label}</h2><div class="m">${t(kind === 'shooter' ? 'ent.shooterLead' : 'ent.personLead')}</div>`;
  sc.appendChild(hd);

  const s = el('div', 'sec');
  s.style.marginTop = '18px';
  const box = el('div', 'card stagger');
  list.forEach(x => {
    const n = kind === 'shooter' ? all.filter(p => p.shooter === x.id).length : all.filter(p => (p.people || []).includes(x.id)).length;
    const r = el('button', 'row');
    r.innerHTML = avatarHTML(x.name, x.avatar)
      + `<span class="grow"><span class="t">${esc(x.name)}</span><span class="d${x.x ? ' x' : ''}">${x.x ? '@' + esc(x.x) : t('ent.needX')}</span></span>`
      + `<span class="n-sm">${t('common.photoN', { n: fmt(n) })}</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
    r.onclick = () => entitySheet(kind, x, () => { paintEntityList(sc, kind, label); renderAll(); });
    box.appendChild(r);
  });
  if (!list.length) box.innerHTML = `<div class="note">${ic('info', 17)}<span>${t('ent.emptyNote')}</span></div>`;
  s.appendChild(box);
  const nb = el('button', 'btn sub', `${ic('plus', 17, 2.2)}${t('ent.new')}`);
  nb.style.cssText = 'width:100%;margin-top:12px';
  nb.onclick = () => newEntitySheet(kind, () => { paintEntityList(sc, kind, label); renderAll(); });
  s.appendChild(nb);
  sc.appendChild(s);
}

/* ---------- 내 프로필 ---------- */

export function meSheet() {
  const me = S.cat.me || (S.cat.me = { nick: '', x: null, avatar: null });
  openSheet(`<h3>${t('me.title')}</h3><p class="lead">${t('me.lead')}</p>`
    + `<div class="fld"><label for="me-nick">${t('me.nick')}</label>`
    + `<input id="me-nick" maxlength="40" value="${esc(me.nick || '')}" placeholder="${t('me.nickPh')}"></div>`
    + `<div class="fld"><label for="me-x">${t('ent.xId')}</label>`
    + `<input id="me-x" maxlength="60" autocapitalize="off" autocorrect="off" spellcheck="false" value="${me.x ? '@' + esc(me.x) : ''}" placeholder="${t('nx.xPh')}">`
    + `<div class="detect" id="me-det">${me.avatar ? `<span class="av" style="width:30px;height:30px"><img alt="" src="${me.avatar}"></span><span>${t('me.savedAvatar')}</span>` : ''}</div></div>`
    + `<button class="btn" id="me-save">${t('common.save')}</button>`
    + (me.x ? `<button class="btn sub" id="me-open" style="width:100%;margin-top:8px">${ic('ext', 17, 2)}${t('me.openX')}</button>` : ''));

  const xf = wireXField($('#me-x'), $('#me-det'));
  $('#me-open')?.addEventListener('click', () => openX(me.x));
  $('#me-save').onclick = async () => {
    const nick = $('#me-nick').value.trim();
    const h = normX($('#me-x').value);
    if (!nick && !h) { $('#me-nick').focus(); return; }
    const btn = $('#me-save');
    btn.disabled = true;
    let avatar = null;
    if (h) {
      btn.textContent = t('xf.checking');
      avatar = await xf.settle();
      if (!avatar && h === me.x) avatar = me.avatar || null;
    }
    me.nick = nick;
    me.x = h;
    me.avatar = avatar;
    touch();
    closeSheet();
    toast(t('me.saved'));
    renderSettings();
  };
  setTimeout(() => $('#me-nick').focus(), 340);
}

/* ---------- 언어 ----------
 * 바꾸면 탭 라벨까지 다시 써야 하므로 renderTabs + renderAll 을 같이 부른다.
 * 언어는 기기 설정이라 catalog(드라이브)에는 넣지 않는다. */
function langSheet() {
  const cur = getLang();
  openSheet(`<h3>${t('set.lang')}</h3><p class="lead">${t('set.langDesc')}</p><div class="opts" id="lg"></div>`);
  const box = $('#lg');
  LANGS.forEach(l => {
    const o = el('button', 'opt' + (cur === l.k ? ' on' : ''),
      `<span class="l">${esc(l.name)}</span><span class="n"></span><span class="c">${ic('check', 18, 2.8)}</span>`);
    o.onclick = () => {
      setLang(l.k);
      /* "미상" 항목의 이름은 데이터로 저장돼 있다(사진 분류에 실제로 쓰이는
         항목이라서). 언어를 바꾸면 그 이름도 같이 고쳐 준다 — 안 고치면
         일본어 화면에 "사진사 미상" 이 그대로 남는다. */
      const ue = S.cat.events.find(x => x.unknown);
      if (ue) ue.name = t('common.unknownEvent');
      const us = S.cat.shooters.find(x => x.unknown);
      if (us) us.name = t('common.unknownShooter');
      if (ue || us) touch();
      closeSheet();
      renderTabs();
      renderAll();
      renderSettings();
    };
    box.appendChild(o);
  });
}

/* ---------- 테마 색 ---------- */

function accentSheet() {
  const o = S.cat.opts;
  const cur = o.accent || 'blue';
  const myHex = parseHex(o.accentHex) || '#FF6B9D';
  openSheet(`<h3>${t('set.theme')}</h3><p class="lead">${t('set.themeSheetLead')}</p>`
    + `<div class="acc-grid" id="ac">`
    + ACCENTS.map(a => `<button class="acc a-${a.k}${a.k === cur ? ' on' : ''}" data-k="${a.k}">`
      + `<span class="dot">${ic('check', 16, 3)}</span><span class="nm">${esc(accentName(a.k))}</span></button>`).join('')
    /* 아홉째 칸 — 직접 넣은 색. 점에 그 색을 그대로 보여 준다. */
    + `<button class="acc${cur === 'custom' ? ' on' : ''}" data-k="custom">`
      + `<span class="dot" style="background:${myHex}">${ic('check', 16, 3)}</span>`
      + `<span class="nm">${esc(accentName('custom'))}</span></button>`
    + `</div>`);
  $('#ac').onclick = e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    if (b.dataset.k === 'custom') return customAccentSheet();
    o.accent = b.dataset.k;
    applyAccent(b.dataset.k);
    touch();
    $('#ac').querySelectorAll('.acc').forEach(x => x.classList.toggle('on', x.dataset.k === b.dataset.k));
    renderAll();
  };
}

/* 컬러 코드로 테마 색을 넣는다.
   늑대와 제목이 흰색인 스플래시에 그대로 쓰이므로, 흰 글자가 안 보일 만큼
   밝은 색이면 알려 준다 — 막지는 않는다. 고르는 건 쓰는 사람 몫이다. */
function customAccentSheet() {
  const o = S.cat.opts;
  const start = parseHex(o.accentHex) || '#FF6B9D';
  openSheet(`<h3>${t('cac.title')}</h3><p class="lead">${t('cac.lead')}</p>`
    + `<div class="cac-prev" id="cac-prev"><span class="cac-sw" id="cac-sw"></span>`
      + `<span class="cac-on" id="cac-on">${t('cac.sample')}</span></div>`
    + `<div class="fld"><label for="cac-t">${t('cac.code')}</label>`
    + `<div class="cac-in"><input type="color" id="cac-c" value="${start}" aria-label="${t('cac.pick')}">`
    + `<input id="cac-t" maxlength="7" value="${start}" placeholder="#3182F6" spellcheck="false"></div>`
    + `<div class="hint" id="cac-h">${t('cac.hint')}</div></div>`
    + `<button class="btn" id="cac-save">${t('common.save')}</button>`);

  const tx = $('#cac-t'), cp = $('#cac-c'), sw = $('#cac-sw'), on = $('#cac-on'), hint = $('#cac-h');
  let val = start;

  const paint = raw => {
    const h = parseHex(raw);
    $('#cac-save').disabled = !h;
    if (!h) { hint.textContent = t('cac.bad'); hint.className = 'hint warn'; return; }
    val = h;
    const v = accentVars(h, false);
    sw.style.background = h;
    on.style.background = h;
    on.style.color = v['--on-blue'];
    // 흰 글자가 받쳐지지 않는 색이면 알려 준다 (스플래시 제목이 흰색이다)
    const light = v['--on-blue'] !== '#FFFFFF';
    hint.textContent = light ? t('cac.tooLight') : t('cac.hint');
    hint.className = 'hint' + (light ? ' warn' : '');
  };
  paint(start);

  tx.oninput = () => { paint(tx.value); const h = parseHex(tx.value); if (h) cp.value = h; };
  cp.oninput = () => { tx.value = cp.value.toUpperCase(); paint(cp.value); };
  $('#cac-save').onclick = () => {
    o.accentHex = val;
    o.accent = 'custom';
    applyAccent('custom', val);
    touch();
    closeSheet();
    toast(t('cac.done', { hex: val }));
    renderAll();
  };
}

/* ---------- 홈 화면 이름 ---------- */

function homeTitleSheet() {
  const o = S.cat.opts;
  openSheet(`<h3>${t('ht.title')}</h3><p class="lead">${t('ht.lead')}</p>`
    + `<div class="fld"><label for="ht">${t('ht.name')}</label>`
    + `<input id="ht" maxlength="40" value="${esc(o.homeTitle || '')}" placeholder="${t('tab.home')}">`
    + `<div class="hint">${t('ht.nameHint')}</div></div>`
    + `<div class="fld"><label for="htab">${t('ht.tab')}</label>`
    + `<input id="htab" maxlength="12" value="${esc(o.homeTab || '')}" placeholder="${esc(o.homeTitle || t('tab.home'))}">`
    + `<div class="hint">${t('ht.tabHint')}</div></div>`
    + `<button class="btn" id="ht-save">${t('common.save')}</button>`);
  const i = $('#ht');
  $('#ht-save').onclick = () => {
    o.homeTitle = i.value.trim() || t('tab.home');
    o.homeTab = $('#htab').value.trim();
    touch();
    closeSheet();
    toast(t('ht.done', { name: o.homeTitle }));
    renderAll();
  };
  setTimeout(() => { i.focus(); i.select(); }, 340);
}

export function entitySheet(kind, ent, after) {
  const isSh = kind === 'shooter';
  openSheet(`<h3>${esc(ent.name)}</h3><p class="lead">${t(isSh ? 'ent.editShooterLead' : 'ent.editPersonLead')}</p>`
    + `<div class="fld"><label for="es-name">${t('ent.name')}</label><input id="es-name" maxlength="60" value="${esc(ent.name)}"></div>`
    + (isSh ? '' : `<div class="fld"><label for="es-role">${t('ent.role')}</label><input id="es-role" maxlength="30" value="${esc(ent.role || '')}" placeholder="${t('nx.rolePh')}"></div>`)
    + `<div class="fld"><label for="es-x">${t('ent.xId')}</label><input id="es-x" maxlength="60" autocapitalize="off" autocorrect="off" value="${ent.x ? '@' + esc(ent.x) : ''}" placeholder="${t('nx.xPh')}">`
    + `<div class="detect" id="es-det">${ent.avatar ? `<span class="av" style="width:30px;height:30px"><img alt="" src="${ent.avatar}"></span><span>${t('me.savedAvatar')}</span>` : ''}</div></div>`
    + `<button class="btn" id="es-save">${t('common.save')}</button>`
    + (ent.x ? `<button class="btn sub" id="es-open" style="width:100%;margin-top:8px">${ic('ext', 17, 2)}${t('ent.openX', { x: esc(ent.x) })}</button>` : '')
    + (ent.avatar ? `<button class="btn sub" id="es-refresh" style="width:100%;margin-top:8px">${ic('refresh', 17, 2)}${t('ent.refreshAvatar')}</button>` : ''));

  const xf = wireXField($('#es-x'), $('#es-det'));
  $('#es-open')?.addEventListener('click', () => openX(ent.x));
  $('#es-refresh')?.addEventListener('click', async () => {
    if (!normX($('#es-x').value)) { toast(t('ent.needXFirst')); return; }
    const d = await xf.refresh();
    if (!d) toast(t('ent.refreshFail'));
  });
  $('#es-save').onclick = async () => {
    const nm = $('#es-name').value.trim();
    if (!nm) { $('#es-name').focus(); return; }
    const btn = $('#es-save');
    btn.disabled = true;
    const h = normX($('#es-x').value);
    /* 사진을 받는 중이면 기다린다 — 이걸 안 기다려서 아바타가 사라지고 있었다. */
    let avatar = null;
    if (h) {
      btn.textContent = t('xf.checking');
      avatar = await xf.settle();
      // 핸들이 그대로고 새로 받기가 실패했다면 있던 사진을 지우지 않는다
      if (!avatar && h === ent.x) avatar = ent.avatar || null;
    }
    ent.name = nm;
    if (!isSh) ent.role = ($('#es-role').value.trim() || null);
    ent.x = h;
    ent.avatar = avatar;
    touch();
    closeSheet();
    toast(t('common.saved'));
    after?.();
  };
}

/* ---------- 아바타 한번에 채우기 ---------- */

function openBulkAvatar() { push(t('set.bulkAvatar'), sc => paintBulkAvatar(sc)); }

function paintBulkAvatar(sc) {
  sc.innerHTML = '';
  const targets = [
    ...S.cat.shooters.filter(x => !x.x).map(x => ({ x, kind: 'shooter' })),
    ...S.cat.people.filter(x => !x.x).map(x => ({ x, kind: 'person' })),
  ];
  const hd = el('div', 'gtitle');
  hd.innerHTML = `<h2>${t('ent.bulkTitle', { n: targets.length })}</h2><div class="m">${t('ent.bulkLead')}</div>`;
  sc.appendChild(hd);

  if (!targets.length) {
    const s = el('div', 'sec');
    s.style.marginTop = '18px';
    s.appendChild(el('div', 'note', `${ic('check', 17, 2.6)}<span>${t('ent.bulkAllSet')}</span>`));
    sc.appendChild(s);
    return;
  }

  const s = el('div', 'sec');
  s.style.marginTop = '18px';
  const box = el('div', 'card');
  targets.forEach(({ x }) => {
    const r = el('div', 'row');
    r.innerHTML = avatarHTML(x.name, null) + `<span class="grow"><span class="t">${esc(x.name)}</span></span>`;
    const inp = el('input');
    inp.placeholder = t('ent.xPh');
    inp.maxLength = 60;
    inp.autocapitalize = 'off';
    inp.autocorrect = 'off';
    inp.style.cssText = 'flex:0 0 128px;height:40px;padding:0 12px;border-radius:12px;border:0;background:var(--fill);font:inherit;font-size:var(--t7);font-weight:600';
    inp.dataset.id = x.id;
    r.appendChild(inp);
    box.appendChild(r);
  });
  s.appendChild(box);
  sc.appendChild(s);

  const bar = el('div', 'sec');
  bar.style.marginTop = '14px';
  const btn = el('button', 'btn', t('ent.bulkSave', { n: targets.length }));
  btn.onclick = async () => {
    const rows = [...box.querySelectorAll('input')].map(i => ({ id: i.dataset.id, h: normX(i.value) })).filter(r => r.h);
    if (!rows.length) { toast(t('ent.bulkNoInput')); return; }
    btn.disabled = true;
    let ok = 0;
    for (const { id, h } of rows) {
      const ent = S.cat.shooters.find(z => z.id === id) || S.cat.people.find(z => z.id === id);
      if (!ent) continue;
      ent.x = h;
      const r = await av.fetchAvatar(h);
      if (r.ok) { ent.avatar = r.dataUrl; ok++; }
      btn.textContent = t('ent.bulkWorking', { done: ok, total: rows.length });
    }
    touch();
    toast(t('ent.bulkDone', { n: rows.length, got: ok }));
    paintBulkAvatar(sc);
    renderAll();
  };
  bar.appendChild(btn);
  sc.appendChild(bar);
}

/* ---------- 태그 관리 ---------- */

export function openTagManage() { push(t('set.tagManage'), sc => paintTagManage(sc)); }

function paintTagManage(sc) {
  sc.innerHTML = '';
  const all = photos();
  const hd = el('div', 'gtitle');
  hd.innerHTML = `<h2>${t('tm.title')}</h2><div class="m">${t('tm.lead')}</div>`;
  sc.appendChild(hd);

  const s = el('div', 'sec');
  s.style.marginTop = '18px';
  const ar = el('div', 'addrow');
  ar.innerHTML = `<input id="tm-in" placeholder="${t('tm.ph')}" maxlength="20"><button id="tm-add">${t('tm.add')}</button>`;
  s.appendChild(ar);
  const wrap = el('div', 'tagwrap');
  wrap.style.marginTop = '14px';
  S.cat.tags.forEach(tag => {
    const n = all.filter(p => (p.tags || []).includes(tag)).length;
    const c = el('button', 'tg', `${esc(tag)} <span class="k">${n}</span><span class="x">${ic('x', 13, 2.6)}</span>`);
    c.onclick = () => confirmSheet({
      title: t('tm.delQ', { tag }), danger: true, ok: t('tm.del'),
      lead: n ? t('tm.delUsed', { n: fmt(n) }) : t('tm.delNone'),
      onOk: () => {
        S.cat.tags = S.cat.tags.filter(x => x !== tag);
        Object.values(S.cat.photos).forEach(p => { if (p.tags) p.tags = p.tags.filter(x => x !== tag); });
        markDeleted('tags', tag);
        touchNow(); paintTagManage(sc); renderAll(); toast(t('tm.deleted'));
      },
    });
    wrap.appendChild(c);
  });
  if (!S.cat.tags.length) wrap.appendChild(el('span', 'tg add', t('tm.none')));
  s.appendChild(wrap);
  sc.appendChild(s);

  const addTag = () => {
    const v = ar.querySelector('#tm-in').value.trim().replace(/^#/, '');
    if (!v) return;
    if (S.cat.tags.includes(v)) { toast(t('tm.dupe')); return; }
    S.cat.tags.push(v);
    touch();
    paintTagManage(sc);
    renderAll();
    toast(t('tm.created', { tag: v }));
  };
  ar.querySelector('#tm-add').onclick = addTag;
  ar.querySelector('#tm-in').addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });
}

/* ---------- 일정 태그 관리 ---------- */

export function openEventTagManage() { push(t('sched.evCats'), sc => paintEventTagManage(sc)); }

function paintEventTagManage(sc) {
  keepScroll(sc, () => {
    sc.innerHTML = '';
    const hd = el('div', 'gtitle');
    hd.innerHTML = `<h2>${t('sched.evCats')}</h2><div class="m">${t('ct.secLead')}</div>`;
    sc.appendChild(hd);

    const s = el('div', 'sec');
    s.style.marginTop = '18px';
    const box = el('div', 'card');
    S.cat.eventTags.forEach(tag => {
      const used = S.cat.events.filter(e => (e.tags || []).includes(tag.name)).length;
      const r = el('button', 'row');
      r.innerHTML = `<span class="cat c-${tag.color}" style="pointer-events:none">${esc(tag.name)}</span>`
        + `<span class="grow"></span><span class="n-sm">${t('ct.usedN', { n: used })}</span>`
        + `<span class="chev">${ic('chev', 18, 2.1)}</span>`;
      r.onclick = () => catSheet(tag, () => paintEventTagManage(sc));
      box.appendChild(r);
    });
    if (!S.cat.eventTags.length) {
      box.appendChild(el('div', 'row', `<span class="grow"><span class="t" style="color:var(--g500)">${t('ct.emptyT')}</span><span class="d">${t('ct.emptyD')}</span></span>`));
    }
    s.appendChild(box);
    const nb = el('button', 'btn sub', `${ic('plus', 17, 2.2)}${t('ct.make')}`);
    nb.style.cssText = 'width:100%;margin-top:12px';
    nb.onclick = () => catSheet(null, () => paintEventTagManage(sc));
    s.appendChild(nb);
    sc.appendChild(s);
  });
}

/** 카테고리 만들기 / 이름·색 편집 / 삭제. 일정 상세에서도 이걸 그대로 쓴다. */
export function catSheet(tag, after) {
  const isNew = !tag;
  let color = tag ? tag.color : CAT_COLORS[Math.floor(Math.random() * CAT_COLORS.length)];
  const used = tag ? S.cat.events.filter(e => (e.tags || []).includes(tag.name)).length : 0;

  const render = () => {
    openSheet(`<h3>${t(isNew ? 'ct.make' : 'ct.edit')}</h3>`
      + `<p class="lead">${t('ct.lead')}</p>`
      + `<div class="fld"><label for="ct-name">${t('ent.name')}</label>`
      + `<input id="ct-name" maxlength="16" value="${esc(tag ? tag.name : '')}" placeholder="${t('ct.namePh')}"></div>`
      + `<div class="fld"><label>${t('ct.color')}</label><div class="swatches" id="ct-sw">`
      + CAT_COLORS.map(c => `<button class="sw-dot c-${c}${c === color ? ' on' : ''}" data-c="${c}" aria-label="${c}">${ic('check', 16, 3)}</button>`).join('')
      + `</div></div>`
      + `<div class="fld"><label>${t('ct.preview')}</label><div><span class="cat c-${color}" id="ct-pv">${esc(tag ? tag.name : t('ct.sample'))}</span></div></div>`
      + `<button class="btn" id="ct-save">${t(isNew ? 'tm.add' : 'common.save')}</button>`
      + (isNew ? '' : `<button class="btn danger" id="ct-del" style="margin-top:8px">${t('common.delete')}</button>`));

    const nm = $('#ct-name');
    const pv = $('#ct-pv');
    nm.addEventListener('input', () => { pv.textContent = nm.value.trim() || t('ct.sample'); });
    $('#ct-sw').onclick = e => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      color = b.dataset.c;
      $('#ct-sw').querySelectorAll('.sw-dot').forEach(d => d.classList.toggle('on', d.dataset.c === color));
      pv.className = `cat c-${color}`;
    };
    $('#ct-save').onclick = () => {
      const name = nm.value.trim().replace(/^#/, '');
      if (!name) { nm.focus(); return; }
      if (S.cat.eventTags.some(x => x.name === name && x !== tag)) { toast(t('ct.dupe')); return; }
      if (isNew) {
        S.cat.eventTags.push({ name, color });
      } else {
        // 이름이 바뀌면 이미 붙어 있는 일정도 따라 바꿰야 한다
        if (tag.name !== name) {
          S.cat.events.forEach(e => { if (e.tags) e.tags = e.tags.map(x => (x === tag.name ? name : x)); });
        }
        tag.name = name;
        tag.color = color;
      }
      touch();
      closeSheet();
      toast(isNew ? t('ct.created', { name }) : t('common.saved'));
      if (after) after(name);
      renderAll();
    };
    const del = $('#ct-del');
    if (del) {
      del.onclick = () => confirmSheet({
        title: t('ct.delQ', { name: tag.name }), danger: true, ok: t('common.delete'),
        lead: used ? t('ct.delUsed', { n: used }) : t('ct.delNone'),
        onOk: () => {
          S.cat.eventTags = S.cat.eventTags.filter(x => x !== tag);
          S.cat.events.forEach(e => { if (e.tags) e.tags = e.tags.filter(x => x !== tag.name); });
          markDeleted('eventTags', tag.name);
          touchNow(); if (after) after(); renderAll(); toast(t('ct.deleted'));
        },
      });
    }
    if (isNew) setTimeout(() => nm.focus(), 340);
  };
  render();
}

/* ---------- 행사 로고 ---------- */

/**
 * 행사 로고를 이미지로 정한다. 이모지가 아니라 그 행사의 로고 이미지를 쓰기
 * 위한 것이고, 정하지 않으면 목록에서 대표 사진이 나온다.
 * 128px WebP 로 줄여 catalog 에 넣는다 — 원본을 넣으면 카탈로그가 불어난다.
 */
export function logoSheet(ev, after) {
  let logo = ev.logo || null;

  const render = () => {
    const shown = logo
      ? `<img class="evlogo big" alt="" src="${logo}">`
      : `<span class="evlogo big none">${t('lg.coverWord')}</span>`;
    openSheet(`<h3>${t('lg.title')}</h3>`
      + `<p class="lead">${t('lg.lead')}</p>`
      + `<div class="logorow">${shown}`
      + `<span class="lg-t"><b>${esc(ev.name)}</b>`
      + `<em>${t(logo ? 'lg.usingLogo' : 'lg.usingCover')}</em></span></div>`
      + `<button class="btn" id="lg-pick" style="margin-top:18px">${ic('grid', 18, 2.1)}${t(logo ? 'lg.pickOther' : 'lg.pick')}</button>`
      + (logo ? `<button class="btn sub" id="lg-clear" style="width:100%;margin-top:8px">${t('lg.clear')}</button>` : '')
      + `<button class="btn sub" id="lg-save" style="width:100%;margin-top:8px">${t('common.save')}</button>`
      + `<div class="fld" style="margin:16px 0 0"><div class="hint">${t('lg.hint')}</div></div>`);

    $('#lg-pick').onclick = async () => {
      const file = await pickImage();
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast(t('lg.notImage')); return; }
      try {
        logo = await squareDataURL(file, 128);
        render();
        toast(t('lg.loaded'));
      } catch {
        toast(t('lg.procFail'));
      }
    };
    const clr = $('#lg-clear');
    if (clr) clr.onclick = () => { logo = null; render(); };
    $('#lg-save').onclick = () => {
      ev.logo = logo || null;
      ev.icon = null;              // 예전 이모지 값은 정리한다
      touch(); closeSheet();
      toast(t(logo ? 'lg.saved' : 'lg.usingCoverNow'));
      if (after) after();
      renderAll();
    };
  };
  render();
}

/* ---------- 복사 템플릿 ---------- */

export function openCopyOptions() { push(t('set.copyTpl'), sc => paintCopyOptions(sc)); }

function paintCopyOptions(sc) {
  sc.innerHTML = '';
  const o = S.cat.opts;
  const hd = el('div', 'gtitle');
  hd.innerHTML = `<h2>${t('cp.title')}</h2><div class="m">${t('cp.lead')}</div>`;
  sc.appendChild(hd);

  const s1 = el('div', 'sec');
  s1.style.marginTop = '18px';
  const box = el('div', 'card');
  const r1 = el('div', 'row', `<span class="grow"><span class="t">${t('cp.eventTag')}</span><span class="d">${esc(S.cat.events[0] ? hashtagify(S.cat.events[0].name) : t('cp.eventTagSample'))}</span></span>`);
  const sw = el('button', 'sw' + (o.eventTag ? ' on' : ''), '<i></i>');
  sw.setAttribute('aria-pressed', String(o.eventTag));
  sw.onclick = () => {
    o.eventTag = flipSwitch(sw, !o.eventTag);
    touch();
    // 미리보기만 갱신한다. 화면을 다시 그리면 스위치가 튄다.
    const pv = sc.querySelector('.pv');
    const sample = photos().find(p => p.shooter && shooterById(p.shooter)?.x) || photos()[0];
    if (pv) pv.textContent = sample ? copyTextFor(sample) : (o.tags || []).join(' ');
  };
  r1.appendChild(sw);
  box.appendChild(r1);
  s1.appendChild(box);
  sc.appendChild(s1);

  const s2 = el('div', 'sec');
  s2.appendChild(el('div', 'sec-lb', `<h2>${t('cp.baseTags')}</h2><span class="n">${o.tags.length}</span>`));
  const tw = el('div', 'tagwrap');
  o.tags.forEach((tag, i) => {
    const c = el('button', 'tg', `${esc(tag)}<span class="x">${ic('x', 13, 2.6)}</span>`);
    c.onclick = () => { o.tags.splice(i, 1); touch(); paintCopyOptions(sc); };
    tw.appendChild(c);
  });
  if (!o.tags.length) tw.appendChild(el('span', 'tg add', t('sched.none')));
  s2.appendChild(tw);
  const ar = el('div', 'addrow');
  ar.style.marginTop = '10px';
  ar.innerHTML = `<input id="ot" placeholder="${t('cp.addPh')}" maxlength="30"><button id="ota">${t('common.add')}</button>`;
  s2.appendChild(ar);
  sc.appendChild(s2);
  const addTag = () => {
    let v = ar.querySelector('#ot').value.trim().replace(/\s+/g, '');
    if (!v) return;
    if (!v.startsWith('#')) v = '#' + v;
    if (o.tags.includes(v)) { toast(t('cp.dupe')); return; }
    o.tags.push(v); touch(); paintCopyOptions(sc);
  };
  ar.querySelector('#ota').onclick = addTag;
  ar.querySelector('#ot').addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });

  const s3 = el('div', 'sec');
  s3.appendChild(el('div', 'sec-lb', `<h2>${t('cp.creditStyle')}</h2>`));
  s3.appendChild(segment([['#', t('cp.hash')], ['@', t('cp.mention')]], o.prefix, v => { o.prefix = v; touch(); paintCopyOptions(sc); }));
  s3.querySelector('.segwrap').style.padding = '0';
  sc.appendChild(s3);

  if (o.prefix === '@') {
    const w = el('div', 'sec');
    w.style.marginTop = '12px';
    w.appendChild(el('div', 'note warn', `${ic('info', 17)}<span>${t('cp.note')}</span>`));
    sc.appendChild(w);
  }

  const s4 = el('div', 'sec');
  s4.appendChild(el('div', 'sec-lb', `<h2>${t('cp.preview')}</h2>`));
  const sample = photos().find(p => p.shooter && shooterById(p.shooter)?.x) || photos()[0];
  const pv = el('pre', 'pv', esc(sample ? copyTextFor(sample) : o.tags.join(' ')));
  pv.setAttribute('data-empty', t('ph.pvEmpty'));
  pv.style.background = 'var(--fill-2)';
  s4.appendChild(pv);
  sc.appendChild(s4);
}

/* ---------- 기록 백업 ---------- */

function openBackups() { push(t('set.backup'), sc => paintBackups(sc)); }

async function paintBackups(sc) {
  sc.innerHTML = '';

  const hd = el('div', 'sec');
  hd.innerHTML = `<h2>${t('set.backup')}</h2><div class="m">${t('bk.lead')}</div>`;
  sc.appendChild(hd);

  const bar = el('div', 'sec');
  bar.style.marginTop = '14px';
  const now = el('button', 'btn sub', `${ic('cloud', 17, 2)}${t('bk.now')}`);
  now.style.width = '100%';
  now.onclick = async () => {
    now.disabled = true; now.textContent = t('bk.working');
    // 오늘 이미 남겼어도 강제로 한 번 더 남긴다
    S.cat.lastBackup = null;
    const r = await backupIfDue();
    toast(r ? t('bk.made', { d: r }) : t('bk.failed'));
    paintBackups(sc);
    renderSettings();
  };
  bar.appendChild(now);
  sc.appendChild(bar);

  const s2 = el('div', 'sec');
  s2.style.marginTop = '18px';
  s2.appendChild(el('div', 'sec-lb', `<h2>${t('bk.copies')}</h2><span class="n">${t('bk.loading')}</span>`));
  const box = el('div', 'card');
  s2.appendChild(box);
  sc.appendChild(s2);

  let list = [];
  try { list = await listBackups(); } catch { /* 로그인 만료 등 */ }

  const n = s2.querySelector('.sec-lb .n');
  if (n) n.textContent = t('bk.countN', { n: fmt(list.length) });

  if (!list.length) {
    box.appendChild(el('div', 'ck-row', `<span class="tx" style="color:var(--g500);font-weight:600">${t('bk.empty')}</span>`));
    return;
  }

  list.forEach(f => {
    const day = (f.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || f.name;
    const kb = f.size ? `${Math.round(Number(f.size) / 1024).toLocaleString('ko-KR')} KB` : '';
    const r = el('button', 'row', `<span class="row-ico">${ic('clock', 18)}</span>`
      + `<span class="grow"><span class="t">${esc(day)}</span><span class="d">${esc(kb)}</span></span>`
      + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
    r.onclick = () => confirmSheet({
      title: t('bk.restoreQ', { d: day }), danger: true, ok: t('bk.restore'),
      lead: t('bk.restoreLead'),
      onOk: async () => {
        try {
          await restoreBackup(f.id);
          toast(t('bk.restored'));
          popAll();
          renderAll();
        } catch {
          toast(t('bk.readFail'));
        }
      },
    });
    box.appendChild(r);
  });
}

/* ---------- unavatar 키 ---------- */

function openAvatarKeys() { push(t('ak.title'), sc => paintAvatarKeys(sc)); }

function paintAvatarKeys(sc) {
  sc.innerHTML = '';
  const hd = el('div', 'gtitle');
  hd.innerHTML = `<h2>${t('ak.title')}</h2><div class="m">${t('ak.lead')}</div>`;
  sc.appendChild(hd);

  const s = el('div', 'sec');
  s.style.marginTop = '18px';
  s.innerHTML = `<div class="fld"><label for="ak-pub">${t('ak.pub')}</label>`
    + `<input id="ak-pub" placeholder="pk_..." autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(av.keys.pub)}">`
    + `<div class="hint">${t('ak.pubHint')}</div></div>`
    + `<div class="fld"><label for="ak-sec">${t('ak.sec')}</label>`
    + `<input id="ak-sec" placeholder="sk_..." autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(av.keys.sec)}">`
    + `<div class="hint warn">${t('ak.secHint')}</div></div>`;
  const btn = el('button', 'btn', t('common.save'));
  btn.onclick = () => {
    av.keys.set($('#ak-pub').value, $('#ak-sec').value);
    toast(t('ak.savedLocal'));
    renderSettings();
  };
  s.appendChild(btn);
  sc.appendChild(s);

  const n = el('div', 'sec');
  n.style.marginTop = '20px';
  n.appendChild(el('div', 'note', `${ic('info', 17)}<span>${t('ak.note')}</span>`));
  sc.appendChild(n);
}
