/* sw.js — 앱 셸만 캐시한다.
 * 사진·목록·catalog 는 절대 캐시하지 않는다: 드라이브가 진실의 원천이고,
 * 오래된 목록을 보여주면 "사라진 사진" 판정이 틀어진다. */
/* ⚠ 배포할 때마다 이 숫자를 올린다. 안 올리면 iOS 홈 화면 앱이 옛 config.js
   같은 파일을 계속 붙잡고 있어서, 코드를 고쳐도 반영이 안 된 것처럼 보인다.
   특히 스코프처럼 config 에 들어가는 값을 바꿨을 때 증상이 헷갈린다. */
const V = 'fursuitfryday-v46';
/* 스플래시 애니메이션은 **버전과 무관한** 캐시에 둔다.
   앱 셸 캐시는 배포마다 이름이 바뀌어 통째로 버려지는데, 133KB 를 배포할
   때마다 다시 받게 할 이유가 없다. 그림이 바뀌면 파일 이름을 바꾸면 된다. */
const MEDIA = 'fursuitfryday-media';
const MEDIA_RE = /\/icons\/splash\.webp$/;
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './js/app.js', './js/auth.js', './js/avatar.js',
  './js/config-load.js', './js/demo.js', './js/drive.js',
  './js/folderpick.js', './js/friday.js', './js/glass.js', './js/i18n.js', './js/imgutil.js',
  './js/schedule.js', './js/screens.js', './js/screens2.js',
  './js/store.js', './js/suggest.js', './js/suits.js', './js/thumbcache.js',
  './js/thumbs.js', './js/ui.js',
  './config.js', './icons/icon-32.png', './icons/icon-180.png', './icons/icon-192.png',
  './icons/splash-poster.webp', './fonts/pyeongchang-peace-bold.woff',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    const old = ks.filter(k => k !== V && k !== MEDIA);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    /* 캐시 우선이라 지금 열려 있는 화면은 옛 코드로 그려졌다.
       옛 캐시를 지운 경우에만(=처음 설치가 아닌 경우) 알려 준다. */
    if (old.length) {
      const cs = await self.clients.matchAll({ type: 'window' });
      cs.forEach(c => c.postMessage({ type: 'updated', version: V }));
    }
  })());
});
/* 캐시 우선. 캐시에 있으면 **기다리지 않고** 준다.
 *
 * 예전에는 네트워크를 먼저 기다렸다(network-first). 앱 셸이 파일 스무 개라
 * 열 때마다 스무 번 왕복했고, 그 동안 화면은 흰 종이였다. 첫 페인트가
 * 5.6초였던 이유의 절반이 이것이다.
 *
 * 새 파일은 뒤에서 받아 캐시만 갈아 둔다 — 다음에 열 때 새 코드가 뜬다.
 * 그래서 배포하고 한 번 더 열어야 반영된다. 아래 activate 에서 그 사실을
 * 화면에 알려 준다.
 */
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin !== location.origin) return;              // 구글·unavatar 는 통과

  /* 스플래시 애니메이션만 따로. 한 번 받으면 배포를 건너서도 남는다. */
  if (MEDIA_RE.test(u.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(MEDIA);
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request).catch(() => null);
      if (r && r.ok) c.put(e.request, r.clone());
      return r || Response.error();
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request)
      .then(r => {
        // 200 이 아닌 것을 캐시에 넣으면 다음에 그 오류가 그대로 나온다
        if (r && r.ok) caches.open(V).then(c => c.put(e.request, r.clone()));
        return r;
      })
      .catch(() => null);
    return cached || (await fresh) || Response.error();
  })());
});
