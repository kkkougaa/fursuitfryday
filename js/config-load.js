/* config-load.js — config.js 를 있으면 쓰고, 없으면 기본값으로 버틴다
 *
 * 왜 필요한가
 *   config.js 를 정적 import 하면 그 파일이 없을 때 모듈 그래프 전체가
 *   깨져 **빈 화면**이 된다. 데모(?demo=1)조차 안 열린다. 깃허브에
 *   config.js 를 올리지 않고 배포했을 때 정확히 그 일이 난다.
 *   그래서 동적 import 로 감싸고, 없으면 빈 값으로 둔다 —
 *   앱은 뜨고, 실제 연결이 필요한 화면에서만 "키를 넣어주세요" 를 띄운다.
 */

const FALLBACK = {
  CLIENT_ID: '',
  API_KEY: '',
  REDIRECT_URI: location.origin + location.pathname,
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
};

let loaded = FALLBACK;
try {
  const m = await import('../config.js');
  loaded = { ...FALLBACK, ...(m.CONFIG || {}) };
} catch {
  // config.js 없이도 데모는 돌아간다
}

export const CONFIG = loaded;
export const isConfigured = () => !!CONFIG.CLIENT_ID && !CONFIG.CLIENT_ID.startsWith('0000');
