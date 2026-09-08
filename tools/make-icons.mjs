/* make-icons.mjs — 앱 아이콘 PNG 생성 (의존성 없음, Node 표준 zlib 만 사용)
 *   node tools/make-icons.mjs
 *
 * icons/source.png 을 **그대로** 써서 크기별로 뽑는다.
 * 원본이 없으면 아무것도 쓰지 않고 멈춘다(멀쩡한 아이콘을 덮지 않게).
 *
 * 왜 잘라내고 모서리를 다시 씌우는가:
 * 시안 이미지는 보통 회색 바탕에 파란 타일이 얹히고 그림자가 깔린 목업이다.
 * 그대로 줄이면 회색 테두리와 그림자가 아이콘 안으로 따라 들어온다. 그래서
 * 파란 타일만 찾아 잘라내고 모서리 알파를 새로 씌운다.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { readPng } from './png-read.mjs';

const OUT = new URL('../icons/', import.meta.url);
const SRC = new URL('../icons/source.png', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [49, 130, 246];   // #3182F6 — 여백을 채울 때만 쓴다

/* ---------- 아주 작은 PNG 인코더 ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 모서리 알파 ---------- */
/** iOS 스퀴클 근사. round=false 면 사각으로 둔다(안드로이드 마스커블용). */
function roundMask(rgba, size, round, ratio = 0.2237) {
  if (!round) return rgba;
  const r = size * ratio;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.min(x, size - 1 - x), dy = Math.min(y, size - 1 - y);
    if (dx >= r || dy >= r) continue;
    const d = Math.hypot(r - dx, r - dy);
    const a = d <= r ? 1 : Math.max(0, 1 - (d - r) * 1.2);
    const i = (y * size + x) * 4;
    rgba[i + 3] = Math.round(rgba[i + 3] * a);
  }
  return rgba;
}

/* =====================================================================
 * ① 그림에서 뽑기
 * ===================================================================== */

/** 파란 타일이 놓인 자리를 찾는다 — 회색 바탕·그림자와 구별되는 건 파랑이다. */
function findTile({ w, h, rgba }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const R = rgba[i], G = rgba[i + 1], B = rgba[i + 2], A = rgba[i + 3];
    if (A < 128) continue;
    // 파랑: 파란 값이 빨강보다 확실히 크고, 회색(세 값이 비슷)이 아니다
    if (B > 120 && B - R > 40 && B - G > 20) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error('파란 타일을 찾지 못했습니다 — 바탕이 파랑이 아닌가요?');
  /* 정사각으로 맞춘다. 그림자 때문에 한쪽이 한두 픽셀 길게 잡힐 수 있다. */
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const box = { x: Math.round(cx - side / 2), y: Math.round(cy - side / 2), side };

  /* 모서리 반경을 잰다. 맨 윗줄에서 파랑이 시작하는 x 까지가 반경이다.
     이 값이 있어야 모서리 바깥(회색 바탕)을 타일 색으로 메울 수 있다. */
  const isBlue = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = (y * w + x) * 4;
    return rgba[i + 3] >= 128 && rgba[i + 2] > 120
      && rgba[i + 2] - rgba[i] > 40 && rgba[i + 2] - rgba[i + 1] > 20;
  };
  let rr = 0;
  const top = box.y + 1;
  while (rr < side / 2 && !isBlue(box.x + rr, top)) rr++;
  box.r = rr;

  /* 타일 색 — 글리프가 없는 왼쪽 가운데에서 집는다 */
  const si = ((box.y + Math.round(side / 2)) * w + box.x + Math.round(side * 0.04)) * 4;
  box.tint = [rgba[si], rgba[si + 1], rgba[si + 2]];
  return box;
}

/** 원본 타일 안쪽인가. 바깥이면 회색 바탕이므로 타일 색으로 바꿔치기한다. */
function inTile(box, x, y) {
  const dx = Math.min(x - box.x, box.x + box.side - 1 - x);
  const dy = Math.min(y - box.y, box.y + box.side - 1 - y);
  if (dx < 0 || dy < 0) return false;
  if (dx >= box.r || dy >= box.r) return true;
  return Math.hypot(box.r - dx, box.r - dy) <= box.r;
}

