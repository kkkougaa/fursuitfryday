/* screens2.js — 사진 상세, 사용하기, 태그·설정 계열 화면 */
import {
  S, photos, isUsed, isUnfiled, isPlanned, setPlanned,
  eventById, shooterById, personById,
  normX, touch, flush, copyTextFor, channelOf, hashtagify, uid,
  unknownShooter, UNKNOWN_SHOOTER, CAT_COLORS, catColor, ACCENTS, applyAccent,
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
  V, NO_FILTER, renderAll, renderHome, goTab, tagSheet, assignSheet, wireXField, newEntitySheet,
} from './screens.js';
import { openPacking } from './schedule.js';
import { isFriday } from './friday.js';

/* ============================ 사진 상세 ============================ */

/* 사진 화면을 다 닫으면 1200px 미리보기를 놓아준다. 사진을 스무 장쯤
   넘겨보는 동안 그것만 쌓여도 사파리가 탭을 죽인다. */
addPopHook(() => th.releaseBig());

export function openPhoto(id) {
  push('사진', sc => paintPhoto(sc, id), (bar, sc) => {
    const b = el('button', 'btn', `${ic('copy', 18, 2.2)}사용하기`);
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
  if (!p) { sc.innerHTML = '<div class="sec" style="padding-top:40px"><div class="note bad">이 사진은 드라이브에서 사라졌어요.</div></div>'; return; }
  sc.dataset.cur = id;
  sc.innerHTML = '';

  const shot = el('div', 'shot', `<img alt="${esc(p.name || '')}" class="sk" style="aspect-ratio:3/2">`);
  sc.appendChild(shot);
  th.big(id, 1200).then(u => { if (u) { const i = shot.querySelector('img'); i.classList.remove('sk'); i.src = u; } });

  const used = isUsed(p);
  /* 예정을 맨 앞에 둔다. 담아둔 사진을 열었을 때 제일 먼저 확인하고 싶은 게
     "이거 올리기로 한 거였지" 이지, 몇 건 썼는지가 아니다. */
  const state = isPlanned(p)
    ? `<span class="pill plan">${ic('bookmark', 12, 2.6)}업로드 예정</span>`
    : used
      ? `<span class="pill used">${ic('check', 13, 3)}사용됨 ${p.usages.length}건</span>`
      : isUnfiled(p) ? '<span class="pill todo">분류 필요</span>' : '<span class="pill unused">미사용</span>';
  sc.appendChild(el('div', 'statebar', `${state}<span class="fn">${esc(p.name || '')}</span>`));

  /* 업로드 예정 토글 */
  const plSec = el('div', 'sec');
  plSec.style.marginTop = '14px';
  const plBox = el('div', 'card');
  const planDesc = () => (p.plannedAt
    ? `${sug.fmtDate(p.plannedAt.slice(0, 10))}에 담아뒀어요`
    : (used ? '다시 올릴 거면 담아두세요' : 'SNS에 업로드할 사진으로 담아둡니다'));
  const plRow = el('div', 'row',
    `<span class="row-ico plan">${ic('bookmark', 18, 2)}</span>`
    + `<span class="grow"><span class="t">업로드 예정</span><span class="d">${esc(planDesc())}</span></span>`);
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
      pill.innerHTML = on ? `${ic('bookmark', 12, 2.6)}업로드 예정`
        : used ? `${ic('check', 13, 3)}사용됨 ${p.usages.length}건`
          : isUnfiled(p) ? '분류 필요' : '미사용';
    }
    toast(on ? '업로드 예정에 담았어요' : '예정을 해제했어요');
    renderHome();
  };
  plRow.appendChild(plSw);
  plBox.appendChild(plRow);
  plSec.appendChild(plBox);
  sc.appendChild(plSec);

  /* 행사 · 작가 */
  const cls = el('div', 'sec');
  cls.appendChild(el('div', 'sec-lb', '<h2>분류</h2>'));
  const cbox = el('div', 'card');
  cbox.appendChild(assignRow('행사', p.event && eventById(p.event)?.name, 'cal', () => oneSheet('event', id, () => paintPhoto(sc, id))));
  const sh = p.shooter && shooterById(p.shooter);
  cbox.appendChild(assignRow('사진사', sh?.name, 'cam', () => oneSheet('shooter', id, () => paintPhoto(sc, id)), sh?.x ? '@' + sh.x : null));
  cls.appendChild(cbox);
  sc.appendChild(cls);

  /* 사용 이력 */
  const us = el('div', 'sec');
  us.appendChild(el('div', 'sec-lb', `<h2>SNS 사용 이력</h2><span class="n">${p.usages.length}건</span>`));
  const ub = el('div', 'card');
  if (p.usages.length) {
    p.usages.forEach((u, i) => {
      const r = el('div', 'use', `<span class="ch ${channelOf(u.url) || 'etc'}">${chLabel(u.url)}</span>`
        + `<span class="grow"><span class="u">${esc(u.url)}</span><span class="w">${sug.fmtDate(u.date)} 게시</span></span>`);
      const del = el('button', 'copy', ic('trash', 15, 2));
      del.onclick = () => confirmSheet({
        title: '이 기록을 지울까요?', danger: true, ok: '기록 삭제',
        lead: '게시물은 그대로 남고, 이 앱의 기록만 지웁니다.',
        onOk: () => { p.usages.splice(i, 1); touch(); toast('기록을 지웠어요'); paintPhoto(sc, id); renderAll(); },
      });
      r.appendChild(del);
      ub.appendChild(r);
    });
  } else {
    ub.appendChild(el('div', 'use', '<span class="grow"><span class="u" style="color:var(--g500)">아직 등록된 사용 이력이 없어요</span></span>'));
  }
  us.appendChild(ub);
  sc.appendChild(us);

  /* 사진사 크레딧 */
  if (sh && !sh.unknown) {
    const ss = el('div', 'sec');
    ss.appendChild(el('div', 'sec-lb', '<h2>사진사</h2>'));
    const sb = el('div', 'card');
    const r = el('div', 'row');
    r.innerHTML = avatarHTML(sh.name, sh.avatar)
      + `<span class="grow"><span class="t">${esc(sh.name)}</span><span class="d${sh.x ? ' x' : ''}">${sh.x ? '@' + esc(sh.x) : 'X 아이디 없음'}</span></span>`;
    const cp = el('button', 'copy', `${ic('copy', 15, 2)}크레딧`);
    cp.onclick = async () => {
      if (!sh.x) { toast(`${sh.name} 사진사의 X 아이디가 없어요`); return; }
      const t = `${S.cat.opts.emoji} ${S.cat.opts.prefix}${sh.x}`;
      toast((await writeText(t)) ? `${t} 복사했어요` : '복사가 막혀 있어요');
    };
    r.appendChild(cp);
    sb.appendChild(r);
    ss.appendChild(sb);
    sc.appendChild(ss);
  }

  /* 인물 */
  const ps = el('div', 'sec');
  ps.appendChild(el('div', 'sec-lb', `<h2>같이 찍은 퍼슈트</h2><span class="n">${(p.people || []).length}명</span>`));
  const pw = el('div', 'tagwrap');
  (p.people || []).forEach(pid => {
    const per = personById(pid);
    if (!per) return;
    const c = el('button', 'pchip', avatarHTML(per.name, per.avatar) + esc(per.name));
    c.onclick = () => { V.filter = { ...NO_FILTER(), person: pid }; V.limit = 60; goTab('photos'); popAll(); };
    pw.appendChild(c);
  });
  const addP = el('button', 'tg add', `${ic('plus', 14, 2.4)}퍼슈트`);
  addP.onclick = () => manySheet('person', id, () => paintPhoto(sc, id));
  pw.appendChild(addP);
  ps.appendChild(pw);
  sc.appendChild(ps);

  /* 태그 */
  const ts = el('div', 'sec');
  ts.appendChild(el('div', 'sec-lb', '<h2>태그</h2>'));
  const tw = el('div', 'tagwrap');
  (p.tags || []).forEach(t => tw.appendChild(el('span', 'tg', esc(t))));
  const addT = el('button', 'tg add', `${ic('plus', 14, 2.4)}태그`);
  addT.onclick = () => tagSheet([id], () => paintPhoto(sc, id));
  tw.appendChild(addT);
  ts.appendChild(tw);
  sc.appendChild(ts);

  /* 촬영 정보 */
  const kv = el('div', 'sec');
  kv.appendChild(el('div', 'sec-lb', '<h2>촬영 정보</h2><span class="n">EXIF</span>'));
  const rows = [
    ['촬영시각', p.shotAt ? p.shotAt.replace('T', ' ').replace(/-/g, '.') : '없음'],
    ['카메라', p.cameraModel || '없음'],
    ['렌즈', p.lens || '없음'],
    ['노출', [p.exposure, p.iso ? `ISO ${p.iso}` : null].filter(Boolean).join(' · ') || '없음'],
    ['해상도', p.w && p.h ? `${fmt(p.w)} × ${fmt(p.h)}` : '없음'],
    ['용량', p.size ? `${(p.size / 1048576).toFixed(1)} MB` : '없음'],
  ];
  kv.appendChild(el('dl', 'kv', rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')));
  sc.appendChild(kv);
  sc.appendChild(el('div', '', '')).style.height = '12px';
}

function assignRow(label, value, icon, onClick, sub) {
  const r = el('button', 'row');
  const has = !!value;
  r.innerHTML = `<span class="row-ico"${has ? '' : ' style="background:var(--amber-fill);color:var(--amber)"'}>${ic(icon, 18)}</span>`
    + `<span class="grow"><span class="t"${has ? '' : ' style="color:var(--amber)"'}>${has ? esc(value) : `${label} 지정하기`}</span>`
    + `<span class="d${sub ? ' x' : ''}">${sub ? esc(sub) : label}</span></span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
  r.onclick = onClick;
  return r;
}

/** 사진 한 장에 행사/작가 하나 지정 */
function oneSheet(kind, pid, after) {
  const list = kind === 'event' ? S.cat.events : S.cat.shooters;
  const label = kind === 'event' ? '행사' : '사진사';
  const cur = S.cat.photos[pid]?.[kind];
  openSheet(`<h3>${label} 지정</h3><p class="lead">이 사진 한 장에 적용돼요.</p><div class="opts" id="os">`
    + list.map(x => `<button class="opt${cur === x.id ? ' on' : ''}" data-id="${x.id}"><span class="l">${esc(x.name)}</span><span class="n">${kind === 'event' ? esc(sug.fmtDate(x.date)) : x.x ? '@' + esc(x.x) : ''}</span><span class="c">${ic('check', 18, 2.8)}</span></button>`).join('')
    + `</div><button class="btn sub" id="os-new" style="width:100%">${ic('plus', 17, 2.2)}새 ${label} 만들기</button>`
    + (kind === 'shooter' ? `<button class="btn sub" id="os-unknown" style="width:100%;margin-top:8px">${ic('info', 17, 2)}사진사 미상으로 표시</button>` : '')
    + (cur ? `<button class="btn sub" id="os-clear" style="width:100%;margin-top:8px">지정 해제</button>` : ''));
  const set = id => { S.cat.photos[pid][kind] = id; touch(); closeSheet(); after?.(); renderAll(); };
  $('#os').onclick = e => { const b = e.target.closest('[data-id]'); if (b) set(b.dataset.id); };
  $('#os-new').onclick = () => newEntitySheet(kind, id => set(id));
  $('#os-unknown')?.addEventListener('click', () => set(unknownShooter().id));
  $('#os-clear')?.addEventListener('click', () => set(null));
}

/** 사진 한 장에 인물 여러 명 */
function manySheet(kind, pid, after) {
  const p = S.cat.photos[pid];
  const list = S.cat.people;
  openSheet(`<h3>퍼슈트 지정</h3><p class="lead">이 사진에 함께 찍힌 퍼슈트를 고르세요. 여러 명 가능합니다.</p><div class="opts" id="ms"></div>`
    + `<button class="btn sub" id="ms-new" style="width:100%">${ic('plus', 17, 2.2)}새 퍼슈트 만들기</button>`);
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
    if (!list.length) box.innerHTML = `<div class="note">${ic('info', 17)}<span>아직 퍼슈트가 없어요. 아래에서 만들어 주세요.</span></div>`;
  };
  paint();
  $('#ms-new').onclick = () => newEntitySheet('person', id => {
    p.people = [...(p.people || []), id];
    touch(); after?.();
    manySheet(kind, pid, after);
  });
}

const chLabel = url => ({ instagram: 'IG', x: 'X', blog: '블로그', linkedin: 'in', threads: '@' }[channelOf(url)] || '기타');

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
  const s = openSheet(`<h3>사용하기</h3><p class="lead">복사해서 SNS에 올린 뒤, 링크를 기록해요.</p>`
    + `<div class="cpcard" id="c1"><div class="cphead"><span class="num">${ic('check', 13, 3)}</span>`
    + `<span class="lb">사진과 텍스트</span>`
    + `<span class="sm">${p.w ? `${fmt(p.w)} × ${fmt(p.h)}` : ''}</span></div>`
    + `<div class="cpimg"><img class="sk" style="aspect-ratio:3/2" alt=""></div>`
    + `<pre class="pv">${esc(txt)}</pre></div>`
    + `<button class="btn" id="c-copy" style="margin-top:12px">${ic('copy', 18, 2.2)}사진 + 텍스트 복사</button>`
    + `<div class="splitrow"><button id="c1b">사진만</button><button id="c2b">텍스트만</button></div>`
    + `<button class="optlink" id="c-opt">복사 텍스트 옵션 편집${ic('chev', 15, 2.2)}</button>`
    + `<button class="btn sub" id="c-next" style="width:100%">올렸어요 · 링크 기록하기</button>`);

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
    if (!blob) { toast('사진을 아직 받는 중이에요'); return; }
    const r = await writeBoth(blob, txt);
    $('#c1').classList.add('done');
    toast(r === 'both' ? '사진과 텍스트를 함께 복사했어요'
      : r === 'image' ? '사진만 복사됐어요 · 텍스트는 아래 버튼으로'
        : '이 브라우저에서는 복사가 막혀 있어요');
  };
  $('#c1b').onclick = async () => {
    if (!blob) { toast('사진을 아직 받는 중이에요'); return; }
    const r = await writeBoth(blob, '');
    toast(r === 'none' ? '사진 복사가 막혀 있어요' : '사진을 복사했어요');
  };
  $('#c2b').onclick = async () => {
    if (!txt) { toast('복사할 텍스트가 없어요'); return; }
    toast((await writeText(txt)) ? '텍스트를 복사했어요' : '복사가 막혀 있어요');
  };
  $('#c-opt').onclick = () => { closeSheet(); openCopyOptions(); };
  $('#c-next').onclick = () => usageSheet([id], after);
}

export function usageSheet(ids, after) {
  const today = new Date().toISOString().slice(0, 10);
  openSheet(`<h3>게시물 기록</h3><p class="lead">${ids.length > 1 ? `${fmt(ids.length)}장을 같은 게시물에 쓴 것으로 기록해요.` : '이 사진을 올린 게시물을 기록해요.'}</p>`
    + `<div class="fld"><label for="u-url">게시물 링크</label>`
    + `<input id="u-url" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://www.instagram.com/p/...">`
    + `<div class="detect" id="u-det">링크를 붙여넣으면 채널을 자동으로 알아봐요.</div></div>`
    + `<div class="fld"><label for="u-date">게시일</label><input id="u-date" type="date" value="${today}"></div>`
    + `<button class="btn" id="u-save">기록 저장</button>`);

  const inp = $('#u-url'), det = $('#u-det');
  inp.addEventListener('input', () => {
    const v = inp.value.trim(), k = channelOf(v);
    det.innerHTML = !v ? '링크를 붙여넣으면 채널을 자동으로 알아봐요.'
      : k ? `<span class="ch ${k}" style="width:26px;height:26px;border-radius:8px;font-size:10px">${chLabel(v)}</span><span style="color:var(--green);font-weight:700">${CHNAME[k]}으로 확인했어요</span>`
        : `${ic('info', 15)}<span>처음 보는 도메인이에요. 기타로 저장됩니다.</span>`;
  });
  $('#u-save').onclick = () => {
    const url = inp.value.trim().replace(/^https?:\/\//, '');
    if (!url) { inp.focus(); det.innerHTML = `${ic('info', 15)}<span style="color:var(--blue);font-weight:700">링크를 입력해 주세요.</span>`; return; }
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
    toast(`사용 이력을 저장했어요 · ${fmt(ids.length)}장${unplanned ? ' · 예정에서 뺐어요' : ''}`);
    after?.();
    renderAll();
  };
  setTimeout(() => inp.focus(), 340);
}

const CHNAME = { instagram: '인스타그램', x: 'X', blog: '네이버 블로그', linkedin: '링크드인', threads: '스레드' };

/* ============================ 태그 탭 ============================ */

/* 태그 목록은 탭을 잡아먹지 않도록 설정 안의 푸시 화면으로 둔다. */
export function openTagBrowse() {
  push('태그로 찾기', sc => paintTags(sc));
}

function paintTags(b) {
  b.innerHTML = '';
  const all = photos();
  const head = el('div', 'gtitle');
  head.innerHTML = '<h2>태그로 찾기</h2><div class="m">항목을 누르면 사진 탭에서 그 조건으로 걸러 보여줍니다</div>';
  b.appendChild(head);

  const mk = (label, items, kind) => {
    const s = el('div', 'sec');
    s.appendChild(el('div', 'sec-lb', `<h2>${label}</h2><span class="n">${items.length}</span>`));
    if (!items.length) {
      s.appendChild(el('div', 'note', `${ic('info', 17)}<span>아직 없어요.</span>`));
    } else {
      const box = el('div', 'card stagger');
      items.forEach(it => {
        const r = el('button', 'row');
        r.innerHTML = (it.av !== undefined ? avatarHTML(it.l, it.av) : `<span class="row-ico">${ic(kind === 'event' ? 'cal' : 'tag', 18)}</span>`)
          + `<span class="grow"><span class="t">${esc(it.l)}</span>${it.d ? `<span class="d${it.x ? ' x' : ''}">${esc(it.d)}</span>` : ''}</span>`
          + `<span class="n-sm">${fmt(it.n)}장</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
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

  mk('행사', S.cat.events.map(e => ({ v: e.id, l: e.name, d: sug.fmtDate(e.date), n: all.filter(p => p.event === e.id).length })), 'event');
  mk('사진사', S.cat.shooters.map(s => ({ v: s.id, l: s.name, d: s.x ? '@' + s.x : 'X 아이디 없음', x: !!s.x, av: s.avatar, n: all.filter(p => p.shooter === s.id).length })), 'shooter');
  mk('같이 찍은 퍼슈트', S.cat.people.map(s => ({ v: s.id, l: s.name, d: s.role || (s.x ? '@' + s.x : ''), av: s.avatar, n: all.filter(p => (p.people || []).includes(s.id)).length })).sort((a, c) => c.n - a.n), 'person');
  mk('자유 태그', S.cat.tags.map(t => ({ v: t, l: t, n: all.filter(p => (p.tags || []).includes(t)).length })).sort((a, c) => c.n - a.n), 'tag');

  const n = el('div', 'sec');
  n.style.marginTop = '20px';
  n.appendChild(el('div', 'note', `${ic('info', 17)}<span>행사·사진사·퍼슈트는 고정 축이라 오타로 갈라지지 않습니다. 자유 태그는 <b>태그 관리</b>에서만 만듭니다.</span>`));
  b.appendChild(n);
}

/* ============================ 설정 ============================ */

export function renderSettings() {
  const b = $('#set-body');
  if (!b) return;
  keepScroll(b, () => paintSettings(b));
}

function paintSettings(b) {
  b.innerHTML = '';
  const all = photos();

  /* 내 프로필 */
  const me = S.cat.me || {};
  const mp = el('div', 'sec');
  const mlb = el('div', 'sec-lb', '<h2>내 프로필</h2>');
  mlb.style.marginTop = '4px';
  mp.appendChild(mlb);
  const mbox = el('div', 'card');
  if (me.nick || me.x) {
    const r = el('button', 'row');
    r.innerHTML = avatarHTML(me.nick || me.x || '?', me.avatar)
      + `<span class="grow"><span class="t">${esc(me.nick || me.x)}</span>`
      + `<span class="d${me.x ? ' x' : ''}">${me.x ? '@' + esc(me.x) : 'X 아이디 없음'}</span></span>`;
    if (me.x) {
      const go = el('span', 'copy', `${ic('ext', 15, 2)}X`);
      r.appendChild(go);
      r.onclick = () => openX(me.x);
      r.setAttribute('aria-label', `X 에서 @${me.x} 열기`);
    } else {
      r.appendChild(el('span', 'chev', ic('chev', 18, 2.1)));
      r.onclick = () => meSheet();
    }
    mbox.appendChild(r);
    const ed = el('button', 'row', `<span class="row-ico">${ic('user', 18)}</span>`
      + `<span class="grow"><span class="t">프로필 편집</span><span class="d">닉네임 · X 아이디 · 프로필 사진</span></span>`
      + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
    ed.onclick = () => meSheet();
    mbox.appendChild(ed);
  } else {
    const r = el('button', 'row', `<span class="row-ico" style="background:var(--blue-fill);color:var(--blue)">${ic('user', 18)}</span>`
      + `<span class="grow"><span class="t" style="color:var(--blue)">내 프로필 설정하기</span></span>`
      + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
    r.onclick = () => meSheet();
    mbox.appendChild(r);
  }
  mp.appendChild(mbox);
  b.appendChild(mp);

  /* 표시 */
  const dp = el('div', 'sec');
  dp.appendChild(el('div', 'sec-lb', '<h2>표시</h2>'));
  const dbox = el('div', 'card');

  const accent = ACCENTS.find(a => a.k === (S.cat.opts.accent || 'blue')) || ACCENTS[0];
  const themeRow = el('button', 'row',
    `<span class="row-ico" style="background:var(--blue);color:var(--on-blue)">${ic('spark', 18, 2.1)}</span>`
    + `<span class="grow"><span class="t">테마 색</span><span class="d">앱 전체 강조색</span></span>`
    + `<span class="n-sm">${esc(accent.name)}</span><span class="chev">${ic('chev', 18, 2.1)}</span>`);
  themeRow.onclick = accentSheet;
  dbox.appendChild(themeRow);

  dbox.appendChild(navRow('홈 화면 이름',
    `${S.cat.opts.homeTitle || '모아보기'} · 탭 ${S.cat.opts.homeTab || S.cat.opts.homeTitle || '모아보기'}`,
    'cal', homeTitleSheet));

  const friRow = el('div', 'row',
    `<span class="row-ico">${ic('check', 18, 2.2)}</span>`
    + `<span class="grow"><span class="t">금요일 알림 블록</span>`
    + `<span class="d">${isFriday() ? '오늘이 금요일이라 홈에 떠 있어요' : '금요일에 홈 맨 위에 표시'}</span></span>`);
  const friSw = el('button', 'sw' + (S.cat.opts.friday !== false ? ' on' : ''), '<i></i>');
  friSw.setAttribute('aria-pressed', String(S.cat.opts.friday !== false));
  friSw.onclick = () => {
    // 제자리에서 뒤집는다 — 설정 화면을 다시 그리면 애니메이션이 날아간다
    const on = flipSwitch(friSw, S.cat.opts.friday === false);
    S.cat.opts.friday = on;
    const d = friRow.querySelector('.d');
    if (d) d.textContent = on
      ? (isFriday() ? '오늘이 금요일이라 홈에 떠 있어요' : '금요일에 홈 맨 위에 표시')
      : '표시하지 않아요';
    touch();
    renderHome();          // 영향받는 화면만
  };
  friRow.appendChild(friSw);
  dbox.appendChild(friRow);


  dp.appendChild(dbox);
  b.appendChild(dp);

  /* 폴더 */
  const f = el('div', 'sec');
  const lb = el('div', 'sec-lb', `<h2>연결된 드라이브 폴더</h2><span class="n">${S.cat.folders.length}</span>`);
  f.appendChild(lb);
  const fb = el('div', 'card');
  S.cat.folders.forEach(fo => {
    const r = el('div', 'row');
    r.innerHTML = `<span class="row-ico">${ic('folder', 18)}</span>`
      + `<span class="grow"><span class="t">${esc(fo.name)}</span><span class="d">${fmt(all.filter(p => true).length && fo.count != null ? fo.count : 0)}개 · ${S.cat.syncedAt ? sug.fmtDate(S.cat.syncedAt.slice(0, 10)) + ' 동기화' : '아직 동기화 안 됨'}</span></span>`;
    const x = el('button', 'copy', ic('x', 15, 2.4));
    x.onclick = () => confirmSheet({
      title: '폴더 연결을 끊을까요?', danger: true, ok: '연결 끊기',
      lead: '이 폴더의 사진이 목록에서 빠집니다. <b>태그와 사용 이력은 지우지 않습니다</b> — 폴더를 다시 연결하면 그대로 돌아옵니다.',
      onOk: () => { S.cat.folders = S.cat.folders.filter(z => z.id !== fo.id); touch(); renderSettings(); toast('연결을 끊었어요. 동기화하면 반영됩니다'); },
    });
    r.appendChild(x);
    fb.appendChild(r);
  });
  const add = el('button', 'row', `<span class="row-ico" style="background:var(--blue-fill);color:var(--blue)">${ic('plus', 18, 2.2)}</span>`
    + `<span class="grow"><span class="t" style="color:var(--blue)">폴더 추가</span><span class="d">구글 피커에서 고르기</span></span>`);
  add.onclick = () => V.onPickFolders?.();
  fb.appendChild(add);
  f.appendChild(fb);
  b.appendChild(f);

  /* 동기화 */
  const sy = el('div', 'sec');
  sy.appendChild(el('div', 'sec-lb', '<h2>동기화</h2>'));
  const syb = el('div', 'card');
  const goneN = Object.keys(S.cat.gone).length;
  syb.innerHTML = `<div class="row"><span class="row-ico">${ic('cloud', 18)}</span>`
    + `<span class="grow"><span class="t">catalog.json</span><span class="d">${S.cat.syncedAt ? new Date(S.cat.syncedAt).toLocaleString('ko-KR') : '아직 없음'}</span></span>`
    + `<span class="n-sm">${S.dirty ? '저장 대기' : S.lastSaveAt ? '저장됨' : ''}</span></div>`
    + (goneN ? `<div class="row"><span class="row-ico" style="background:var(--amber-fill);color:var(--amber)">${ic('info', 18)}</span>`
      + `<span class="grow"><span class="t">사라진 사진 ${fmt(goneN)}장</span><span class="d">드라이브에서 없어졌지만 기록은 보존했어요</span></span></div>` : '');
  const re = el('button', 'row', `<span class="row-ico">${ic('refresh', 18)}</span>`
    + `<span class="grow"><span class="t">지금 동기화</span><span class="d">새 파일과 사라진 파일을 확인해요</span></span>`);
  re.onclick = () => V.onSync?.();
  syb.appendChild(re);

  /* 썸네일 캐시 — 기기에 남겨서 앱을 다시 열 때 그리드가 바로 채워진다 */
  const cacheRow = el('button', 'row', `<span class="row-ico">${ic('grid', 18)}</span>`
    + `<span class="grow"><span class="t">썸네일 캐시</span><span class="d">세는 중…</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
  th.cacheInfo().then(info => {
    const d = cacheRow.querySelector('.d');
    if (d) d.textContent = info.entries
      ? `${fmt(info.entries)}장이 기기에 저장됨 · 다시 열 때 바로 뜹니다`
      : '아직 없음 · 한 번 보면 저장됩니다';
  });
  cacheRow.onclick = () => confirmSheet({
    title: '썸네일 캐시를 지울까요?', ok: '캐시 지우기', danger: true,
    lead: '사진과 기록은 그대로입니다. 다시 볼 때 드라이브에서 새로 받아오므로 <b>처음엔 느려집니다.</b>',
    onOk: async () => { await th.clearCache(); toast('캐시를 지웠어요'); renderSettings(); },
  });
  syb.appendChild(cacheRow);

  /* 미리 받기 — 그리드를 끝까지 스크롤해서 채우는 것과 결과는 같지만,
     화면에 띄우지 않으니 메모리가 안 늘고 중간에 튕기지 않는다. */
  const preRow = el('button', 'row', `<span class="row-ico">${ic('cloud', 18)}</span>`
    + `<span class="grow"><span class="t">썸네일 미리 받기</span>`
    + `<span class="d">동기화 때 자동으로 해요 · 중단했다면 여기서 이어받기</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.1)}</span>`);
  preRow.onclick = () => V.onPrefetch?.();
  syb.appendChild(preRow);

  if (S.demo) {
    const dr = el('button', 'row', `<span class="row-ico" style="background:var(--amber-fill);color:var(--amber)">${ic('refresh', 18)}</span>`
      + `<span class="grow"><span class="t" style="color:var(--amber)">데모 데이터 초기화</span>`
      + `<span class="d">만든 일정·분류를 지우고 처음 상태로</span></span>`);
    dr.onclick = () => confirmSheet({
      title: '데모를 처음 상태로?', ok: '초기화', danger: true,
      lead: '데모에서 만든 일정·분류·카테고리가 모두 사라집니다. 실제 드라이브 데이터와는 무관합니다.',
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
  pe.appendChild(el('div', 'sec-lb', '<h2>사람과 퍼슈트</h2>'));
  const peb = el('div', 'card');
  const noX = [...S.cat.shooters, ...S.cat.people].filter(x => !x.x).length;
  peb.appendChild(navRow('사진사', `${S.cat.shooters.length}명 · 크레딧에 쓰는 X 아이디`, 'cam', () => openEntityList('shooter')));
  peb.appendChild(navRow('같이 찍은 퍼슈트', `${S.cat.people.length}명`, 'user', () => openEntityList('person')));
  if (noX) peb.appendChild(navRow('아바타 한번에 채우기', `X 아이디가 없는 ${noX}명`, 'spark', openBulkAvatar, true));
  pe.appendChild(peb);
  b.appendChild(pe);

  /* 태그 · 복사 */
  const sd = el('div', 'sec');
  sd.appendChild(el('div', 'sec-lb', '<h2>일정</h2>'));
  const sdb = el('div', 'card');
  sdb.appendChild(navRow('짐 챙기기 목록', `${S.cat.packing.length}개 · 모든 행사가 함께 쓰는 공용 목록`, 'check', openPacking));
  sdb.appendChild(navRow('행사 카테고리', `${S.cat.eventTags.length}개 · 색으로 구분 · 사진 태그와 별개`, 'cal', openEventTagManage));
  sd.appendChild(sdb);
  b.appendChild(sd);

  const tg = el('div', 'sec');
  tg.appendChild(el('div', 'sec-lb', '<h2>태그와 복사</h2>'));
  const tgb = el('div', 'card');
  tgb.appendChild(navRow('태그로 찾기', '행사 · 사진사 · 퍼슈트 · 자유 태그로 사진 찾기', 'grid', openTagBrowse));
  tgb.appendChild(navRow('태그 관리', `${S.cat.tags.length}개 · 새 태그는 여기서만 만듭니다`, 'tag', openTagManage));
  tgb.appendChild(navRow('복사 템플릿', `해시태그 ${S.cat.opts.tags.length + (S.cat.opts.eventTag ? 1 : 0)}개 · 작가 아이디 ${S.cat.opts.prefix}`, 'copy', openCopyOptions));
  tg.appendChild(tgb);
  b.appendChild(tg);

  /* 키 · 권한 */
  const kb = el('div', 'sec');
  kb.appendChild(el('div', 'sec-lb', '<h2>계정과 키</h2>'));
  const kbb = el('div', 'card');
  kbb.appendChild(navRow('unavatar 키', av.keys.pub ? '퍼블리셔블 저장됨' : '없음 · 없어도 동작합니다', 'key', openAvatarKeys));
  // innerHTML += 를 쓰면 위에서 붙인 버튼의 리스너가 날아간다. 반드시 appendChild.
  kbb.appendChild(el('div', 'row', `<span class="row-ico">${ic('key', 18)}</span>`
    + `<span class="grow"><span class="t">drive.file</span><span class="d">앱이 지정한 폴더만 · 구글 검증 불필요</span></span>`));
  const out = el('button', 'row', `<span class="row-ico" style="background:var(--red-fill);color:var(--red)">${ic('ext', 18)}</span>`
    + `<span class="grow"><span class="t" style="color:var(--red)">로그아웃</span><span class="d">이 기기에서 토큰을 지웁니다</span></span>`);
  out.onclick = () => V.onLogout?.();
  kbb.appendChild(out);
  kb.appendChild(kbb);
  b.appendChild(kb);

  const note = el('div', 'sec');
  note.style.marginTop = '20px';
  note.appendChild(el('div', 'note', `${ic('info', 17)}<span>사진 파일은 <b>읽기만</b> 합니다. 이 앱이 쓰는 건 catalog.json 한 파일뿐이라 원본이 상할 일이 없습니다.</span>`));
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
  const label = kind === 'shooter' ? '사진사' : '같이 찍은 퍼슈트';
  push(label, sc => paintEntityList(sc, kind, label));
}

function paintEntityList(sc, kind, label) {
  sc.innerHTML = '';
  const list = kind === 'shooter' ? S.cat.shooters : S.cat.people;
  const all = photos();
  const t = el('div', 'gtitle');
  t.innerHTML = `<h2>${label}</h2><div class="m">${kind === 'shooter' ? 'X 아이디는 게시물 크레딧에 씁니다' : 'X 아이디를 넣으면 프로필 사진을 불러옵니다'}</div>`;
  sc.appendChild(t);

  const s = el('div', 'sec');
  s.style.marginTop = '18px';
  const box = el('div', 'card stagger');
  list.forEach(x => {
    const n = kind === 'shooter' ? all.filter(p => p.shooter === x.id).length : all.filter(p => (p.people || []).includes(x.id)).length;
    const r = el('button', 'row');
    r.innerHTML = avatarHTML(x.name, x.avatar)
      + `<span class="grow"><span class="t">${esc(x.name)}</span><span class="d${x.x ? ' x' : ''}">${x.x ? '@' + esc(x.x) : 'X 아이디 입력하기'}</span></span>`
      + `<span class="n-sm">${fmt(n)}장</span><span class="chev">${ic('chev', 18, 2.1)}</span>`;
    r.onclick = () => entitySheet(kind, x, () => { paintEntityList(sc, kind, label); renderAll(); });
    box.appendChild(r);
  });
  if (!list.length) box.innerHTML = `<div class="note">${ic('info', 17)}<span>사진을 선택해서 지정하면 여기 목록이 생깁니다.</span></div>`;
  s.appendChild(box);
  const nb = el('button', 'btn sub', `${ic('plus', 17, 2.2)}새로 만들기`);
  nb.style.cssText = 'width:100%;margin-top:12px';
  nb.onclick = () => newEntitySheet(kind, () => { paintEntityList(sc, kind, label); renderAll(); });
  s.appendChild(nb);
  sc.appendChild(s);
}

/* ---------- 내 프로필 ---------- */

function meSheet() {
  const me = S.cat.me || (S.cat.me = { nick: '', x: null, avatar: null });
  openSheet(`<h3>내 프로필</h3><p class="lead">X 아이디를 넣으면 프로필 사진을 불러옵니다.</p>`
    + `<div class="fld"><label for="me-nick">닉네임</label>`
    + `<input id="me-nick" maxlength="40" value="${esc(me.nick || '')}" placeholder="예: 네오굴"></div>`
    + `<div class="fld"><label for="me-x">X 아이디</label>`
    + `<input id="me-x" maxlength="60" autocapitalize="off" autocorrect="off" spellcheck="false" value="${me.x ? '@' + esc(me.x) : ''}" placeholder="@handle 또는 x.com/handle">`
    + `<div class="detect" id="me-det">${me.avatar ? `<span class="av" style="width:30px;height:30px"><img alt="" src="${me.avatar}"></span><span>저장된 프로필 사진</span>` : ''}</div></div>`
    + `<button class="btn" id="me-save">저장</button>`
    + (me.x ? `<button class="btn sub" id="me-open" style="width:100%;margin-top:8px">${ic('ext', 17, 2)}X 에서 열기</button>` : ''));

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
      btn.textContent = '프로필 사진 확인 중…';
      avatar = await xf.settle();
      if (!avatar && h === me.x) avatar = me.avatar || null;
    }
    me.nick = nick;
    me.x = h;
    me.avatar = avatar;
    touch();
    closeSheet();
    toast('프로필을 저장했어요');
    renderSettings();
  };
  setTimeout(() => $('#me-nick').focus(), 340);
}

/* ---------- 테마 색 ---------- */

function accentSheet() {
  const cur = S.cat.opts.accent || 'blue';
  openSheet(`<h3>테마 색</h3><p class="lead">버튼·강조·디데이에 쓰이는 색 하나만 고릅니다.</p>`
    + `<div class="acc-grid" id="ac">`
    + ACCENTS.map(a => `<button class="acc a-${a.k}${a.k === cur ? ' on' : ''}" data-k="${a.k}">`
      + `<span class="dot">${ic('check', 16, 3)}</span><span class="nm">${esc(a.name)}</span></button>`).join('')
    + `</div>`);
  $('#ac').onclick = e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    S.cat.opts.accent = b.dataset.k;
    applyAccent(b.dataset.k);
    touch();
    $('#ac').querySelectorAll('.acc').forEach(x => x.classList.toggle('on', x.dataset.k === b.dataset.k));
    renderAll();
  };
}

/* ---------- 홈 화면 이름 ---------- */

function homeTitleSheet() {
  const o = S.cat.opts;
  openSheet(`<h3>홈 화면 이름</h3><p class="lead">첫 화면 제목과 아래 탭 이름을 따로 정할 수 있어요.</p>`
    + `<div class="fld"><label for="ht">제목</label>`
    + `<input id="ht" maxlength="40" value="${esc(o.homeTitle || '')}" placeholder="모아보기">`
    + `<div class="hint">첫 화면 맨 위에 크게 나옵니다. 길어도 괜찮아요.</div></div>`
    + `<div class="fld"><label for="htab">탭 이름</label>`
    + `<input id="htab" maxlength="12" value="${esc(o.homeTab || '')}" placeholder="${esc(o.homeTitle || '모아보기')}">`
    + `<div class="hint">아래 탭은 네 칸으로 나뉘어 좁습니다. <b>여섯 자 안쪽</b>이면 잘리지 않아요. 비워두면 제목을 그대로 씁니다.</div></div>`
    + `<button class="btn" id="ht-save">저장</button>`);
  const i = $('#ht');
  $('#ht-save').onclick = () => {
    o.homeTitle = i.value.trim() || '모아보기';
    o.homeTab = $('#htab').value.trim();
    touch();
    closeSheet();
    toast(`홈 이름을 "${o.homeTitle}" 로 바꿨어요`);
    renderAll();
  };
  setTimeout(() => { i.focus(); i.select(); }, 340);
}

export function entitySheet(kind, ent, after) {
  const isSh = kind === 'shooter';
  openSheet(`<h3>${esc(ent.name)}</h3><p class="lead">${isSh ? '크레딧에 쓸 X 아이디를 적어주세요.' : '역할과 X 아이디를 적을 수 있어요.'}</p>`
    + `<div class="fld"><label for="es-name">이름</label><input id="es-name" maxlength="60" value="${esc(ent.name)}"></div>`
    + (isSh ? '' : `<div class="fld"><label for="es-role">역할</label><input id="es-role" maxlength="30" value="${esc(ent.role || '')}" placeholder="예: PR 매니저"></div>`)
    + `<div class="fld"><label for="es-x">X 아이디</label><input id="es-x" maxlength="60" autocapitalize="off" autocorrect="off" value="${ent.x ? '@' + esc(ent.x) : ''}" placeholder="@handle 또는 x.com/handle">`
    + `<div class="detect" id="es-det">${ent.avatar ? `<span class="av" style="width:30px;height:30px"><img alt="" src="${ent.avatar}"></span><span>저장된 프로필 사진</span>` : ''}</div></div>`
    + `<button class="btn" id="es-save">저장</button>`
    + (ent.x ? `<button class="btn sub" id="es-open" style="width:100%;margin-top:8px">${ic('ext', 17, 2)}X 에서 @${esc(ent.x)} 열기</button>` : '')
    + (ent.avatar ? `<button class="btn sub" id="es-refresh" style="width:100%;margin-top:8px">${ic('refresh', 17, 2)}아바타 새로 받기</button>` : ''));

  const xf = wireXField($('#es-x'), $('#es-det'));
  $('#es-open')?.addEventListener('click', () => openX(ent.x));
  $('#es-refresh')?.addEventListener('click', async () => {
    if (!normX($('#es-x').value)) { toast('X 아이디를 먼저 넣어주세요'); return; }
    const d = await xf.refresh();
    if (!d) toast('프로필 사진을 다시 받지 못했어요');
  });
  $('#es-save').onclick = async () => {
    const nm = $('#es-name').value.trim();
    if (!nm) { $('#es-name').focus(); return; }
    const btn = $('#es-save');
    btn.disabled = true;
    const h = normX($('#es-x').value);
    /* 사진이 도는 중이면 기다린다 — 이걸 안 기다려서 아바타가 사라지고 있었다. */
    let avatar = null;
    if (h) {
      btn.textContent = '프로필 사진 확인 중…';
      avatar = await xf.settle();
      // 핬들이 그대로고 새로 받기가 실패했다면 있던 사진을 지우지 않는다
      if (!avatar && h === ent.x) avatar = ent.avatar || null;
    }
    ent.name = nm;
    if (!isSh) ent.role = ($('#es-role').value.trim() || null);
    ent.x = h;
    ent.avatar = avatar;
    touch();
    closeSheet();
    toast('저장했어요');
    after?.();
  };
}

/* ---------- 아바타 한번에 채우기 ---------- */

function openBulkAvatar() { push('아바타 한번에 채우기', sc => paintBulkAvatar(sc)); }

function paintBulkAvatar(sc) {
  sc.innerHTML = '';
  const targets = [
    ...S.cat.shooters.filter(x => !x.x).map(x => ({ x, kind: 'shooter' })),
    ...S.cat.people.filter(x => !x.x).map(x => ({ x, kind: 'person' })),
  ];
  const t = el('div', 'gtitle');
  t.innerHTML = `<h2>아직 아이디가 없는 ${targets.length}명</h2><div class="m">위에서 아래로 채우고 한 번에 저장하세요. X 아이디가 있어야 프로필 사진을 불러옵니다.</div>`;
  sc.appendChild(t);

  if (!targets.length) {
    const s = el('div', 'sec');
    s.style.marginTop = '18px';
    s.appendChild(el('div', 'note', `${ic('check', 17, 2.6)}<span>모두 채워졌어요.</span>`));
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
    inp.placeholder = 'x 아이디';
    inp.maxLength = 60;
    inp.autocapitalize = 'off';
    inp.autocorrect = 'off';
    inp.style.cssText = 'flex:0 0 128px;height:40px;padding:0 12px;border-radius:11px;border:0;background:var(--fill);font:inherit;font-size:14px;font-weight:600';
    inp.dataset.id = x.id;
    r.appendChild(inp);
    box.appendChild(r);
  });
  s.appendChild(box);
  sc.appendChild(s);

  const bar = el('div', 'sec');
  bar.style.marginTop = '14px';
  const btn = el('button', 'btn', `${targets.length}명 저장하고 아바타 받기`);
  btn.onclick = async () => {
    const rows = [...box.querySelectorAll('input')].map(i => ({ id: i.dataset.id, h: normX(i.value) })).filter(r => r.h);
    if (!rows.length) { toast('입력된 아이디가 없어요'); return; }
    btn.disabled = true;
    let ok = 0;
    for (const { id, h } of rows) {
      const ent = S.cat.shooters.find(z => z.id === id) || S.cat.people.find(z => z.id === id);
      if (!ent) continue;
      ent.x = h;
      const r = await av.fetchAvatar(h);
      if (r.ok) { ent.avatar = r.dataUrl; ok++; }
      btn.textContent = `받는 중… ${ok}/${rows.length}`;
    }
    touch();
    toast(`${rows.length}명 저장 · 사진 ${ok}장 받았어요`);
    paintBulkAvatar(sc);
    renderAll();
  };
  bar.appendChild(btn);
  sc.appendChild(bar);
}

/* ---------- 태그 관리 ---------- */

export function openTagManage() { push('태그 관리', sc => paintTagManage(sc)); }

function paintTagManage(sc) {
  sc.innerHTML = '';
  const all = photos();
  const t = el('div', 'gtitle');
  t.innerHTML = `<h2>태그 관리</h2><div class="m">새 태그는 여기서만 만듭니다. 사진에 달 때는 이 목록에서 고르기만 해서, 오타로 태그가 갈라지지 않습니다.</div>`;
  sc.appendChild(t);

  const s = el('div', 'sec');
  s.style.marginTop = '18px';
  const ar = el('div', 'addrow');
  ar.innerHTML = `<input id="tm-in" placeholder="새 태그" maxlength="20"><button id="tm-add">만들기</button>`;
  s.appendChild(ar);
  const wrap = el('div', 'tagwrap');
  wrap.style.marginTop = '14px';
  S.cat.tags.forEach(tag => {
    const n = all.filter(p => (p.tags || []).includes(tag)).length;
    const c = el('button', 'tg', `${esc(tag)} <span class="k">${n}</span><span class="x">${ic('x', 13, 2.6)}</span>`);
    c.onclick = () => confirmSheet({
      title: `"${tag}" 태그를 지울까요?`, danger: true, ok: '태그 삭제',
      lead: n ? `이 태그가 붙은 <b>${fmt(n)}장</b>에서도 함께 빠집니다.` : '이 태그가 붙은 사진은 없습니다.',
      onOk: () => {
        S.cat.tags = S.cat.tags.filter(x => x !== tag);
        Object.values(S.cat.photos).forEach(p => { if (p.tags) p.tags = p.tags.filter(x => x !== tag); });
        touch(); paintTagManage(sc); renderAll(); toast('태그를 지웠어요');
      },
    });
    wrap.appendChild(c);
  });
  if (!S.cat.tags.length) wrap.appendChild(el('span', 'tg add', '태그가 없어요'));
  s.appendChild(wrap);
  sc.appendChild(s);

  const addTag = () => {
    const v = ar.querySelector('#tm-in').value.trim().replace(/^#/, '');
    if (!v) return;
    if (S.cat.tags.includes(v)) { toast('이미 있는 태그예요'); return; }
    S.cat.tags.push(v);
    touch();
    paintTagManage(sc);
    renderAll();
    toast(`"${v}" 태그를 만들었어요`);
  };
  ar.querySelector('#tm-add').onclick = addTag;
  ar.querySelector('#tm-in').addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });
}

/* ---------- 일정 태그 관리 ---------- */

export function openEventTagManage() { push('행사 카테고리', sc => paintEventTagManage(sc)); }

function paintEventTagManage(sc) {
  keepScroll(sc, () => {
    sc.innerHTML = '';
    const t = el('div', 'gtitle');
    t.innerHTML = '<h2>행사 카테고리</h2><div class="m">일정에만 붙습니다. 색으로 구분되고 사진 태그와 섞이지 않습니다.</div>';
    sc.appendChild(t);

    const s = el('div', 'sec');
    s.style.marginTop = '18px';
    const box = el('div', 'card');
    S.cat.eventTags.forEach(tag => {
      const used = S.cat.events.filter(e => (e.tags || []).includes(tag.name)).length;
      const r = el('button', 'row');
      r.innerHTML = `<span class="cat c-${tag.color}" style="pointer-events:none">${esc(tag.name)}</span>`
        + `<span class="grow"></span><span class="n-sm">일정 ${used}건</span>`
        + `<span class="chev">${ic('chev', 18, 2.1)}</span>`;
      r.onclick = () => catSheet(tag, () => paintEventTagManage(sc));
      box.appendChild(r);
    });
    if (!S.cat.eventTags.length) {
      box.appendChild(el('div', 'row', '<span class="grow"><span class="t" style="color:var(--g500)">아직 없어요</span><span class="d">아래에서 만들어 주세요</span></span>'));
    }
    s.appendChild(box);
    const nb = el('button', 'btn sub', `${ic('plus', 17, 2.2)}카테고리 만들기`);
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
    openSheet(`<h3>${isNew ? '카테고리 만들기' : '카테고리 편집'}</h3>`
      + `<p class="lead">정모 · 컨벤션 · 촬영회처럼 행사 종류를 묶습니다.</p>`
      + `<div class="fld"><label for="ct-name">이름</label>`
      + `<input id="ct-name" maxlength="16" value="${esc(tag ? tag.name : '')}" placeholder="예: 정모"></div>`
      + `<div class="fld"><label>색</label><div class="swatches" id="ct-sw">`
      + CAT_COLORS.map(c => `<button class="sw-dot c-${c}${c === color ? ' on' : ''}" data-c="${c}" aria-label="${c}">${ic('check', 16, 3)}</button>`).join('')
      + `</div></div>`
      + `<div class="fld"><label>미리보기</label><div><span class="cat c-${color}" id="ct-pv">${esc(tag ? tag.name : '카테고리')}</span></div></div>`
      + `<button class="btn" id="ct-save">${isNew ? '만들기' : '저장'}</button>`
      + (isNew ? '' : `<button class="btn danger" id="ct-del" style="margin-top:8px">삭제</button>`));

    const nm = $('#ct-name');
    const pv = $('#ct-pv');
    nm.addEventListener('input', () => { pv.textContent = nm.value.trim() || '카테고리'; });
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
      if (S.cat.eventTags.some(x => x.name === name && x !== tag)) { toast('같은 이름이 이미 있어요'); return; }
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
      toast(isNew ? `"${name}" 카테고리를 만들었어요` : '저장했어요');
      if (after) after(name);
      renderAll();
    };
    const del = $('#ct-del');
    if (del) {
      del.onclick = () => confirmSheet({
        title: `"${tag.name}" 을 지울까요?`, danger: true, ok: '삭제',
        lead: used ? `이 카테고리가 붙은 <b>일정 ${used}건</b>에서도 함께 빠집니다.` : '쓰이는 일정이 없습니다.',
        onOk: () => {
          S.cat.eventTags = S.cat.eventTags.filter(x => x !== tag);
          S.cat.events.forEach(e => { if (e.tags) e.tags = e.tags.filter(x => x !== tag.name); });
          touch(); if (after) after(); renderAll(); toast('지웠어요');
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
      : `<span class="evlogo big none">대표사진</span>`;
    openSheet(`<h3>행사 로고</h3>`
      + `<p class="lead">그 행사의 로고 이미지를 넣습니다. 정하지 않으면 목록에서 <b>대표 사진</b>이 나옵니다.</p>`
      + `<div class="logorow">${shown}`
      + `<span class="lg-t"><b>${esc(ev.name)}</b>`
      + `<em>${logo ? '로고를 쓰는 중' : '대표 사진을 쓰는 중'}</em></span></div>`
      + `<button class="btn" id="lg-pick" style="margin-top:18px">${ic('grid', 18, 2.1)}${logo ? '다른 이미지 고르기' : '이미지 고르기'}</button>`
      + (logo ? `<button class="btn sub" id="lg-clear" style="width:100%;margin-top:8px">로고 지우고 대표 사진 쓰기</button>` : '')
      + `<button class="btn sub" id="lg-save" style="width:100%;margin-top:8px">저장</button>`
      + `<div class="fld" style="margin:16px 0 0"><div class="hint">정사각형으로 잘라 128px 로 저장합니다. 로고를 넣어도 <b>디데이는 그대로 보입니다.</b></div></div>`);

    $('#lg-pick').onclick = async () => {
      const file = await pickImage();
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('이미지 파일이 아니에요'); return; }
      try {
        logo = await squareDataURL(file, 128);
        render();
        toast('불러왔어요 · 저장을 눌러 주세요');
      } catch {
        toast('이미지를 처리하지 못했어요');
      }
    };
    const clr = $('#lg-clear');
    if (clr) clr.onclick = () => { logo = null; render(); };
    $('#lg-save').onclick = () => {
      ev.logo = logo || null;
      ev.icon = null;              // 예전 이모지 값은 정리한다
      touch(); closeSheet();
      toast(logo ? '로고를 저장했어요' : '대표 사진을 씁니다');
      if (after) after();
      renderAll();
    };
  };
  render();
}

/* ---------- 복사 템플릿 ---------- */

export function openCopyOptions() { push('복사 템플릿', sc => paintCopyOptions(sc)); }

function paintCopyOptions(sc) {
  sc.innerHTML = '';
  const o = S.cat.opts;
  const t = el('div', 'gtitle');
  t.innerHTML = `<h2>복사 템플릿</h2><div class="m">사용하기에서 복사되는 텍스트를 정합니다</div>`;
  sc.appendChild(t);

  const s1 = el('div', 'sec');
  s1.style.marginTop = '18px';
  const box = el('div', 'card');
  const r1 = el('div', 'row', `<span class="grow"><span class="t">행사명을 해시태그로</span><span class="d">${esc(S.cat.events[0] ? hashtagify(S.cat.events[0].name) : '#행사이름')}</span></span>`);
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
  s2.appendChild(el('div', 'sec-lb', `<h2>기본 해시태그</h2><span class="n">${o.tags.length}</span>`));
  const tw = el('div', 'tagwrap');
  o.tags.forEach((tag, i) => {
    const c = el('button', 'tg', `${esc(tag)}<span class="x">${ic('x', 13, 2.6)}</span>`);
    c.onclick = () => { o.tags.splice(i, 1); touch(); paintCopyOptions(sc); };
    tw.appendChild(c);
  });
  if (!o.tags.length) tw.appendChild(el('span', 'tg add', '없음'));
  s2.appendChild(tw);
  const ar = el('div', 'addrow');
  ar.style.marginTop = '10px';
  ar.innerHTML = `<input id="ot" placeholder="해시태그 추가" maxlength="30"><button id="ota">추가</button>`;
  s2.appendChild(ar);
  sc.appendChild(s2);
  const addTag = () => {
    let v = ar.querySelector('#ot').value.trim().replace(/\s+/g, '');
    if (!v) return;
    if (!v.startsWith('#')) v = '#' + v;
    if (o.tags.includes(v)) { toast('이미 있어요'); return; }
    o.tags.push(v); touch(); paintCopyOptions(sc);
  };
  ar.querySelector('#ota').onclick = addTag;
  ar.querySelector('#ot').addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });

  const s3 = el('div', 'sec');
  s3.appendChild(el('div', 'sec-lb', '<h2>작가 아이디 표기</h2>'));
  s3.appendChild(segment([['#', '해시태그 #'], ['@', '멘션 @']], o.prefix, v => { o.prefix = v; touch(); paintCopyOptions(sc); }));
  s3.querySelector('.segwrap').style.padding = '0';
  sc.appendChild(s3);

  if (o.prefix === '@') {
    const w = el('div', 'sec');
    w.style.marginTop = '12px';
    w.appendChild(el('div', 'note warn', `${ic('info', 17)}<span>작가 아이디는 X 계정입니다. <b>인스타그램 게시물에 @로 멘션하면</b> 그 계정이 인스타에는 없어서 엉뚱한 사람을 가리킬 수 있어요. 해시태그 #가 안전합니다.</span>`));
    sc.appendChild(w);
  }

  const s4 = el('div', 'sec');
  s4.appendChild(el('div', 'sec-lb', '<h2>미리보기</h2>'));
  const sample = photos().find(p => p.shooter && shooterById(p.shooter)?.x) || photos()[0];
  const pv = el('pre', 'pv', esc(sample ? copyTextFor(sample) : o.tags.join(' ')));
  pv.style.background = 'var(--fill-2)';
  s4.appendChild(pv);
  sc.appendChild(s4);
}

/* ---------- unavatar 키 ---------- */

function openAvatarKeys() { push('unavatar 키', sc => paintAvatarKeys(sc)); }

function paintAvatarKeys(sc) {
  sc.innerHTML = '';
  const t = el('div', 'gtitle');
  t.innerHTML = `<h2>unavatar 키</h2><div class="m">프로필 사진은 사람당 한 번만 받아 catalog 에 캐시하므로, 키가 없어도 대부분 문제없이 동작합니다.</div>`;
  sc.appendChild(t);

  const s = el('div', 'sec');
  s.style.marginTop = '18px';
  s.innerHTML = `<div class="fld"><label for="ak-pub">퍼블리셔블 키</label>`
    + `<input id="ak-pub" placeholder="pk_..." autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(av.keys.pub)}">`
    + `<div class="hint">호출에 실제로 쓰이는 키입니다. 한도(429)에 걸렸을 때만 넣으면 됩니다.</div></div>`
    + `<div class="fld"><label for="ak-sec">시크릿 키</label>`
    + `<input id="ak-sec" placeholder="sk_..." autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(av.keys.sec)}">`
    + `<div class="hint warn">브라우저에서 보내면 개발자도구에 그대로 노출됩니다. 그래서 이 앱은 시크릿을 <b>호출에 쓰지 않고 보관만</b> 합니다. 나중에 서버를 붙일 때 쓰는 자리입니다.</div></div>`;
  const btn = el('button', 'btn', '저장');
  btn.onclick = () => {
    av.keys.set($('#ak-pub').value, $('#ak-sec').value);
    toast('이 기기에만 저장했어요');
    renderSettings();
  };
  s.appendChild(btn);
  sc.appendChild(s);

  const n = el('div', 'sec');
  n.style.marginTop = '20px';
  n.appendChild(el('div', 'note', `${ic('info', 17)}<span>키는 <b>이 기기의 저장소에만</b> 있습니다. 드라이브의 catalog.json 에는 넣지 않습니다 — 동기화되는 파일에 비밀을 두면 나중에 팀 공유할 때 그대로 퍼지기 때문입니다.</span>`));
  sc.appendChild(n);
}
