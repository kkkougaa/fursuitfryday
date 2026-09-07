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

let token = null; // { access_token, expires_at }

function readStored() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    return t && t.access_token && t.expires_at > Date.now() + 30_000 ? t : null;
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

  store({
    access_token: at,
    expires_at: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000,
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
  if (silent) q.set('prompt', 'none');
  location.assign(`${AUTH_EP}?${q}`);
}

export function logout() {
  store(null);
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
