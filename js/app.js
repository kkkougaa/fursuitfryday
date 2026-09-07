/* app.js — 부트, 로그인 게이트, 동기화 오케스트레이션 */
import { CONFIG, isConfigured } from './config-load.js';
import * as auth from './auth.js';
import * as drive from './drive.js';
import { S, load, syncFiles, touch, flush, onSaved, photos, applyAccent } from './store.js';
import * as sug from './suggest.js';
import * as th from './thumbs.js';
import { $, el, ic, fmt, toast, openSheet, closeSheet, confirmSheet } from './ui.js';
import { V, renderAll, goTab, renderTabs, renderHome, renderPhotos, renderSettings, wirePhotoChrome } from './screens.js';

const DEMO = new URLSearchParams(location.search).has('demo');

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
function progress(title, sub) {
  const s = openSheet(`<h3>${title}</h3><p class="lead" id="pg-sub">${sub || ''}</p>`
    + `<div class="bar"><i id="pg-bar" style="width:8%"></i></div>`
    + `<div class="lead" id="pg-n" style="margin:12px 0 0;text-align:center">준비 중…</div>`);
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
  const pg = progress('동기화', '드라이브 목록을 읽고 있어요. 사진은 수정하지 않습니다.');
  try {
    const files = await drive.listImages(
      S.cat.folders.map(f => f.id),
      n => pg.set(Math.min(70, 8 + n / 30), `${fmt(n)}장 찾음`),
    );
    th.remember(files);

    // 폴더별 개수 기록 (설정 화면 표시용)
    const byParent = new Map();
    files.forEach(f => (f.parents || []).forEach(p => byParent.set(p, (byParent.get(p) || 0) + 1)));
    S.cat.folders.forEach(f => { f.count = byParent.get(f.id) ?? f.count ?? 0; });

    pg.set(80, '기록과 대조하는 중…');
    const r = syncFiles(files);

    // 사용자가 "앞으로 자동" 을 켠 카메라 규칙만 조용히 적용
    const auto = sug.applyRules(r.addedIds);

    pg.set(92, '저장하는 중…');
    await flush();
    pg.set(100, '완료');
    setTimeout(() => pg.done(), 260);

    const bits = [`${fmt(r.total)}장`];
    if (r.added) bits.push(`새로 ${fmt(r.added)}장`);
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
    if (e.offline) { toast('네트워크에 연결되지 않았어요'); return; }
    console.error(e);
    if (e.status === 404 || e.status === 403) {
      openSheet(`<h3>폴더 안을 읽지 못했어요</h3>`
        + `<p class="lead">고른 폴더의 하위 파일에 접근 권한이 없습니다. <b>drive.file</b> 스코프는 앱이 만든 파일과 피커에서 직접 고른 항목만 볼 수 있어서, `
        + `폴더 선택으로 하위 파일까지 열리지 않는 계정 설정일 수 있습니다.<br><br>README 의 <b>"폴더 권한이 안 열릴 때"</b> 항목을 확인해 주세요.</p>`
        + `<button class="btn" onclick="this.closest('#sheet').classList.remove('on');document.getElementById('scrim').classList.remove('on')">닫기</button>`);
    } else {
      toast('동기화에 실패했어요');
    }
  } finally {
    syncing = false;
  }
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

/* ---------- 부트 ---------- */
async function wireShell() {
  wirePhotoChrome();
  // 굴절 유리는 지원하는 브라우저에만. 사파리는 레이어드 CSS 유리로 남는다.
  try {
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
  if (error && error !== 'access_denied') console.warn('oauth', error);

  if (!auth.isSignedIn()) { showGate(); return; }

  showShell();
  await wireShell();
  V.onSync = sync;
  V.onPickFolders = pickFolders;
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

    if (S.cat.folders.length) {
      // 목록 자체는 요청 2번이라 열 때마다 새로 대조해도 부담이 없다.
      await sync();
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
