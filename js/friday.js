/* friday.js — FursuitFriday 블록
 *
 * 매주 금요일은 사진을 올리는 날이라, 그날은 홈 맨 위에 "고르러 가기" 를
 * 띄운다. 오늘 할 일이 다음 행사 디데이보다 급하므로 디데이 위에 놓는다.
 */
import { S } from './store.js';
import { el, ic, fmt } from './ui.js';
import { t } from './i18n.js';
import { V, NO_FILTER, goTab } from './screens.js';

export const isFriday = (d = new Date()) => d.getDay() === 5;

/** 다음 금요일까지 남은 일수 (오늘이 금요일이면 0) */
export const daysToFriday = (d = new Date()) => (5 - d.getDay() + 7) % 7;

export function fridayCard() {
  if (S.cat.opts.friday === false || !isFriday()) return null;
  const all = Object.values(S.cat.photos);
  const unused = all.filter(p => !(p.usages || []).length).length;
  /* 미리 담아 둔 것이 있으면 그것부터 보여준다.
     금요일에 필요한 건 "안 올린 사진 800장" 이 아니라 "올리려고 골라 둔 12장" 이다.
     담아 둔 것이 없을 때만 예전처럼 안 올린 사진으로 보낸다. */
  const queued = all.filter(p => p.plannedAt).length;

  const b = el('button', 'friday');
  b.innerHTML = `<span class="ico">${ic(queued ? 'bookmark' : 'spark', 22, 2.1)}</span>`
    + `<span class="col"><span class="k">${t('home.friday')}</span>`
    + `<span class="nm">${queued ? t('home.fridayQueue') : t('home.fridayPick')}</span>`
    + `<span class="m">${queued
      ? t('home.fridayQueueDesc', { n: fmt(queued) })
      : t('home.fridayUnused', { n: fmt(unused) })}</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.3)}</span>`;
  b.onclick = () => {
    V.filter = queued ? { ...NO_FILTER(), planned: true } : { ...NO_FILTER(), unused: true };
    V.group = null;          // 대기열은 순서가 뜻이라 묶으면 순서가 깨진다
    V.limit = 90;
    goTab('photos');
  };
  return b;
}
