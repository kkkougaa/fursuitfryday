/* make-icons.mjs — 앱 아이콘 PNG 생성 (의존성 없음, Node 표준 zlib 만 사용)
 *   node tools/make-icons.mjs
 * 토스 블루 바탕에 흰 레이어(겹친 컷) 마크.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [49, 130, 246];   // #3182F6
const FG = [255, 255, 255];

/* --- 아주 작은 PNG 인코더 --- */
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

/* --- 마크: 겹친 세 개의 다이아몬드(레이어) --- */
function draw(size, { round = true, inset = 0.20 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.2237;              // iOS 스퀴클 근사
  const put = (x, y, c, a) => {
    const i = (y * size + x) * 4;
    const al = px[i + 3] / 255;
    const na = a + al * (1 - a);
    for (let k = 0; k < 3; k++) px[i + k] = Math.round((c[k] * a + px[i + k] * al * (1 - a)) / (na || 1));
    px[i + 3] = Math.round(na * 255);
  };

  const inRound = (x, y) => {
    if (!round) return 1;
    const dx = Math.min(x, size - 1 - x), dy = Math.min(y, size - 1 - y);
    if (dx >= r || dy >= r) return 1;
    const cx = dx < r ? r : dx, cy = dy < r ? r : dy;
    const d = Math.hypot(cx - dx, cy - dy);
    return d <= r ? 1 : Math.max(0, 1 - (d - r) * 1.2);
  };

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = inRound(x, y);
    if (a > 0) put(x, y, BG, a);
  }

  // 다이아몬드 3장 (위에서 아래로 겹침)
  const cx = size / 2;
  const w = size * (1 - inset * 2) / 2;
  const layers = [
    { cy: size * 0.375, h: w * 0.50, a: 1 },
    { cy: size * 0.515, h: w * 0.50, a: 0.55 },
    { cy: size * 0.655, h: w * 0.50, a: 0.30 },
  ];
  for (const L of layers) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const nx = Math.abs(x - cx) / w;
      const ny = Math.abs(y - L.cy) / L.h;
      const d = nx + ny;
      if (d <= 1) {
        const edge = Math.min(1, (1 - d) * size * 0.06);
        put(x, y, FG, L.a * edge);
      }
    }
  }
  return px;
}

const jobs = [
  ['icon-180.png', 180, { round: true }],
  ['icon-192.png', 192, { round: true }],
  ['icon-512.png', 512, { round: true }],
  ['icon-maskable-512.png', 512, { round: false, inset: 0.30 }],
];
for (const [name, size, opt] of jobs) {
  writeFileSync(new URL(name, OUT), png(size, size, draw(size, opt)));
  console.log('  ✓', name, `${size}×${size}`);
}
console.log('아이콘 생성 완료');
