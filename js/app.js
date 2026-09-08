/* app.js — 부트, 로그인 게이트, 동기화 오케스트레이션 */
import { CONFIG, isConfigured } from './config-load.js';
import * as auth from './auth.js';
import * as drive from './drive.js';
import { S, load, syncFiles, touch, flush, onSaved, photos, applyAccent, backupIfDue } from './store.js';
import * as sug from './suggest.js';
import * as th from './thumbs.js';
import * as av from './avatar.js';
import { t, LANGS, getLang, setLang } from './i18n.js';
import { $, el, ic, fmt, toast, openSheet, closeSheet, confirmSheet, skeleton } from './ui.js';
import { V, renderAll, goTab, renderTabs, renderHome, renderPhotos, renderSettings, wirePhotoChrome, wireHomeSync } from './screens.js';

const Q = new URLSearchParams(location.search);
const DEMO = Q.has('demo');

/* 진단 스위치. 크래시 원인을 하나씩 떼어 보려고 둔다.
 *   ?nothumb=1  썸네일을 한 장도 받지 않는다
 *   ?noglass=1  탭바의 굴절 유리 효과를 끈다 (iOS 에서 비싼 효과다)
 *   ?safe=1     위 둘을 한꺼번에
 * 평소에는 아무것도 안 붙이면 된다. */
const SAFE = Q.has('safe');
const NOTHUMB = SAFE || Q.has('nothumb');
const NOGLASS = SAFE || Q.has('noglass');

const gate = $('#gate');
const shell = $('#shell');

function showGate(msg) {
  shell.hidden = true;
  gate.hidden = false;
  /* 안쪽 층에 담는다. 가이드가 길어지면 세로가 넘치는데, 가운데 정렬만
     걸린 컨테이너는 넘치는 순간 위가 잘린다. margin:auto 0 이면 짧을 때는
     가운데, 길 때는 스크롤이 된다. */
  gate.innerHTML = '<div class="gate-in"></div>';
  const box = gate.querySelector('.gate-in');
  /* 언어 전환은 맨 위에 둔다. 가이드가 길어 화면을 넘기는데, 아래에 두면
     일본어 사용자가 한국어 안내를 다 지나쳐 내려가야 찾는다. */
  if (!msg) {
    const langs = el('div', 'langs');
    LANGS.forEach(l => {
      const b2 = el('button', getLang() === l.k ? 'on' : '', l.name);
      b2.onclick = () => { setLang(l.k); showGate(msg); };
      langs.appendChild(b2);
    });
    box.appendChild(langs);
  }

  /* 마크는 앱 아이콘 파일을 그대로 쓴다. 글리프로 다시 그리면 홈 화면에
     추가한 아이콘과 미묘하게 달라져서, 같은 앱인지 헷갈린다. */
  box.insertAdjacentHTML('beforeend', `<img class="mark" src="./icons/icon-180.png" alt="" width="76" height="76">`
    + `<h1>#FursuitFryday</h1>`
    + `<p>${msg || t('gate.lede')}</p>`);

  /* 시작하는 방법. 오류 메시지로 띄운 경우(msg)에는 넣지 않는다 —
     그때는 지금 무엇이 잘못됐는지가 먼저 읽혀야 한다. */
  if (!msg) {
    const g = el('div', 'guide');
    g.appendChild(el('div', 'ghd', t('gate.guideTitle')));
    [
      [t('gate.step1'), [t('gate.step1a')]],
      [t('gate.step2'), [t('gate.step2a')]],
      [t('gate.step3'), [t('gate.step3a'), t('gate.step3b')]],
    ].forEach(([tx, subs], i) => {
      g.appendChild(el('div', 'gi', `<span class="n">${i + 1}</span>`
        + `<span class="tx">${tx}`
        + subs.map(x => `<span class="sub">${x}</span>`).join('')
        + `</span>`));
    });
    box.appendChild(g);
  }

  const b = el('button', 'btn', t('gate.start'));
  b.style.maxWidth = '320px';
  b.onclick = () => auth.login({ resume: V.tab });
  box.appendChild(b);
  box.appendChild(el('p', 'fine', t('gate.fine')));

  if (!msg && !DEMO) {
    // 로그인 전에 무엇인지 보고 싶은 사람을 위한 출구
    const d = el('button', 'demo', t('gate.demo'));
    d.onclick = () => { location.search = '?demo=1'; };
    box.appendChild(d);
  }

  /* 미리 알아야 할 것. 로그인 버튼 뒤에 두는 이유: 먼저 읽고 시작할 수
     있어야 하지만, 이걸 다 읽어야 시작할 수 있는 것처럼 보이면 안 된다. */
  if (!msg) {
    const n = el('div', 'notes');
    n.appendChild(el('div', 'ghd', t('gate.noteTitle')));
    [t('gate.note1'), t('gate.note2'), t('gate.note3'), t('gate.note4')]
      .forEach(tx => n.appendChild(el('div', 'nt', tx)));
    box.appendChild(n);
  }

}

