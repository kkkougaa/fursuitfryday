/* png-read.mjs — 의존성 없는 PNG 디코더 (아이콘 만들 때만 쓴다)
 *
 * 8비트, 비인터레이스만 읽는다. 색 종류 0/2/3/4/6 을 지원한다 —
 * 그림판·미리보기·브라우저가 저장하는 것은 거의 전부 이 안에 들어온다.
 * 16비트나 인터레이스는 만나면 그냥 말해 준다(조용히 깨지는 쪽이 더 나쁘다).
 */
import { inflateSync } from 'node:zlib';

const PAETH = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** @returns {{w:number,h:number,rgba:Buffer}} */
export function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 이 아닙니다');
  let p = 8;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (tag === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (tag === 'PLTE') plte = Buffer.from(data);
    else if (tag === 'tRNS') trns = Buffer.from(data);
    else if (tag === 'IDAT') idat.push(Buffer.from(data));
    else if (tag === 'IEND') break;
  }

  if (depth !== 8) throw new Error(`8비트 PNG 만 읽습니다 (이 파일은 ${depth}비트)`);
  if (interlace) throw new Error('인터레이스 PNG 는 읽지 못합니다');

  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!CH) throw new Error(`지원하지 않는 색 종류: ${type}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * CH;
  const lines = Buffer.alloc(stride * h);

  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = lines.subarray(y * stride, (y + 1) * stride);
    const prev = y ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= CH ? cur[i - CH] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= CH ? prev[i - CH] : 0;
      const x = src[i];
      cur[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b
        : f === 3 ? x + ((a + b) >> 1) : x + PAETH(a, b, c)) & 0xff;
    }
  }

  /* 무엇으로 들어왔든 RGBA 로 펴 준다 */
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * CH, d = i * 4;
    if (type === 6) { rgba[d] = lines[s]; rgba[d + 1] = lines[s + 1]; rgba[d + 2] = lines[s + 2]; rgba[d + 3] = lines[s + 3]; }
    else if (type === 2) { rgba[d] = lines[s]; rgba[d + 1] = lines[s + 1]; rgba[d + 2] = lines[s + 2]; rgba[d + 3] = 255; }
    else if (type === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = lines[s]; rgba[d + 3] = 255; }
    else if (type === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = lines[s]; rgba[d + 3] = lines[s + 1]; }
    else { // 3 = 팔레트
      const k = lines[s] * 3;
      rgba[d] = plte[k]; rgba[d + 1] = plte[k + 1]; rgba[d + 2] = plte[k + 2];
      rgba[d + 3] = trns && lines[s] < trns.length ? trns[lines[s]] : 255;
    }
  }
  return { w, h, rgba };
}
