/* demo.js — ?demo=1 로 열면 로그인·드라이브 없이 UI 를 그대로 써 볼 수 있다.
 *
 * 쓰는 이유: Cloud Console 설정 전에 아이폰 홈 화면에 추가해서 조작감·안전영역·
 * 애니메이션을 먼저 확인하려면 데이터가 있어야 한다. 이 모드는 네트워크를
 * 전혀 쓰지 않고, 사진은 캔버스로 그린다.
 *
 * 초기 상태를 진짜처럼 만들기 위해 **행사·작가를 하나도 지정하지 않은 상태**로
 * 시작한다. 그래야 "확인할 것" 제안과 분류 흐름을 검증할 수 있다.
 */
import { S, emptyCatalog } from './store.js';
import * as th from './thumbs.js';

const DAYS = [
  ['2026-03-14', ['#241A14', '#6B4325', '#C78A4A', '#F0D8AA'], 'Canon EOS R6 Mark II', 'RF 24-70mm F2.8 L', 46],
  ['2026-05-22', ['#121A24', '#31506C', '#8399B4', '#E2EAF2'], 'Sony α7 IV', 'FE 35mm F1.4 GM', 28],
  ['2026-06-08', ['#1F2429', '#5C6571', '#A3ACB6', '#E6EAEC'], 'Nikon Z6 III', 'NIKKOR Z 24-120mm f/4', 34],
  ['2026-07-19', ['#2A1424', '#82334D', '#DB6A48', '#F7C48E'], 'Canon EOS R6 Mark II', 'RF 24-70mm F2.8 L', 52],
  ['2026-08-27', ['#0B1820', '#1A424B', '#3A867F', '#CBDDD9'], 'Fujifilm X-T5', 'XF 16-55mm F2.8 R', 24],
];

const pal = new Map();

const KEY = 'cd.demo.cat';