function showShell() {
  gate.hidden = true;
  shell.hidden = false;
}

/* ---------- 진행 오버레이 ---------- */
function progress(title, sub, onCancel) {
  const s = openSheet(`<h3>${title}</h3><p class="lead" id="pg-sub">${sub || ''}</p>`
    + `<div class="bar"><i id="pg-bar" style="width:8%"></i></div>`
    + `<div class="lead" id="pg-n" style="margin:12px 0 0;text-align:center">${t('sync.preparing')}</div>`
    + (onCancel ? `<button class="btn sub" id="pg-stop" style="width:100%;margin-top:16px">${t('sync.stop')}</button>` : ''));
  if (onCancel) {
    const b = s.querySelector('#pg-stop');
    // 누른 즉시 눌렀다는 걸 보여준다. 실제 중단은 진행 중인 묶음이 끝난 뒤다.
    if (b) b.onclick = () => { b.disabled = true; b.textContent = t('sync.stopping'); onCancel(); };
  }
  return {
    set(pct, text) {
      const b = s.querySelector('#pg-bar');
      if (b) b.style.width = Math.max(4, Math.min(100, pct)) + '%';
      const n = s.querySelector('#pg-n');
      if (n && text) n.textContent = text;
    },
    done() { closeSheet(); },
  };
}

/* ---------- 권한 부족 안내 ---------- */
/*
 * drive.readonly 동의를 못 받았을 때 뜬다. 원인은 대개 둘 중 하나다.
 *   - Cloud Console 동의 화면 스코프 목록에 drive.readonly 를 안 넣었다
 *   - 동의 화면에서 사용자가 체크를 뺐다
 */
function scopeSheet() {
  openSheet(
    `<h3>${t('sync.scopeTitle')}</h3>`
    + `<p class="lead">${t('sync.scopeLead')}</p>`
    + `<button class="btn pri" id="scope-again">${t('sync.scopeAgain')}</button>`
  );
  const b = document.getElementById('scope-again');
  if (b) b.onclick = () => auth.login({ resume: V.tab });
}

/* ---------- 폴더 선택 ---------- */
async function pickFolders() {
  try {
    const picked = await drive.pickFolders();
    if (!picked.length) return;
    const have = new Set(S.cat.folders.map(f => f.id));
    picked.forEach(f => { if (!have.has(f.id)) S.cat.folders.push({ id: f.id, name: f.name }); });
    touch();
    toast(t('sync.folderLinked', { n: picked.length }));
    await sync();
  } catch (e) {
    if (e.needAuth) return relogin();
    if (e.needScope) return scopeSheet();
    toast(t('sync.folderPickFail'));
    console.error(e);
  }
}

/* ---------- 동기화 ---------- */
let syncing = false;

