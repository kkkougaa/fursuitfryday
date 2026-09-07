/* app.js — 부트, 로그인 게이트, 동기화 오케스트레이션 */
import { CONFIG, isConfigured } from './config-load.js';
import * as auth from './auth.js';
import * as drive from './drive.js';
import { S, load, syncFiles, touch, flush, onSaved, photos, applyAccent } from './store.js';
import * as sug from './suggest.js';
import * as th from './thumbs.js';
import { $, el, ic, fmt, toast, openSheet, closeSheet, confirmSheet } from './ui.js';
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
  gate.innerHTML = `<div class="mark">${ic('layers', 38, 2)}</div>`
    + `<h1>#FursuitFryday</h1>`
    + `<p>${msg || '행사 사진에 행사·사진사·퍼슈트를 붙이고,<br>어느 컷을 올렸는지 기록합니다.'}</p>`;
  const b = el('button', 'btn', '구글로 시작하기');
  b.style.maxWidth = '320px';
  b.onclick = () => auth.login({ resume: V.tab });
  gate.appendChild(b);
  gate.appendChild(el('p', 'fine', '드라이브에서 <b>내가 고른 폴더만</b> 읽습니다.<br>사진은 절대 수정하지 않습니다.'));
}

function showShell() {
  gate.hidden = true;
  shell.hidden = false;
}

/* ---------- 진행 오버레이 ---------- */
function progress(title, sub, onCancel) {
  const s = openSheet(`<h3>${title}</h3><p class="lead" id="pg-sub">${sub || ''}</p>`
    + `<div class="bar"><i id="pg-bar" style="width:8%"></i></div>`
    + `<div class="lead" id="pg-n" style="margin:12px 0 0;text-align:center">준비 중…</div>`
    + (onCancel ? `<button class="btn sub" id="pg-stop" style="width:100%;margin-top:16px">중단</button>` : ''));
  if (onCancel) {
    const b = s.querySelector('#pg-stop');
    // 누른 즉시 눌렀다는 걸 보여준다. 실제 중단은 진행 중인 묶음이 끝난 뒤다.
    if (b) b.onclick = () => { b.disabled = true; b.textContent = '중단하는 중…'; onCancel(); };
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
    '<h3>사진을 읽을 권한이 없어요</h3>'
    + '<p class="lead">고른 폴더 안을 읽으려면 드라이브 <b>보기 권한</b>이 필요합니다. '
    + '동의 화면에서 체크를 빼셨거나, 아직 이 권한에 동의하지 않은 상태예요.</p>'
    + '<button class="btn pri" id="scope-again">권한 다시 요청</button>'
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
    toast(`폴더 ${picked.length}개를 연결했어요`);
    await sync();
  } catch (e) {
    if (e.needAuth) return relogin();
    if (e.needScope) return scopeSheet();
    toast('폴더를 고르지 못했어요');
    console.error(e);
  }
}

/* ---------- 동기화 ---------- */
let syncing = false;

