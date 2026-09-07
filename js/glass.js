/* glass.js — 맑은 리퀴드 글라스 (굴절 + 색수차)
 *
 * 왜 다시 만들었나
 *   앞선 판은 blur 를 세게 먹여 "서리 유리" 가 됐다. 애플의 리퀴드 글라스는
 *   **맑다**. R3F 의 MeshTransmissionMaterial 로 만든 예시들도 roughness 를
 *   0 으로 두고, 유리처럼 보이게 하는 건 blur 가 아니라
 *     ① 가장자리에서 배경이 꺾이는 굴절
 *     ② 꺾인 정도가 색마다 달라 생기는 색수차(chromatic aberration)
 *     ③ 테두리에 얇게 도는 스펙큘러
 *   이 세 가지다. 그래서 흐림을 거의 걷고 굴절과 색수차를 세게 올렸다.
 *
 * 구현
 *   캔버스로 변위 맵을 그린다(R=X 이동, G=Y 이동, 128 중립). 라운드 사각형의
 *   부호 거리(SDF)를 재서 테두리에서 bezel px 안쪽까지만 곡면이고, 가운데는
 *   변위 0 — 그래서 중앙은 그냥 맑게 통과한다.
 *
 *   색수차는 같은 맵으로 feDisplacementMap 을 배율만 달리해 세 번 돌리고,
 *   각각에서 R·G·B 한 채널씩만 남겨 다시 더한다. 파장이 길수록 덜 꺾이는
 *   실제 분산과 같은 순서(R > G > B)로 배율을 준다.
 *
 * ⚠️ SVG 필터를 backdrop-filter 로 받는 건 크로미움만 된다. 사파리(=아이폰)는
 *   지원하지 않으므로, 지원하는 브라우저에만 html.glass-svg 를 붙이고
 *   사파리는 CSS 레이어드 유리로 남긴다.
 */

const HOST_ID = 'cd-glass-defs';
const NS = 'http://www.w3.org/2000/svg';
let seq = 0;

export function supportsSvgBackdrop() {
  try {
    const okSyntax = CSS.supports('backdrop-filter', 'url(#x)')
      || CSS.supports('-webkit-backdrop-filter', 'url(#x)');
    if (!okSyntax) return false;
    // UA 문자열 대신 크로미움에만 있는 API 로 가른다
    const brands = navigator.userAgentData && navigator.userAgentData.brands;
    return !!(brands && brands.some(b => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand)));
  } catch {
    return false;
  }
}

function host() {
  let svg = document.getElementById(HOST_ID);
  if (svg) return svg;
  svg = document.createElementNS(NS, 'svg');
  svg.id = HOST_ID;
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;opacity:0';
  document.body.appendChild(svg);
  return svg;
}

const mk = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/**
 * 채널 하나만 남기는 행렬. 알파는 **상수 1로 고정**한다.
 * 원본 알파를 그대로 두면 세 장을 더할 때 알파가 3배로 쌓이고,
 * 프리멀티플라이드 합성이 어긋나 화면 전체에 색이 물든다(분홍 끼).
 */
const ONLY = {
  R: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1',
  G: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1',
  B: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1',
};

/**
 * 변위 맵. R = X 이동, G = Y 이동, 128 이 중립.
 * @param {number} power 곡면 프로필 지수. 클수록 테두리 쪽에 몰린다.
 */
function displacementMap(w, h, radius, bezel, power) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;

  const halfW = w / 2;
  const halfH = h / 2;
  const r = Math.min(radius, halfW, halfH);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - halfW;
      const py = y + 0.5 - halfH;

      // 라운드 사각형 SDF — 음수면 내부
      const qx = Math.abs(px) - (halfW - r);
      const qy = Math.abs(py) - (halfH - r);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const sd = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
      const inward = -sd;                     // 테두리까지 남은 안쪽 거리

      let nx = 0;
      let ny = 0;
      if (inward >= 0 && inward < bezel) {
        const u = 1 - inward / bezel;         // 0=곡면 시작, 1=테두리
        const mag = Math.pow(u, power);

        // 바깥 방향 법선 = SDF 기울기
        let gx;
        let gy;
        if (ox > 0 || oy > 0) {
          const L = Math.hypot(ox, oy) || 1;
          gx = (ox / L) * Math.sign(px || 1);
          gy = (oy / L) * Math.sign(py || 1);
        } else if (qx > qy) {
          gx = Math.sign(px || 1);
          gy = 0;
        } else {
          gx = 0;
          gy = Math.sign(py || 1);
        }
        nx = gx * mag;
        ny = gy * mag;
      }

      const i = (y * w + x) * 4;
      d[i] = 128 + nx * 127;
      d[i + 1] = 128 + ny * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