async function sync() {
  if (syncing) return;
  if (!S.cat.folders.length) { toast(t('sync.folderFirst')); return; }
  syncing = true;
  syncBtn(true);

  /* 중단은 썸네일 준비 단계에만 걸린다. 목록 읽기와 저장은 중간에 끊으면
     기록이 어중간해지므로 끝까지 간다 — 어차피 몇 초다. */
  let stopThumbs = false;
  const pg = progress(t('sync.title'), t('sync.reading'),
    () => { stopThumbs = true; });

  try {
    const { files, folders } = await drive.listImages(
      S.cat.folders.map(f => f.id),
      n => pg.set(Math.min(50, 6 + n / 40), t('sync.found', { n: fmt(n) })),
    );
    th.remember(files);

    /* 폴더별 개수 (설정 화면 표시용).
       예전에는 parents 가 루트와 같은 것만 셌다. 그래서 하위 폴더로 정리해 둔
       사람은 연결한 폴더가 늘 "0개" 로 보였다. 부모를 타고 올라가 루트를
       찾아서 센다. */
    const parentOf = new Map(folders.map(f => [f.id, f.parent]));
    const roots = new Set(S.cat.folders.map(f => f.id));
    const rootOf = id => {
      let cur = id;
      for (let i = 0; cur && i < 24; i++) {          // 순환 폴더 방어
        if (roots.has(cur)) return cur;
        cur = parentOf.get(cur) || null;
      }
      return null;
    };
    const byRoot = new Map();
    files.forEach(f => {
      const r0 = rootOf((f.parents || [])[0]);
      if (r0) byRoot.set(r0, (byRoot.get(r0) || 0) + 1);
    });
    S.cat.folders.forEach(f => { f.count = byRoot.get(f.id) ?? f.count ?? 0; });

    pg.set(55, t('sync.comparing'));
    const r = syncFiles(files, folders);

    // 사용자가 "앞으로 자동" 을 켠 카메라 규칙만 조용히 적용
    const auto = sug.applyRules(r.addedIds);

    /* 기록을 먼저 저장한다. 아래 썸네일 단계는 길고 중단할 수 있는데,
       그때 분류 기록까지 날아가면 안 된다. */
    pg.set(62, t('sync.saving'));
    await flush();

    /* 썸네일 준비 — 아직 기기에 없는 것만 받아 IndexedDB 에 넣는다. 화면에
       띄우지 않으므로 몇천 장을 돌려도 메모리가 늘지 않는다. 이미 받아둔
       것은 건너뛰니 두 번째 동기화부터는 이 단계가 순식간에 끝난다. */
    const pre = await th.prefetch(Object.keys(S.cat.photos), {
      shouldStop: () => stopThumbs,
      onProgress: ({ done, total, failed }) => {
        if (!total) { pg.set(96, t('sync.thumbsReady')); return; }
        pg.set(65 + (done / total) * 31,
          `${t('pre.progress', { done: fmt(done), total: fmt(total) })}${failed ? ` · ${t('sync.failCount', { n: fmt(failed) })}` : ''}`);
      },
    });

    pg.set(100, t('sync.done'));
    setTimeout(() => pg.done(), 260);

    // 폴더는 붙었는데 한 장도 안 나오는 경우. 예전에는 여기서 아무 말이 없어
    // "그냥 안 되네"로 끝났다. 권한 문제일 가능성이 가장 크므로 짚어 준다.
    if (!files.length) {
      // 진행 시트가 260ms 뒤에 닫히므로, 그 뒤에 띄워야 같이 사라지지 않는다.
      setTimeout(() => {
        openSheet(
          `<h3>${t('sync.emptyTitle')}</h3>`
          + `<p class="lead">${t('sync.emptyLead')}</p>`
          + `<button class="btn pri" id="empty-again">${t('sync.scopeAgain')}</button>`
        );
        const b = document.getElementById('empty-again');
        if (b) b.onclick = () => auth.login({ resume: V.tab });
      }, 700);
    }

    const bits = [t('sync.total', { n: fmt(r.total) })];
    if (r.added) bits.push(t('sync.added', { n: fmt(r.added) }));
    if (pre.total) {
      bits.push(stopThumbs
        ? t('sync.thumbsUpto', { n: fmt(pre.done) })
        : t('sync.thumbsPrepared', { n: fmt(pre.done - pre.failed) }));
    }
    if (auto) bits.push(t('sync.autoFiled', { n: fmt(auto) }));
    if (r.vanished) bits.push(t('sync.vanished', { n: fmt(r.vanished) }));
    toast(bits.join(' · '));

    renderAll();

    if (r.vanishedUsed.length) {
      setTimeout(() => confirmSheet({
        title: t('sync.goneTitle'),
        lead: `${t('sync.goneUsed', { n: fmt(r.vanishedUsed.length) })} ${t('sync.goneLead')}`,
        ok: t('sync.gotIt'),
        onOk: () => {},
      }), 700);
    }
  } catch (e) {
    pg.done();
    if (e.needAuth) return relogin();
    if (e.needScope) return scopeSheet();
    if (e.offline) { toast(t('sync.offline')); return; }
    console.error(e);
    if (e.status === 404) {
      openSheet(`<h3>${t('sync.noFolderTitle')}</h3>`
        + `<p class="lead">${t('sync.noFolderLead')}</p>`
        + `<button class="btn" onclick="this.closest('#sheet').classList.remove('on');document.getElementById('scrim').classList.remove('on')">${t('common.close')}</button>`);
    } else {
      toast(t('sync.failed'));
    }
  } finally {
    syncing = false;
    syncBtn(false);
  }
}