export function install() {
  th.setProvider(async (id, size) => draw(id, size));

  // 지난번에 만지던 데모가 있으면 그대로 이어간다
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.photos && Object.keys(saved.photos).length) {
        Object.keys(saved.photos).forEach(id => palFromId(id));
        S.cat = saved;
        S.demo = true;
        S.catFileId = 'demo';
        S.dirty = false;
        return Object.keys(saved.photos).length;
      }
    }
  } catch { /* 깨졌으면 새로 만든다 */ }

  const cat = emptyCatalog();
  cat.folders = [{ id: 'demo-folder', name: '행사사진/2026 (데모)', count: 0 }];
  cat.syncedAt = new Date().toISOString();

  let n = 0;
  DAYS.forEach(([date, colors, cam, lens, count], di) => {
    for (let i = 0; i < count; i++, n++) {
      const id = `demo-${di}-${String(i).padStart(3, '0')}`;
      pal.set(id, colors);
      const hh = 9 + ((i * 7) % 9);
      const mm = (i * 13) % 60;
      const ss = (i * 29) % 60;
      cat.photos[id] = {
        md5: id,
        name: `${date.replace(/-/g, '')}_${String(4000 + n).padStart(4, '0')}.jpg`,
        w: 6000, h: 4000, size: (4 + (i % 8)) * 1048576,
        shotAt: `${date}T${p2(hh)}:${p2(mm)}:${p2(ss)}`,
        cameraModel: cam, lens,
        iso: [100, 200, 400, 640, 1250][i % 5],
        exposure: `1/${[125, 200, 320, 500, 1000][i % 5]}s · f/${[1.8, 2.0, 2.8, 4.0, 5.6][i % 5]}`,
        event: null, shooter: null, people: [], tags: [], usages: [], plannedAt: null,
      };
    }
  });
  cat.folders[0].count = n;

  /* 다가오는 일정 — 오늘로부터 상대 날짜로 만들어, 언제 열어도 디데이가 말이 되게 한다 */
  cat.eventTags = [{ name: '정모', color: 'purple' }, { name: '컨벤션', color: 'blue' }];
  cat.events = [
    {
      id: 'ev-next', name: '퍼슈트 프라이데이 정모', date: plusDays(11), endDate: null,
      going: true, logo: null, place: '홍대 스튜디오', note: '입장 18시 · 단체샷 19시',
      tags: ['정모'],
      sub: [
        { id: 'sb1', day: plusDays(11), time: '19:00', title: '단체 사진 촬영', place: '메인 홀',
          note: '전신 나오게 3열로. 헤드 쓰고 대기하다가 신호 오면 입장.' },
        { id: 'sb2', day: plusDays(11), time: '21:00', title: '뒷풀이', place: '근처 식당' },
      ],
      prep: [
        { id: 'q1', text: '슈트 세탁 · 브러싱', done: true },
        { id: 'q2', text: '헤드 팬 배터리 충전', done: false },
        { id: 'q3', text: '참가비 입금', done: false },
      ],
      packed: ['pk1', 'pk2'],
    },
    {
      id: 'ev-conv', name: '코믹월드 겨울', date: plusDays(46), endDate: plusDays(48),
      going: true, logo: null, place: '킨텍스 제2전시장', note: null, tags: ['컨벤션'],
      sub: [
        { id: 'sb3', day: plusDays(46), time: '11:00', title: '부스 인사', place: 'C-14' },
        { id: 'sb4', day: plusDays(47), time: '14:00', title: '합동 촬영회', place: '야외 광장',
          note: '쿨링 조끼 꼭. 그늘 없어서 30분 단위로 쉬기로 했음.' },
        { id: 'sb5', day: plusDays(48), time: '16:00', title: '폐막 단체샷', place: '3홀 입구' },
      ],
      prep: [], packed: [],
    },
    {
      id: 'ev-maybe', name: '봄 퍼밋', date: plusDays(80), endDate: plusDays(81),
      going: false, logo: null, place: '부산', note: null, tags: [],
      sub: [], prep: [], packed: [],
    },
  ];

  S.cat = cat;
  S.demo = true;
  S.catFileId = 'demo';
  S.dirty = false;
  return n;
}

export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}

/** 저장본을 복원할 때 색 팔레트를 id 에서 되살린다 (demo-<날짜인덱스>-<번호>) */
function palFromId(id) {
  const m = /^demo-(\d+)-/.exec(id);
  if (m && DAYS[Number(m[1])]) pal.set(id, DAYS[Number(m[1])][1]);
}

const p2 = v => String(v).padStart(2, '0');
function plusDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/* ---- 캔버스로 사진처럼 보이는 이미지를 만든다 (초점 흐린 색면) ---- */
const cache = new Map();

function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draw(id, size) {
  const key = id + ':' + size;
  if (cache.has(key)) return cache.get(key);
  const colors = pal.get(id) || ['#222', '#555', '#999', '#ddd'];
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  const r = rng(seed);

  const w = size, h = Math.round(size * (size > 500 ? 2 / 3 : 1));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');

  const lg = g.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, colors[1]);
  lg.addColorStop(0.3 + r() * 0.4, colors[2]);
  lg.addColorStop(1, colors[0]);
  g.fillStyle = lg;
  g.fillRect(0, 0, w, h);

  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = (0.2 + r() * 0.4) * Math.max(w, h);
    const col = colors[Math.floor(r() * 4)];
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, col);
    rg.addColorStop(0.55, col + '8C');
    rg.addColorStop(1, col + '00');
    g.globalAlpha = 0.3 + r() * 0.4;
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, rad, 0, 6.2832); g.fill();
  }
  g.globalAlpha = 1;

  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.78);
  vg.addColorStop(0, '#00000000');
  vg.addColorStop(1, '#0000006B');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);

  const url = c.toDataURL('image/jpeg', 0.82);
  cache.set(key, url);
  return url;
}
