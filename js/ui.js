/* ui.js — 렌더링 프리미티브: 아이콘, 요소 만들기, 푸시 화면, 시트, 토스트 */

const P = {
  layers: 'M12 3.4 3.4 7.9 12 12.4l8.6-4.5L12 3.4Z M3.4 13 12 17.5 20.6 13',
  grid: 'M4 4h6.4v6.4H4z M13.6 4H20v6.4h-6.4z M4 13.6h6.4V20H4z M13.6 13.6H20V20h-6.4z',
  tag: 'M20.4 13.3 13.3 20.4a1.8 1.8 0 0 1-2.6 0L3.5 13.3V4.4a.9.9 0 0 1 .9-.9h8.9l7.1 7.2a1.8 1.8 0 0 1 0 2.6Z',
  sliders: 'M4 7h4 M12 7h8 M4 12h10 M18 12h2 M4 17h6 M14 17h6',
  chev: 'M9.5 5.5 16 12l-6.5 6.5',
  chevL: 'M15 5 8 12l7 7',
  link: 'M9.9 14.1 14.1 9.9 M8.5 11.7 6.7 13.5a3.3 3.3 0 0 0 4.7 4.7l1.8-1.8 M15.5 12.3l1.8-1.8a3.3 3.3 0 0 0-4.7-4.7l-1.8 1.8',
  check: 'M4.8 12.4 9.2 16.8 19.2 6.8',
  plus: 'M12 5.6v12.8 M5.6 12h12.8',
  x: 'M6.6 6.6l10.8 10.8 M17.4 6.6 6.6 17.4',
  folder: 'M3.6 6.6h5l2 2h9.8v10.8H3.6z',
  cloud: 'M7.6 18h8.6a3.9 3.9 0 0 0 .4-7.8A5.4 5.4 0 0 0 6.5 11.4 3.3 3.3 0 0 0 7.6 18Z',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7 M20.4 4.6v4h-4',
  ext: 'M14 4h6v6 M20 4l-8.4 8.4 M18 14.4V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.6',
  cam: 'M4 8.6h3L8.4 6.6h7.2L17 8.6h3v10.4H4z',
  key: 'M14.8 8.6a3.4 3.4 0 1 0-3.3 3.4L9.4 14v2h-2v2h-2v-2.6l6-5.9',
  clock: 'M12 7.2v5l3.3 2 M12 4.6a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8Z',
  info: 'M12 11.2v5.4 M12 8v.4 M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z',
  user: 'M12 11.4a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z M4.6 20.2c.6-3.6 3.7-5.6 7.4-5.6s6.8 2 7.4 5.6',
  copy: 'M9.4 9.4h9.2v9.2H9.4z M6.2 14.6H5.4V5.4h9.2v.8',
  cal: 'M4 6h16v15H4z M8 3v4 M16 3v4 M4 11h16',
  trash: 'M5 7h14 M9 7V4.6h6V7 M7 7l1 13h8l1-13',
  spark: 'M12 4.5l1.9 4.6 4.6 1.9-4.6 1.9L12 17.5l-1.9-4.6L5.5 11l4.6-1.9z',
};