/** 상자 평균으로 줄인다. 아이콘은 축소만 하므로 이것으로 충분하다. */
function resample(src, box, size, pad) {
  const out = Buffer.alloc(size * size * 4);
  const inner = Math.max(1, Math.round(size * (1 - pad * 2)));
  const off = Math.round((size - inner) / 2);

  // 여백을 두는 경우(마스커블) 바깥은 타일 색으로 채운다
  const T = box.tint || BG;
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = T[0]; out[i * 4 + 1] = T[1]; out[i * 4 + 2] = T[2]; out[i * 4 + 3] = 255;
  }

  const k = box.side / inner;
  for (let y = 0; y < inner; y++) for (let x = 0; x < inner; x++) {
    const sx0 = box.x + x * k, sx1 = box.x + (x + 1) * k;
    const sy0 = box.y + y * k, sy1 = box.y + (y + 1) * k;
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
      if (sy < 0 || sy >= src.h) continue;
      for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
        if (sx < 0 || sx >= src.w) continue;
        /* 원본 모서리 바깥은 회색 바탕이다. 그대로 평균에 넣으면 아이콘
           모서리에 회색 테가 남으므로 타일 색으로 바꿔 넣는다. */
        if (!inTile(box, sx, sy)) { r += T[0]; g += T[1]; b += T[2]; n++; continue; }
        const i = (sy * src.w + sx) * 4;
        r += src.rgba[i]; g += src.rgba[i + 1]; b += src.rgba[i + 2]; n++;
      }
    }
    const d = ((y + off) * size + (x + off)) * 4;
    out[d] = Math.round(r / (n || 1));
    out[d + 1] = Math.round(g / (n || 1));
    out[d + 2] = Math.round(b / (n || 1));
    out[d + 3] = 255;
  }
  return out;
}

const fromImage = (src, box, size, { round = true, pad = 0 }) =>
  /* 모서리 반경은 원본에서 잰 비율을 쓴다. 0.2237(iOS 스퀴클)을 강제하면
     작품의 모서리보다 더 깎거나 덜 깎아서 테가 남는다. */
  roundMask(resample(src, box, size, pad), size, round, box.r / box.side);

/* ---------- 실행 ---------- */

const jobs = [
  ['icon-32.png', 32, { round: true }],                    // 파비콘
  ['icon-180.png', 180, { round: true }],                  // iOS 홈 화면
  ['icon-192.png', 192, { round: true }],
  ['icon-512.png', 512, { round: true }],
  // 안드로이드는 원형으로 잘라낸다. 안전 영역이 지름 80% 라 여백을 더 둔다.
  ['icon-maskable-512.png', 512, { round: false, pad: 0.14 }],
];

/* 원본이 없으면 아무것도 쓰지 않고 멈춘다.
   대신 다른 그림을 그려 두면, 모르고 한 번 돌렸을 때 멀쩡한 아이콘을
   엉뚱한 것으로 덮어 버린다. */
if (!existsSync(SRC)) {
  console.error('icons/source.png 이 없습니다.');
  console.error('아이콘 시안 이미지를 icons/source.png 로 저장한 뒤 다시 돌려주세요.');
  console.error('(회색 바탕·그림자가 있는 목업이어도 됩니다 — 파란 타일만 잘라 씁니다.)');
  process.exit(1);
}

const src = readPng(readFileSync(SRC));
const box = findTile(src);
console.log(`  source.png ${src.w}×${src.h} — 타일 ${box.side}px @ (${box.x},${box.y})`
  + `, 모서리 ${box.r}px (${(box.r / box.side * 100).toFixed(1)}%)`
  + `, 타일색 rgb(${box.tint.join(',')})`);

for (const [name, size, opt] of jobs) {
  writeFileSync(new URL(name, OUT), png(size, size, fromImage(src, box, size, opt)));
  console.log('  ✓', name, `${size}×${size}`);
}
console.log('아이콘 생성 완료');
