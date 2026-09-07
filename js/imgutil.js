/* imgutil.js — 이미지를 작은 정사각 data URL 로 만든다
 *
 * 행사 로고와 프로필 아바타가 같은 처리를 쓴다. catalog.json 에 base64 로
 * 들어가므로 반드시 줄여서 넣는다 — 원본 그대로 넣으면 카탈로그가 수 MB 로
 * 불어난다. 128px WebP 면 장당 4~8KB 라 행사 수십 개도 부담이 없다.
 */

/**
 * @param {Blob|File} src
 * @param {number} size 한 변 픽셀
 * @returns {Promise<string>} data URL
 */
export async function squareDataURL(src, size = 128) {
  const bmp = await createImageBitmap(src);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2;
  const sy = (bmp.height - side) / 2;

  let out;
  if (typeof OffscreenCanvas === 'function') {
    const c = new OffscreenCanvas(size, size);
    c.getContext('2d').drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    out = await c.convertToBlob({ type: 'image/webp', quality: 0.85 })
      .catch(() => c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
  } else {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    out = await new Promise(r => c.toBlob(r, 'image/webp', 0.85));
    if (!out) out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  }
  bmp.close?.();
  return toDataURL(out);
}

export const toDataURL = blob => new Promise((ok, no) => {
  const fr = new FileReader();
  fr.onload = () => ok(fr.result);
  fr.onerror = no;
  fr.readAsDataURL(blob);
});

/**
 * 파일 하나를 고르게 한다. iOS 는 사진 보관함·카메라·파일을 함께 띄운다.
 * @returns {Promise<File|null>}
 */
export function pickImage() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(inp);
    let done = false;
    const finish = v => { if (done) return; done = true; inp.remove(); resolve(v); };
    inp.addEventListener('change', () => finish(inp.files && inp.files[0] ? inp.files[0] : null));
    // 취소는 이벤트가 없는 브라우저가 있어, 창이 다시 활성화되면 정리한다
    inp.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', () => setTimeout(() => finish(null), 800), { once: true });
    inp.click();
  });
}