export function ic(n, s = 20, w = 1.8) {
  const extra = n === 'cam' ? `<circle cx="12" cy="13.4" r="3.1" stroke="currentColor" stroke-width="${w}" fill="none"/>` : '';
  // sliders 노브는 fill 을 주지 않는다. var(--bg) 로 칠하면 유리 위에서
  // 흰 덩어리가 되어 "투명화가 덜 된" 것처럼 보인다. 선에 이미 빈 구간이
  // 있으니 fill:none 이면 뒤가 그대로 보이는 진짜 구멍이 된다.
  const knobs = n === 'sliders'
    ? [[10, 7], [16, 12], [12, 17]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1" stroke="currentColor" stroke-width="${w}" fill="none"/>`).join('')
    : '';
  const dot = n === 'tag' ? '<circle cx="7.7" cy="7.7" r="1.2" fill="currentColor"/>' : '';
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${P[n]}" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>${extra}${knobs}${dot}</svg>`;
}

/* 탭 아이콘의 "채워진" 변형. 윤곽선 아이콘은 속이 비어 있어서, 선택된 탭은
   같은 형태를 채운 것으로 바꿰 준다. 열린 경로에 fill 을 그냥 주면 엉뚱하게
   메워지므로 네 개는 직접 그렸다. */
const FILLED = {
  layers: '<path d="M12 3.1 2.9 7.9 12 12.7l9.1-4.8L12 3.1Z"/>'
    + '<path d="M2.9 13.05 12 17.85l9.1-4.8-2.3-1.2L12 15.35l-6.8-3.5z" opacity=".55"/>',
  grid: '<rect x="3.6" y="3.6" width="7.2" height="7.2" rx="1.7"/>'
    + '<rect x="13.2" y="3.6" width="7.2" height="7.2" rx="1.7"/>'
    + '<rect x="3.6" y="13.2" width="7.2" height="7.2" rx="1.7"/>'
    + '<rect x="13.2" y="13.2" width="7.2" height="7.2" rx="1.7"/>',
  cal: '<path d="M4 10.6h16V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'
    + '<path d="M6 5.6h12a2 2 0 0 1 2 2v1.6H4V7.6a2 2 0 0 1 2-2z" opacity=".5"/>'
    + '<path d="M8 3v3.2M16 3v3.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  sliders: '<path d="M4 7h4M12 7h8M4 12h10M18 12h2M4 17h6M14 17h6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
    + '<circle cx="10" cy="7" r="2.6"/><circle cx="16" cy="12" r="2.6"/><circle cx="12" cy="17" r="2.6"/>',
};

/** 속을 채운 아이콘. 없으면 윤곽선 아이콘으로 되돌린다. */
export function icFill(n, s = 24) {
  if (!FILLED[n]) return ic(n, s);
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${FILLED[n]}</svg>`;
}

export const $ = s => document.querySelector(s);
export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = n => Number(n || 0).toLocaleString('ko-KR');

export function avatarHTML(name, dataUrl, cls = '') {
  const ch = (name || '?').trim()[0] || '?';
  if (dataUrl) return `<span class="av ${cls}"><img alt="" src="${dataUrl}"></span>`;
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const v = `var(--av${(h % 6) + 1})`;
  return `<span class="av ${cls}" style="color:${v};background:color-mix(in srgb,${v} 15%,var(--bg))">${esc(ch)}</span>`;
}

/* ---------- 헤더 축소 ---------- */
export function wireScroll(root = document) {
  root.querySelectorAll('.scroll').forEach(sc => {
    if (sc.dataset.wired) return;
    sc.dataset.wired = '1';
    const h = sc.closest('.screen')?.querySelector('.hdr');
    const nb = sc.closest('.pushed')?.querySelector('.navbar');
    sc.addEventListener('scroll', () => {
      h?.classList.toggle('compact', sc.scrollTop > 10);
      nb?.classList.toggle('line', sc.scrollTop > 6);
    }, { passive: true });
  });
}

/* ---------- 푸시 화면 ---------- */
const stack = () => $('#stack');

export function push(title, build, ctaBuild) {
  const v = el('div', 'pushed');
  v.innerHTML = `<div class="navbar"><button class="back" aria-label="뒤로">${ic('chevL', 24, 2.2)}</button>`
    + `<span class="ttl">${esc(title)}</span><span class="rt"></span></div>`;
  const sc = el('div', 'scroll');
  v.appendChild(sc);
  build(sc, v);
  if (ctaBuild) { const bar = el('div', 'cta-bar'); ctaBuild(bar, sc, v); v.appendChild(bar); }
  stack().appendChild(v);
  requestAnimationFrame(() => {
    v.classList.add('in');
    $('.screens').classList.add('behind');
  });
  v.querySelector('.back').onclick = () => pop(v);
  wireScroll(v);
  return v;
}

export function pop(v) {
  v.classList.remove('in');
  if (stack().querySelectorAll('.pushed.in').length === 0) $('.screens').classList.remove('behind');
  setTimeout(() => v.remove(), 320);
}
export const popAll = () => stack().querySelectorAll('.pushed').forEach(pop);

export function setNavRight(v, html, onClick) {
  const rt = v.querySelector('.navbar .rt');
  rt.innerHTML = html;
  rt.onclick = onClick;
}

/* ---------- 시트 ---------- */
export function openSheet(html) {
  const s = $('#sheet');
  s.innerHTML = `<div class="grab"></div>${html}`;
  s.classList.add('on');
  $('#scrim').classList.add('on');
  return s;
}
export function closeSheet() {
  $('#sheet').classList.remove('on');
  $('#scrim').classList.remove('on');
}

/* ---------- 토스트 ---------- */
let tt;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(tt);
  tt = setTimeout(() => t.classList.remove('on'), 2400);
}

/* ---------- 확인 시트 ---------- */
export function confirmSheet({ title, lead, danger, ok = '확인', onOk }) {
  openSheet(`<h3>${esc(title)}</h3><p class="lead">${lead}</p>`
    + `<button class="btn ${danger ? 'danger' : ''}" id="cf-ok">${esc(ok)}</button>`
    + `<button class="btn sub" id="cf-no" style="width:100%;margin-top:8px">취소</button>`);
  $('#cf-ok').onclick = () => { closeSheet(); onOk(); };
  $('#cf-no').onclick = closeSheet;
}

/* ---------- 숫자 카운트업 ---------- */
export function countUp(node, to, ms = 520) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = fmt(to); return; }
  const t0 = performance.now();
  const from = 0;
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- 세그먼트 컨트롤 ----------
 * 알약 위치는 CSS 변수(--n 칸 수, --i 선택 인덱스)로만 정한다.
 * offsetWidth 를 재지 않으므로 웹폰트가 늦게 로드돼도 어긋나지 않고,
 * 폭을 트랜지션하지 않으므로 이동 중에 찌그러지지 않는다. */
export function segment(items, current, onPick) {
  const wrap = el('div', 'segwrap');
  const seg = el('div', 'seg');
  const idx = Math.max(0, items.findIndex(([v]) => v === current));
  seg.style.setProperty('--n', String(items.length));
  seg.style.setProperty('--i', String(idx));
  seg.appendChild(el('div', 'knob', '<i></i>'));
  items.forEach(([v, label], i) => {
    const b = el('button', v === current ? 'on' : '', esc(label));
    b.dataset.v = v;
    b.onclick = () => {
      if (v === current) return;
      // 다시 그리기 전에 알약을 먼저 옮겨 눌린 즉시 반응하게 한다.
      // 이동 거리에 비례해 늘어나도록 물방울 변수도 같이 넘긴다.
      seg.style.setProperty('--i', String(i));
      const knob = seg.querySelector('.knob');
      if (knob) {
        knob.style.setProperty('--sx', String(Math.min(0.34, 0.18 + Math.abs(i - idx) * 0.08)));
        knob.style.setProperty('--dir', i > idx ? '1' : '-1');
        knob.classList.remove('pop');
        void knob.offsetWidth;
        knob.classList.add('pop');
      }
      onPick(v);
    };
    seg.appendChild(b);
  });
  wrap.appendChild(seg);
  return wrap;
}

/* 진입 애니메이션(.stagger)은 fill-mode both 라, 백그라운드에서 그려져
   애니메이션이 시작되지 않으면 항목이 opacity 0 으로 남아 빈 화면이 된다.
   앱이 다시 앞으로 나오면 애니메이션을 되돌려 반드시 끝까지 재생시킨다. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  document.querySelectorAll('.stagger').forEach(n => {
    n.classList.remove('stagger');
    void n.offsetWidth;
    n.classList.add('stagger');
  });
});

/* ---------- 토글 ----------
 * 토글을 누를 때 화면을 다시 그리면 스위치가 새 상태로 "갑자기" 나타나
 * 애니메이션이 사라진다(뚞딲거림). 그래서 클래스만 제자리에서 뒤집고,
 * 영향을 받는 다른 화면만 따로 갱신한다.
 * `moving` 은 비드가 늘어났다 줄어드는 동안만 붙는다. */
export function flipSwitch(sw, on) {
  sw.classList.toggle('on', on);
  sw.setAttribute('aria-pressed', String(on));
  sw.classList.remove('moving');
  void sw.offsetWidth;
  sw.classList.add('moving');
  setTimeout(() => sw.classList.remove('moving'), 480);
  return on;
}

/* ---------- 스크롤 위치 보존 ----------
 * 화면을 다시 그리면 innerHTML 이 비워져 스크롤이 최상단으로 튄다.
 * 제안 카드를 하나 처리했을 때 목록이 위로 점프하지 않게 감싸서 쓴다. */
export function keepScroll(sc, fn) {
  const y = sc ? sc.scrollTop : 0;
  fn();
  if (!sc || !y) return;
  sc.scrollTop = y;
  // 이미지·폰트가 늦게 자리를 잡으면 한 번 더 맞춘다
  requestAnimationFrame(() => { if (Math.abs(sc.scrollTop - y) > 1) sc.scrollTop = y; });
}

/* ---------- X 열기 ----------
 * iOS 는 https://x.com/... 를 유니버설 링크로 처리해서 X 앱이 깔려 있으면
 * 앱으로 바로 넘어간다. twitter:// 스킴을 직접 던지면 앱이 없을 때
 * 사파리가 오류 대화상자를 띄우므로 https 로 간다. */
export function openX(handle) {
  if (!handle) return false;
  window.open(`https://x.com/${encodeURIComponent(handle)}`, '_blank', 'noopener');
  return true;
}
