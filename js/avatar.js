/* avatar.js — unavatar 로 X 프로필 사진을 딱 한 번 받아 catalog 에 캐시
 *
 * 확인해 둔 사실 (2026-09-07 실측)
 *   GET https://unavatar.io/x/{handle}?fallback=false
 *     · 토큰 없이 200, 400×400 JPEG (약 37KB)
 *     · 다른 오리진에서 fetch 성공 → CORS 열려 있어 캔버스 변환 가능
 *     · 없는 핸들은 404 → 이니셜 아바타로 폴백할 신호로 쓴다
 *
 * 원본 37KB 를 그대로 base64 로 넣으면 22명이면 catalog 가 1MB 넘게 불어난다.
 * 96×96 WebP 로 줄여서 장당 3~5KB 로 만든 뒤 저장한다.
 *
 * 키는 catalog 가 아니라 기기 localStorage 에만 둔다 — 동기화되는 파일에
 * 비밀을 넣지 않는다. 공유 드라이브로 팀 공유하면 팀 전체에 퍼지니까.
 */

import { squareDataURL } from './imgutil.js';

const KEY_PUB = 'cd.unavatar.pk';
const KEY_SEC = 'cd.unavatar.sk';
const SIZE = 96;

export const keys = {
  get pub() { try { return localStorage.getItem(KEY_PUB) || ''; } catch { return ''; } },
  get sec() { try { return localStorage.getItem(KEY_SEC) || ''; } catch { return ''; } },
  set(pub, sec) {
    try {
      pub ? localStorage.setItem(KEY_PUB, pub.trim()) : localStorage.removeItem(KEY_PUB);
      sec ? localStorage.setItem(KEY_SEC, sec.trim()) : localStorage.removeItem(KEY_SEC);
    } catch { /* 프라이빗 모드 */ }
  },
};

function url(handle) {
  const q = new URLSearchParams({ fallback: 'false' });
  // 실제 호출에는 퍼블리셔블만 쓴다. 시크릿은 브라우저에서 보내면 네트워크
  // 탭에 그대로 노출되므로, 서버를 붙일 때까지 보관만 한다.
  if (keys.pub) q.set('token', keys.pub);
  return `https://unavatar.io/x/${encodeURIComponent(handle)}?${q}`;
}

/**
 * @returns {Promise<{ok:true,dataUrl:string}|{ok:false,reason:'notfound'|'limit'|'cors'|'error'}>}
 */
export async function fetchAvatar(handle) {
  if (!handle) return { ok: false, reason: 'error' };
  let res;
  try {
    res = await fetch(url(handle), { mode: 'cors' });
  } catch {
    return { ok: false, reason: 'cors' };
  }
  if (res.status === 404) return { ok: false, reason: 'notfound' };
  if (res.status === 429) return { ok: false, reason: 'limit' };
  if (!res.ok) return { ok: false, reason: 'error' };

  try {
    const dataUrl = await squareDataURL(await res.blob(), SIZE);
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export const REASON = {
  notfound: '그 아이디로 프로필 사진을 찾지 못했어요',
  limit: '호출 한도에 걸렸어요. 설정에서 unavatar 키를 넣으면 풀립니다',
  cors: '프로필 사진을 받아오지 못했어요',
  error: '프로필 사진을 처리하지 못했어요',
};
