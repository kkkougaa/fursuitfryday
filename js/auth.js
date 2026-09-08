/* auth.js — 리다이렉트 방식 OAuth 2.0 (implicit)
 *
 * 왜 팝업이 아닌가: 홈 화면에 추가한 iOS 웹앱(standalone)에서 팝업이
 * 앱 컨텍스트 밖으로 새거나 열리지 않는 사례가 많다. 전체 페이지
 * 리다이렉트는 standalone 에서도 확실히 동작한다.
 *
 * 브라우저 전용이라 리프레시 토큰이 없다. 만료되면 prompt=none 으로
 * 조용히 다시 리다이렉트해서 받아온다(구글 세션이 살아 있으면 무인 통과).
 */
import { CONFIG } from './config-load.js';

const AUTH_EP = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_KEY = 'cd.token';
const STATE_KEY = 'cd.oauth.state';
const RESUME_KEY = 'cd.oauth.resume';
const GRANT_KEY = 'cd.granted';   // 마지막으로 실제 동의받은 스코프 문자열

/* 지금 필요한 스코프 목록. config 의 SCOPE 를 쪼개 둔다. */
const REQUIRED = CONFIG.SCOPE.split(/\s+/).filter(Boolean);

/** 받아온 스코프 문자열이 REQUIRED 를 전부 포함하는가 */
function hasAll(granted) {
  if (!granted) return false;
  const g = new Set(granted.split(/\s+/).filter(Boolean));
  return REQUIRED.every(s => g.has(s));
}

/** 이 브라우저가 현재 스코프 전부에 동의한 적이 있는가.
 *  동의한 적이 있으면 만료돼도 로그인 화면을 띄울 필요가 없다 —
 *  prompt=none 으로 조용히 다시 받아오면 된다. */
export function everGranted() {
  try { return hasAll(localStorage.getItem(GRANT_KEY)); } catch { return false; }
}

let token = null; // { access_token, expires_at, scope }

/*
 * 저장된 토큰은 아래 셋을 모두 만족해야 쓴다.
 *   1) 존재하고  2) 30초 이상 남았고  3) 지금 필요한 스코프를 전부 갖고 있다
 *
 * 3번이 핵심이다. SCOPE 를 늘린 직후에는 예전 토큰이 "아직 유효"하지만
 * 새 스코프가 없다. 그대로 쓰면 한 시간 내내 영문 모를 403 이 난다.
 * 여기서 걸러 버리면 앱이 알아서 다시 로그인시킨다.
 */
function readStored() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || !t.access_token) return null;
    if (t.expires_at <= Date.now() + 30_000) return null;
    if (!hasAll(t.scope)) { localStorage.removeItem(TOKEN_KEY); return null; }
    return t;
  } catch { return null; }
}

function store(t) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* 프라이빗 모드 등 */ }
}

function rand() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 주소창 프래그먼트에 토큰이 실려 돌아온 경우 회수한다. 앱 부트 때 1회 호출. */
export function consumeRedirect() {
  const h = location.hash;
  if (!h || h.length < 2) return { resumed: null };

  const p = new URLSearchParams(h.slice(1));
  const err = p.get('error');
  const at = p.get('access_token');
  if (!err && !at) return { resumed: null };

  // 프래그먼트를 즉시 지운다 — 토큰이 주소창/히스토리에 남지 않게.
  history.replaceState(null, '', location.pathname + location.search);

  const expectState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  const resume = sessionStorage.getItem(RESUME_KEY);
  sessionStorage.removeItem(RESUME_KEY);

  if (err) return { resumed: resume, error: err };
  if (!expectState || p.get('state') !== expectState) {
    return { resumed: resume, error: 'state_mismatch' };
  }

  // 구글이 실제로 내준 스코프. 요청한 것과 다를 수 있다(사용자가 체크를 뺀 경우).
  const granted = p.get('scope') || '';
  try { localStorage.setItem(GRANT_KEY, granted); } catch { /* 프라이빗 모드 */ }

  if (!hasAll(granted)) {
    // 사진 목록을 못 읽는 반쪽 상태로 들어가는 대신 여기서 끊는다.
    return { resumed: resume, error: 'scope_denied' };
  }

  store({
    access_token: at,
    expires_at: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000,
    scope: granted,
  });
  return { resumed: resume };
}