/* 동기화 중에는 헤더 버튼을 눌러도 아무 일이 없다(syncing 가드). 눌리는데
   반응이 없으면 고장으로 보이므로 눌리지 않는 상태를 눈에 보이게 한다. */
function syncBtn(busy) {
  const b = document.getElementById('home-sync');
  if (!b) return;
  b.disabled = busy;
  b.textContent = busy ? t('sync.running') : t('sync.title');
  b.style.opacity = busy ? '.45' : '';
}

function relogin() {
  toast(t('sync.expired'));
  auth.login({ silent: true, resume: V.tab });
}

/* ---------- 무인 재로그인 ----------
 *
 * 액세스 토큰은 1시간이고, 브라우저 전용이라 리프레시 토큰이 없다.
 * 그래도 구글 세션 쿠키가 살아 있으면 prompt=none 리다이렉트로 화면 없이
 * 다시 받아올 수 있다. 세션 쿠키는 보통 몇 달 남으니, 실제로는
 * "한 번 로그인하면 계속" 에 가깝게 동작한다.
 *
 * 그런데 예전에는 그 길을 거의 타지 못했다.
 *   · 부팅할 때 만료돼 있으면 시도도 안 하고 게이트를 띄웠다
 *   · 만료 감시 조건이 `left > 0` 이라 **이미 만료된 경우가 빠져** 있었다
 *   · 감시는 setInterval 인데 iOS 는 백그라운드에서 타이머를 잰다 —
 *     만료 5분 전 구간은 대개 앱이 백그라운드일 때 지나간다
 * 그래서 매번 로그인 버튼을 눌러야 했다.
 *
 * 실패했을 때 계속 리다이렉트하지 않도록 시도 여부를 세션에 남긴다.
 * 성공해서 유효한 토큰을 들고 있으면 지운다 — 다음 만료 때 다시 쓸 수 있게.
 */
const SILENT_KEY = 'cd.silent.tried';
const triedSilent = () => { try { return sessionStorage.getItem(SILENT_KEY) === '1'; } catch { return false; } };
const markSilent = on => {
  try { on ? sessionStorage.setItem(SILENT_KEY, '1') : sessionStorage.removeItem(SILENT_KEY); } catch { /* 프라이빗 모드 */ }
};

let booted = false;

/** 남은 시간이 짧으면 조용히 갱신한다. 넉넉하면 아무것도 하지 않는다. */
function maybeRenew() {
  if (DEMO || !isConfigured() || !booted) return;
  if (!auth.everGranted()) return;      // 동의한 적이 없으면 게이트가 맞다
  if (triedSilent()) return;            // 방금 실패했다 — 리다이렉트 반복 금지
  if (auth.secondsLeft() > 300) return; // 5분 넘게 남았으면 그냥 둔다
  markSilent(true);
  auth.login({ silent: true, resume: V.tab });
}

