/* folderpick.js — 폴더 고르기. 앱 화면으로 직접 그린다.
 *
 * 예전에는 구글 피커(iframe)를 띄웠는데 폰에서 데스크톱 파일 관리자처럼
 * 보였다. 이 앱은 drive.readonly 를 갖고 있어서 폴더 목록을 직접 읽을 수
 * 있으므로, 앱의 행·검색창·시트를 그대로 써서 만든다.
 *
 * ⚠ 이 방식은 drive.readonly 에 의존한다. drive.file 만 있는 앱은 피커가
 *   필수다 — 피커로 고른 것에만 권한이 생기는 구조이기 때문이다.
 *   공개 배포(제한된 스코프 심사)를 노린다면 이 결정을 다시 봐야 한다.
 *
 * 고르는 것과 들어가는 것을 한 줄에서 나눈다: 왼쪽 체크는 고르기,
 * 이름을 누르면 그 안으로 들어간다. 폴더는 고르면서 동시에 더 깊이
 * 볼 수도 있어야 한다.
 */
import * as drive from './drive.js';
import { S } from './store.js';
import {
  $, el, ic, esc, fmt, push, pop, searchRow,
} from './ui.js';
import { t, sortByName, matches } from './i18n.js';

/**
 * @param {(picked:Array<{id,name}>)=>void} onPick 고른 폴더들. 취소하면 안 불린다.
 */
export function openFolderPick(onPick) {
  /* 고른 것은 id → name 으로 들고 간다. 다른 폴더로 옮겨 다니는 동안에도
     유지돼야 하므로 화면 밖에 둔다. */
  const picked = new Map();
  /* 지금 보고 있는 자리. 첫 칸은 내 드라이브 최상위다. */
  let path = [{ id: 'root', name: t('fp.myDrive') }];
  let searching = '';
  let view = null;      // push 로 만든 화면
  /* 늦게 온 응답이 새 목록을 덮지 않게 한다.
     ⚠ push() 의 build 가 곧바로 paint→fill 을 부르므로 이 선언이 그보다
        아래에 있으면 초기화 전 접근으로 터진다. 위에 둔다. */
  let seq = 0;

  const linked = new Set(S.cat.folders.map(f => f.id));

  view = push(t('fp.title'), (sc, v) => {
    sc.id = 'fp-body';
    paint(sc);
  }, (bar, sc, v) => {
    /* 아래 고정 바 — 몇 개 골랐는지와 연결 버튼. 목록이 길어도 늘 닿는다. */
    bar.id = 'fp-bar';
    paintBar(bar);
  });

  /* ---------- 아래 바 ---------- */
  function paintBar(bar) {
    bar.innerHTML = '';
    const n = picked.size;
    const b = el('button', 'btn', n
      ? t('fp.linkN', { n: fmt(n) })
      : t('fp.pickFirst'));
    b.disabled = !n;
    b.onclick = () => {
      const out = [...picked].map(([id, name]) => ({ id, name }));
      pop(view);
      onPick(out);
    };
    bar.appendChild(b);
  }
  const reBar = () => { const b = $('#fp-bar'); if (b) paintBar(b); };

  /* ---------- 목록 ---------- */
  async function paint(sc) {
    sc.innerHTML = '';

    /* 빵부스러기. 지금 어디인지와 위로 가는 길을 같이 준다. */
    const crumb = el('div', 'sec fp-crumb');
    path.forEach((p, i) => {
      const last = i === path.length - 1;
      const b = el('button', 'fp-seg' + (last ? ' on' : ''), esc(p.name));
      b.disabled = last;
      b.onclick = () => { path = path.slice(0, i + 1); searching = ''; paint(sc); };
      crumb.appendChild(b);
      if (!last) crumb.appendChild(el('span', 'fp-sep', ic('chev', 13, 2.4)));
    });
    sc.appendChild(crumb);

    const wrap = el('div', 'sec');
    /* 검색은 위치를 가리지 않는다 — 깊이 묻힌 폴더를 이름만으로 찾는다. */
    wrap.appendChild(searchRow(t('fp.searchPh'), q => {
      searching = q.trim();
      fill(box, sc);
    }));
    const box = el('div', 'card');
    wrap.appendChild(box);
    sc.appendChild(wrap);

    fill(box, sc);
  }

  /* ---------- 목록 채우기 ---------- */
  async function fill(box, sc) {
    const mine = ++seq;
    box.innerHTML = '';
    box.appendChild(el('div', 'fp-load', `<span class="sk" style="width:100%;height:44px"></span>`));

    let list = [];
    try {
      list = searching
        ? await drive.searchFolders(searching)
        : await drive.listFolders(path[path.length - 1].id);
    } catch (e) {
      if (mine !== seq) return;
      box.innerHTML = '';
      box.appendChild(el('div', 'fp-none', t(e.needAuth ? 'fp.needAuth' : 'fp.failed')));
      return;
    }
    if (mine !== seq) return;      // 그 사이 다른 곳으로 옮겼다

    /* 검색 결과는 서버가 부분 일치로 주므로 한 번 더 눕혀 걸러 준다
       (가타카나·대소문자까지 맞춘다). 탐색 결과는 그대로 이름순. */
    const rows = sortByName(searching ? list.filter(f => matches(searching, f.name)) : list);

    box.innerHTML = '';
    if (!rows.length) {
      box.appendChild(el('div', 'fp-none',
        t(searching ? 'fp.noHit' : 'fp.emptyHere')));
      return;
    }
    rows.forEach(f => box.appendChild(row(f, box, sc)));
  }

  /* ---------- 한 줄 ---------- */
  function row(f, box, sc) {
    const on = picked.has(f.id);
    const already = linked.has(f.id);
    const r = el('div', 'fp-row' + (on ? ' on' : ''));

    /* 고르기 — 왼쪽 체크. 이미 연결해 둔 폴더는 다시 고를 필요가 없다. */
    const ck = el('button', 'fp-ck', ic('check', 15, 3));
    ck.setAttribute('aria-label', t(on ? 'fp.unpick' : 'fp.pick'));
    if (already) {
      ck.disabled = true;
      r.classList.add('done');
    }
    ck.onclick = () => {
      if (picked.has(f.id)) picked.delete(f.id); else picked.set(f.id, f.name);
      r.classList.toggle('on', picked.has(f.id));
      reBar();
    };
    r.appendChild(ck);

    /* 들어가기 — 이름을 누른다 */
    const go = el('button', 'fp-go',
      `<span class="fp-ico">${ic('folder', 18)}</span>`
      + `<span class="fp-nm">${esc(f.name)}</span>`
      + (already ? `<span class="fp-tag">${t('fp.already')}</span>` : '')
      + `<span class="fp-chev">${ic('chev', 17, 2.1)}</span>`);
    go.onclick = () => {
      path = [...path, { id: f.id, name: f.name }];
      searching = '';
      paint(sc);
    };
    r.appendChild(go);
    return r;
  }
}
