/* sw.js — 앱 셸만 캐시한다.
 * 사진·목록·catalog 는 절대 캐시하지 않는다: 드라이브가 진실의 원천이고,
 * 오래된 목록을 보여주면 "사라진 사진" 판정이 틀어진다. */
/* ⚠ 배포할 때마다 이 숫자를 올린다. 안 올리면 iOS 홈 화면 앱이 옛 config.js
   같은 파일을 계속 붙잡고 있어서, 코드를 고쳐도 반영이 안 된 것처럼 보인다.
   특히 스코프처럼 config 에 들어가는 값을 바꿨을 때 증상이 헷갈린다. */
const V = 'fursuitfryday-v4';
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './js/app.js', './js/auth.js', './js/avatar.js',
  './js/config-load.js', './js/demo.js', './js/drive.js',
  './js/friday.js', './js/glass.js', './js/imgutil.js',
  './js/schedule.js', './js/screens.js', './js/screens2.js',
  './js/store.js', './js/suggest.js', './js/thumbcache.js',
  './js/thumbs.js', './js/ui.js',
  './config.js', './icons/icon-180.png', './icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin !== location.origin) return;              // 구글·unavatar 는 통과
  e.respondWith(
    fetch(e.request)
      .then(r => { caches.open(V).then(c => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
