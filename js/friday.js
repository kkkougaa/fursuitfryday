/* friday.js — FursuitFriday 블록
 *
 * 매주 금요일은 사진을 올리는 날이라, 그날은 홈 맨 위에 "고르러 가기" 를
 * 띄운다. 오늘 할 일이 다음 행사 디데이보다 급하므로 디데이 위에 놓는다.
 */
import { S } from './store.js';
import { el, ic } from './ui.js';
import { V, NO_FILTER, goTab } from './screens.js';

export const isFriday = (d = new Date()) => d.getDay() === 5;

/** 다음 금요일까지 남은 일수 (오늘이 금요일이면 0) */
export const daysToFriday = (d = new Date()) => (5 - d.getDay() + 7) % 7;

export function fridayCard() {
  if (S.cat.opts.friday === false || !isFriday()) return null;
  const unused = Object.values(S.cat.photos).filter(p => !(p.usages || []).length).length;

  const b = el('button', 'friday');
  b.innerHTML = `<span class="ico">${ic('spark', 22, 2.1)}</span>`
    + `<span class="col"><span class="k">오늘은 #FursuitFriday</span>`
    + `<span class="nm">업로드할 사진 고르러 가기</span>`
    + `<span class="m">아직 안 올린 사진 ${unused.toLocaleString('ko-KR')}장</span></span>`
    + `<span class="chev">${ic('chev', 18, 2.3)}</span>`;
  b.onclick = () => {
    V.filter = { ...NO_FILTER(), unused: true };
    V.limit = 90;
    goTab('photos');
  };
  return b;
}