/**
 * 구글 인증 페이지로 이동한다.
 * @param {object} o
 * @param {boolean} o.silent  prompt=none — 이미 동의했고 세션이 살아 있으면 화면 없이 통과
 * @param {string}  o.resume  돌아온 뒤 복원할 화면 키
 */
export function login({ silent = false, resume = '' } = {}) {
  const state = rand();
  sessionStorage.setItem(STATE_KEY, state);
  if (resume) sessionStorage.setItem(RESUME_KEY, resume);

  const q = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    response_type: 'token',
    scope: CONFIG.SCOPE,
    include_granted_scopes: 'true',
    state,
  });

  if (silent) {
    q.set('prompt', 'none');
  } else if (!everGranted()) {
    // 아직 이 스코프 조합에 동의한 적이 없다 — 스코프를 늘린 직후가 여기다.
    // prompt 를 안 주면 구글이 "이미 동의했다"며 동의 화면을 건너뛰고
    // 예전 스코프만 담긴 토큰을 되돌려준다. 그래서 한 번은 강제로 물어본다.
    q.set('prompt', 'consent');
  }

  location.assign(`${AUTH_EP}?${q}`);
}

export function logout() {
  store(null);
  try { localStorage.removeItem(GRANT_KEY); } catch { /* 무시 */ }
}

export function isSignedIn() {
  if (!token) token = readStored();
  return !!token;
}

/** 남은 유효 시간(초). 만료·미로그인은 0. */
export function secondsLeft() {
  if (!token) token = readStored();
  return token ? Math.max(0, Math.round((token.expires_at - Date.now()) / 1000)) : 0;
}

/** 유효한 액세스 토큰. 만료됐으면 null (호출자가 재로그인 유도) */
export function accessToken() {
  if (!token) token = readStored();
  return token ? token.access_token : null;
}

/**
 * 구글 API 호출 래퍼.
 *  - 401/403 이면 토큰을 버리고 needAuth 를 던진다
 *  - 429/5xx 는 지수 백오프로 재시도 (첫 동기화 때 썸네일이 몰리면 429가 난다)
 */
export async function api(url, opts = {}, tries = 0) {
  const at = accessToken();
  if (!at) throw Object.assign(new Error('needAuth'), { needAuth: true });

  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${at}` };
  let res;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (e) {
    if (tries < 3) return backoff(url, opts, tries);
    throw Object.assign(new Error('network'), { offline: true });
  }

  if (res.status === 401) {
    store(null);
    throw Object.assign(new Error('needAuth'), { needAuth: true });
  }
  // 403 은 두 종류다. 스코프가 모자라 거절당한 것(insufficientPermissions)과
  // 잠깐 몰려서 막힌 것(rateLimitExceeded). 앞엣것은 재시도해도 소용없고
  // 다시 동의를 받아야 하므로 needScope 로 구분해 올린다.
  if (res.status === 403) {
    const body = await res.clone().text().catch(() => '');
    if (/insufficientPermissions|insufficientFilePermissions|accessNotConfigured/.test(body)) {
      store(null);
      try { localStorage.removeItem(GRANT_KEY); } catch { /* 무시 */ }
      throw Object.assign(new Error('needScope'), { needScope: true, status: 403, body });
    }
  }
  if ((res.status === 429 || res.status >= 500) && tries < 4) {
    return backoff(url, opts, tries, res);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`http ${res.status}`), { status: res.status, body });
  }
  return res;
}

function backoff(url, opts, tries, res) {
  const retryAfter = res && Number(res.headers.get('retry-after'));
  const wait = retryAfter ? retryAfter * 1000 : Math.min(8000, 2 ** tries * 400 + Math.random() * 300);
  return new Promise(r => setTimeout(r, wait)).then(() => api(url, opts, tries + 1));
}

/** 동시 실행 수를 묶는 큐 — 썸네일·아바타 요청이 한꺼번에 몰리는 것을 막는다. */
export function pool(limit = 6) {
  let active = 0;
  const q = [];
  const next = () => {
    if (active >= limit || !q.length) return;
    active++;
    const { fn, ok, no } = q.shift();
    fn().then(ok, no).finally(() => { active--; next(); });
  };
  return fn => new Promise((ok, no) => { q.push({ fn, ok, no }); next(); });
}