/* ---------- 저장 상태 표시 ---------- */
/* 설정은 push 화면이 되었다 — 열려 있지 않으면 renderSettings 가
   스스로 아무 일도 하지 않으므로 탭을 따질 필요가 없다. */
onSaved(() => { renderSettings(); });

/* 화면을 벗어나기 전에 저장을 밀어 넣는다 — iOS 는 탭이 백그라운드로 가면 잰다. */
addEventListener('visibilitychange', () => {
  if (document.hidden) { flush().catch(() => {}); return; }
  // 돌아왔을 때 백그라운드에서 놓친 갱신 창을 여기서 메운다
  maybeRenew();
});
addEventListener('pagehide', () => { flush().catch(() => {}); });

/* ---------- 썸네일 미리 받기 ---------- */
let prefetching = false;

async function prefetchThumbs() {
  if (prefetching) return;
  const ids = Object.keys(S.cat.photos);
  if (!ids.length) { toast(t('sync.needFirst')); return; }

  prefetching = true;
  let stop = false;
  const pg = progress(t('pre.title'), t('pre.lead'),
    () => { stop = true; });

  try {
    const r = await th.prefetch(ids, {
      shouldStop: () => stop,
      onProgress: ({ done, total, failed }) => {
        pg.set(total ? (done / total) * 100 : 100,
          total ? `${t('pre.count', { done: fmt(done), total: fmt(total) })}${failed ? ` · ${t('sync.failCount', { n: fmt(failed) })}` : ''}` : t('pre.nothing'));
      },
    });
    pg.done();
    if (!r.total) toast(t('pre.allDone'));
    else if (stop) toast(t('pre.stopped', { n: fmt(r.done) }));
    else toast(`${t('pre.saved', { n: fmt(r.done - r.failed) })}${r.failed ? ` · ${t('sync.failCount', { n: fmt(r.failed) })}` : ''}`);
    renderSettings();
  } catch (e) {
    pg.done();
    if (e.needAuth) return relogin();
    if (e.needScope) return scopeSheet();
    console.error(e);
    toast(t('pre.fail'));
  } finally {
    prefetching = false;
  }
}

/* ---------- 부트 ---------- */
async function wireShell() {
  wirePhotoChrome();
  wireHomeSync();
  if (NOTHUMB) { th.disable(); toast(t('demo.diagMode')); }
  // 굴절 유리는 지원하는 브라우저에만. 사파리는 레이어드 CSS 유리로 남는다.
  try {
    if (NOGLASS) throw new Error('noglass');
    const { attachGlass, supportsSvgBackdrop } = await import('./glass.js');
    if (supportsSvgBackdrop()) attachGlass($('#tabbar'), {
        // radius 를 크게 주면 glass.js 가 높이의 절반으로 잘라 캡슐이 된다
        bezel: 13, scale: 24, dispersion: 0.18, blur: 0.3, radius: 999, power: 2.4,
      });
  } catch { /* 없어도 동작한다 */ }
  document.getElementById('tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) goTab(b.dataset.tab);
  });
  $('#scrim').onclick = closeSheet;
}

async function bootDemo() {
  const { install } = await import('./demo.js');
  const n = install();
  applyAccent(S.cat.opts.accent);
  showShell();
  await wireShell();
  V.onSync = () => toast(t('demo.noDrive'));
  V.onPickFolders = () => toast(t('demo.noPick'));
  V.onPrefetch = () => toast(t('demo.noFetch'));
  V.onLogout = () => { location.search = ''; };
  renderAll();
  goTab('home');
  setTimeout(() => toast(t('demo.hello', { n: fmt(n) })), 500);
}