/**
 * 요소에 굴절 유리를 입힌다.
 * @param {HTMLElement} target
 * @param {object} opts
 *   bezel     곡면 구간 폭(px)
 *   scale     굴절 세기(px). 색수차의 기준 배율.
 *   dispersion 색수차 폭(0 이면 끔). 0.14 면 R:1.00 G:0.93 B:0.86
 *   blur      마지막에 먹이는 흐림. 유리는 맑아야 하니 0 에 가깝게.
 *   radius    라운드 반경
 *   power     곡면 프로필 지수
 */
export function attachGlass(target, opts = {}) {
  if (!target || !supportsSvgBackdrop()) return { destroy() {} };

  const bezel = opts.bezel ?? 16;
  const scale = opts.scale ?? 42;
  const dispersion = opts.dispersion ?? 0.14;
  const blur = opts.blur ?? 0.35;
  const radius = opts.radius ?? 28;
  const power = opts.power ?? 2.2;

  const id = `cd-glass-${++seq}`;
  const filter = mk('filter', {
    id,
    x: 0, y: 0, width: '100%', height: '100%',
    filterUnits: 'objectBoundingBox',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  });

  const feImage = mk('feImage', { x: 0, y: 0, result: 'map', preserveAspectRatio: 'none' });
  filter.appendChild(feImage);

  if (dispersion > 0) {
    // 파장이 길수록 덜 꺾인다 → R 이 가장 크게, B 가 가장 작게
    const factors = { R: 1, G: 1 - dispersion / 2, B: 1 - dispersion };
    for (const ch of ['R', 'G', 'B']) {
      filter.appendChild(mk('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'map', scale: (scale * factors[ch]).toFixed(2),
        xChannelSelector: 'R', yChannelSelector: 'G', result: `d${ch}`,
      }));
      filter.appendChild(mk('feColorMatrix', {
        in: `d${ch}`, type: 'matrix', values: ONLY[ch], result: `c${ch}`,
      }));
    }
    // 채널을 다시 더해 색을 복원한다 (배경은 불투명하므로 단순 합으로 충분)
    filter.appendChild(mk('feComposite', {
      in: 'cR', in2: 'cG', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'rg',
    }));
    filter.appendChild(mk('feComposite', {
      in: 'rg', in2: 'cB', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'bent',
    }));
  } else {
    filter.appendChild(mk('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'map', scale,
      xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent',
    }));
  }

  // 유리는 맑다. 계단 현상만 지울 정도로 아주 살짝.
  if (blur > 0) filter.appendChild(mk('feGaussianBlur', { in: 'bent', stdDeviation: blur }));

  host().appendChild(filter);

  let lastKey = '';
  const sync = () => {
    const rect = target.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (!w || !h) return;
    const key = `${w}x${h}`;
    if (key === lastKey) return;
    lastKey = key;
    const url = displacementMap(w, h, radius, bezel, power);
    feImage.setAttribute('width', w);
    feImage.setAttribute('height', h);
    feImage.setAttribute('href', url);
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
  };

  sync();
  target.style.setProperty('--glass-filter', `url(#${id})`);
  document.documentElement.classList.add('glass-svg');

  const ro = new ResizeObserver(sync);
  ro.observe(target);

  return {
    destroy() {
      ro.disconnect();
      filter.remove();
      target.style.removeProperty('--glass-filter');
    },
  };
}