async function sync() {
  if (syncing) return;
  if (!S.cat.folders.length) { toast('먼저 폴더를 연결해 주세요'); return; }
  syncing = true;
  syncBtn(true);

  /* 중단은 썸네일 준비 단계에만 걸린다. 목록 읽기와 저장은 중간에 끊으면
     기록이 어중간해지므로 끝까지 간다 — 어차피 몇 초다. */
  let stopThumbs = false;
  const pg = progress('동기화', '드라이브 목록을 읽고 있어요. 사진은 수정하지 않습니다.',
    () => { stopThumbs = true; });

  try {
    const files = await drive.listImages(
      S.cat.folders.map(f => f.id),
      n => pg.set(Math.min(50, 6 + n / 40), `${fmt(n)}장 찾음`),
    );
    th.remember(files);

    // 폴더별 개수 기록 (설정 화면 표시용)
    const byParent = new Map();
    files.forEach(f => (f.parents || []).forEach(p => byParent.set(p, (byParent.get(p) || 0) + 1)));
    S.cat.folders.forEach(f => { f.count = byParent.get(f.id) ?? f.count ?? 0; });

    pg.set(55, '기록과 대조하는 중…');
    const r = syncFiles(files);

    // 사용자가 "앞으로 자동" 을 켠 카메라 규칙만 조용히 적용
    const auto = sug.applyRules(r.addedIds);

    /* 기록을 먼저 저장한다. 아래 썸네일 단계는 길고 중단할 수 있는데,
       그때 분류 기록까지 날아가면 안 된다. */
    pg.set(62, '저장하는 중…');
    await flush();

    /* 썸네일 준비 — 아직 기기에 없는 것만 받아 IndexedDB 에 넣는다. 화면에
       띄우지 않으므로 몇천 장을 돌려도 메모리가 늘지 않는다. 이미 받아둔
       것은 건너뛰니 두 번째 동기화부터는 이 단계가 순식간에 끝난다. */
    const pre = await th.prefetch(Object.keys(S.cat.photos), {
      shouldStop: () => stopThumbs,
      onProgress: ({ done, total, failed }) => {
        if (!total) { pg.set(96, '썸네일은 이미 준비돼 있어요'); return; }
        pg.set(65 + (done / total) * 31,
          `썸네일 ${fmt(done)} / ${fmt(total)}장${failed ? ` · 실패 ${fmt(failed)}` : ''}`);
      },
    });

    pg.set(100, '완료');
    setTimeout(() => pg.done(), 260);

    // 폴더는 붙었는데 한 장도 안 나오는 경우. 예전에는 여기서 아무 말이 없어
    // "그냥 안 되네"로 끝났다. 권한 문제일 가능성이 가장 크므로 짚어 준다.
    if (!files.length) {
      // 진행 시트가 260ms 뒤에 닫히므로, 그 뒤에 띄워야 같이 사라지지 않는다.
      setTimeout(() => {
        openSheet(
          '<h3>폴더는 연결됐는데 사진이 0장이에요</h3>'
          + '<p class="lead">폴더가 비어 있거나, 앱에 드라이브 보기 권한이 없을 때 이렇게 됩니다. '
          + '폴더에 사진이 있는 게 확실하다면 권한을 다시 받아 보세요.</p>'
          + '<button class="btn pri" id="empty-again">권한 다시 요청</button>'
        );
        const b = document.getElementById('empty-again');
        if (b) b.onclick = () => auth.login({ resume: V.tab });
      }, 700);
    }

    const bits = [`${fmt(r.total)}장`];
    if (r.added) bits.push(`새로 ${fmt(r.added)}장`);
    if (pre.total) {
      bits.push(stopThumbs
        ? `썸네일 ${fmt(pre.done)}장까지`
        : `썸네일 ${fmt(pre.done - pre.failed)}장 준비`);
    }
    if (auto) bits.push(`자동 분류 ${fmt(auto)}장`);
    if (r.vanished) bits.push(`사라진 ${fmt(r.vanished)}장`);
    toast(bits.join(' · '));

    renderAll();

    if (r.vanishedUsed.length) {
      setTimeout(() => confirmSheet({
        title: '사라진 사진 중 올린 게 있어요',
        lead: `SNS에 올린 기록이 있는 <b>${fmt(r.vanishedUsed.length)}장</b>이 드라이브에서 없어졌습니다. `
          + '기록은 지우지 않고 보관했습니다 — 원본이 사라져도 "이 사진을 올렸다"는 사실은 유효하니까요. 폴더가 옮겨진 것인지 확인해 보세요.',
        ok: '알겠어요',
        onOk: () => {},
      }), 700);
    }
  } catch (e) {
    pg.done();
    if (e.needAuth) return relogin();
    if (e.needScope) return scopeSheet();
    if (e.offline) { toast('네트워크에 연결되지 않았어요'); return; }
    console.error(e);
    if (e.status === 404) {
      openSheet('<h3>폴더를 찾지 못했어요</h3>'
        + '<p class="lead">연결한 폴더가 지워졌거나 다른 계정으로 옮겨졌을 수 있습니다. '
        + '설정에서 연결을 끊고 다시 골라 주세요.</p>'
        + '<button class="btn" onclick="this.closest(\'#sheet\').classList.remove(\'on\');document.getElementById(\'scrim\').classList.remove(\'on\')">닫기</button>');
    } else {
      toast('동기화에 실패했어요');
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
  b.textContent = busy ? '동기화 중…' : '동기화';
  b.style.opacity = busy ? '.45' : '';
}

function relogin() {
  toast('로그인이 만료됐어요');
  auth.login({ silent: true, resume: V.tab });
}

/* ---------- 저장 상태 표시 ---------- */
onSaved(() => { if (V.tab === 'settings') renderSettings(); });

/* 화면을 벗어나기 전에 저장을 밀어 넣는다 — iOS 는 탭이 백그라운드로 가면 잰다. */
addEventListener('visibilitychange', () => { if (document.hidden) flush().catch(() => {}); });
addEventListener('pagehide', () => { flush().catch(() => {}); });

/* ---------- 썸네일 미리 받기 ---------- */
let prefetching = false;

async function prefetchThumbs() {
  if (prefetching) return;
  const ids = Object.keys(S.cat.photos);
  if (!ids.length) { toast('먼저 동기화로 사진 목록을 받아 주세요'); return; }

  prefetching = true;
  let stop = false;
  const pg = progress('썸네일 미리 받기',
    '기기에 저장해 둡니다. 사진은 화면에 띄우지 않으니 앱이 무거워지지 않아요.',
    () => { stop = true; });

  try {
    const r = await th.prefetch(ids, {
      shouldStop: () => stop,
      onProgress: ({ done, total, failed }) => {
        pg.set(total ? (done / total) * 100 : 100,
          total ? `${fmt(done)} / ${fmt(total)}장${failed ? ` · 실패 ${fmt(failed)}` : ''}` : '받을 것이 없어요');
      },
    });
    pg.done();
    if (!r.total) toast('이미 전부 저장돼 있어요');
    else if (stop) toast(`중단했어요 · ${fmt(r.done)}장 저장`);
    else toast(`${fmt(r.done - r.failed)}장을 기기에 저장했어요${r.failed ? ` · 실패 ${fmt(r.failed)}` : ''}`);
    renderSettings();
  } catch (e) {
    pg.done();
    if (e.needAuth) return relogin();
    if (e.needScope) return scopeSheet();
    console.error(e);
    toast('미리 받기에 실패했어요');
  } finally {
    prefetching = false;
  }
}

/* ---------- 부트 ---------- */
async function wireShell() {
  wirePhotoChrome();
  wireHomeSync();
  if (NOTHUMB) { th.disable(); toast('진단 모드 · 썸네일을 받지 않습니다'); }
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
  V.onSync = () => toast('데모 모드예요. 드라이브에 연결되지 않습니다');
  V.onPickFolders = () => toast('데모 모드예요. 폴더를 고를 수 없습니다');
  V.onPrefetch = () => toast('데모 모드예요. 받아올 사진이 없습니다');
  V.onLogout = () => { location.search = ''; };
  renderAll();
  goTab('home');
  setTimeout(() => toast(`데모 · 사진 ${fmt(n)}장 · 아직 분류 전이에요`), 500);
}

async function boot() {
  if (DEMO) return bootDemo();

  if (!isConfigured()) {
    showGate('config.js 에 <b>CLIENT_ID</b> 와 <b>API_KEY</b> 를 넣어주세요.<br>README 의 설정 순서를 따라가면 5분입니다.');
    const b = gate.querySelector('.btn');
    b.textContent = '데모로 먼저 둘러보기';
    b.onclick = () => { location.search = '?demo=1'; };
    return;
  }

  const { resumed, error } = auth.consumeRedirect();
  if (error === 'interaction_required' || error === 'login_required' || error === 'consent_required') {
    showGate('다시 로그인해 주세요.');
    return;
  }
  if (error === 'scope_denied') {
    // 반쪽 권한으로 들어가면 "폴더는 붙는데 사진이 0장"인 상태가 된다.
    // 아예 게이트에서 멈추고 다시 받게 한다.
    showGate('사진을 읽으려면 드라이브 <b>보기 권한</b>이 필요합니다.<br>동의 화면에서 체크를 모두 켜 주세요.');
    return;
  }
  if (error && error !== 'access_denied') console.warn('oauth', error);

  if (!auth.isSignedIn()) { showGate(); return; }

  showShell();
  await wireShell();
  V.onSync = sync;
  V.onPickFolders = pickFolders;
  V.onPrefetch = prefetchThumbs;
  V.onLogout = () => confirmSheet({
    title: '로그아웃할까요?', danger: true, ok: '로그아웃',
    lead: '이 기기에서 토큰만 지웁니다. 드라이브의 catalog.json 은 그대로 남습니다.',
    onOk: () => { auth.logout(); location.reload(); },
  });

  try {
    await load();
    applyAccent(S.cat.opts.accent);
    th.remember([]);
    renderAll();
    goTab(resumed && ['home', 'photos', 'tags', 'settings'].includes(resumed) ? resumed : 'home');

    /* 예전에는 여기서 무조건 sync() 를 돌렸다. 앱을 열 때마다 드라이브
       목록을 통째로 다시 읽는 셈이라, 사진이 몇천 장이면 열 때마다 몇 초씩
       기다렸고 429(요청 한도)도 곧잘 났다. 사진은 행사 다녀온 날에나 늘지
       매시간 늘지 않는다. 그래서 동기화는 홈 헤더의 버튼으로 옮겼다.

       한 번도 동기화한 적이 없을 때만 알려 준다 — 폴더만 붙여두고 사진이
       안 보이면 고장으로 보이니까. */
    if (S.cat.folders.length && !S.cat.syncedAt) {
      setTimeout(() => toast('오른쪽 위 동기화를 눌러 사진을 불러오세요'), 600);
    }
  } catch (e) {
    if (e.needAuth) { showGate('다시 로그인해 주세요.'); return; }
    console.error(e);
    toast('카탈로그를 읽지 못했어요');
    renderAll();
  }

  // 만료 5분 전에 조용히 갱신
  setInterval(() => {
    const left = auth.secondsLeft();
    if (left > 0 && left < 300) auth.login({ silent: true, resume: V.tab });
  }, 60_000);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();