async function boot() {
  if (DEMO) return bootDemo();

  if (!isConfigured()) {
    showGate(t('gate.noConfig'));
    const b = gate.querySelector('.btn');
    b.textContent = t('gate.tryDemo');
    b.onclick = () => { location.search = '?demo=1'; };
    return;
  }

  const { resumed, error } = auth.consumeRedirect();
  if (error === 'interaction_required' || error === 'login_required' || error === 'consent_required') {
    showGate(t('gate.relogin'));
    return;
  }
  if (error === 'scope_denied') {
    // 반쪽 권한으로 들어가면 "폴더는 붙는데 사진이 0장"인 상태가 된다.
    // 아예 게이트에서 멈추고 다시 받게 한다.
    showGate(t('gate.needScope'));
    return;
  }
  if (error && error !== 'access_denied') console.warn('oauth', error);

  if (!auth.isSignedIn()) {
    /* 동의한 적이 있으면 로그인 화면을 보여줄 이유가 없다. 조용히 받아온다.
       실패하면 위 consumeRedirect 가 login_required 로 돌아와 게이트를 띄운다. */
    if (auth.everGranted() && !triedSilent()) {
      markSilent(true);
      auth.login({ silent: true, resume: V.tab });
      return;
    }
    showGate();
    return;
  }
  markSilent(false);   // 유효한 토큰을 들고 있다 — 다음 만료 때 다시 시도할 수 있게

  showShell();
  await wireShell();
  V.onSync = sync;
  V.onPickFolders = pickFolders;
  V.onPrefetch = prefetchThumbs;
  V.onLogout = () => confirmSheet({
    title: t('auth.logoutQ'), danger: true, ok: t('auth.logout'),
    lead: t('auth.logoutLead'),
    onOk: () => { auth.logout(); location.reload(); },
  });

  /* 여기서 catalog.json 을 드라이브에서 읽는다. 셸은 이미 떴는데 홈은
     비어 있어서, 모바일 데이터로 들어오면 몇 초 동안 흰 화면만 보였다.
     홈이 그려질 모양(디데이 카드 + 섹션 + 행)을 미리 깔아 둔다.
     renderHome() 이 같은 컨테이너를 비우고 다시 그리므로 치울 필요는 없다. */
  $('#home-scroll')?.appendChild(skeleton(['card', 'title', 'row', 'row', 'row']));

  try {
    await load();
    applyAccent(S.cat.opts.accent);
    th.remember([]);
    renderAll();
    goTab(resumed && ['home', 'photos', 'schedule', 'profile'].includes(resumed) ? resumed : 'home');

    /* 예전에는 여기서 무조건 sync() 를 돌렸다. 앱을 열 때마다 드라이브
       목록을 통째로 다시 읽는 셈이라, 사진이 몇천 장이면 열 때마다 몇 초씩
       기다렸고 429(요청 한도)도 곧잘 났다. 사진은 행사 다녀온 날에나 늘지
       매시간 늘지 않는다. 그래서 동기화는 홈 헤더의 버튼으로 옮겼다.

       한 번도 동기화한 적이 없을 때만 알려 준다 — 폴더만 붙여두고 사진이
       안 보이면 고장으로 보이니까. */
    if (S.cat.folders.length && !S.cat.syncedAt) {
      setTimeout(() => toast(t('sync.needFirst')), 600);
    }
  } catch (e) {
    if (e.needAuth) { showGate(t('gate.relogin')); return; }
    console.error(e);
    toast(t('sync.catalogFail'));
    renderAll();
  }

  booted = true;

  /* 첫 화면을 그린 다음에 손댄다 — 둘 다 급하지 않은 일이고,
     동기화·썸네일과 네트워크를 다투면 첫 화면이 늦어진다. */
  setTimeout(() => {
    // ① 한도에 걸려 비어 있던 프로필 사진 채우기
    av.backfill([...S.cat.shooters, ...S.cat.people])
      .then(n => { if (n) { touch(); renderAll(); toast(t('avatar.got', { n: fmt(n) })); } })
      .catch(() => { /* 조용히 넘어간다 */ });
    // ② 하루 한 번 catalog 사본 남기기
    backupIfDue().catch(() => {});
  }, 3000);

  /* 만료가 가까우면 조용히 갱신. 화면이 보일 때만 —
     백그라운드에서 페이지를 넘겨 버리면 앱이 통째로 다시 뜬다. */
  setInterval(() => {
    if (document.hidden) return;
    maybeRenew();
  }, 60_000);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();
