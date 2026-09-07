/* sw.js — 앱 셸만 캐시한다.
 * 사진·목록·catalog 는 절대 캐시하지 않는다: 드라이브가 진실의 원천이고,
 * 오래된 목록을 보여주면 "사라진 사진" 판정이 틀어진다. */
/* 배포할 때마다 올린다. 네트워크 우선이라 치명적이진 않지만,
   오프라인 셸이 옛 파일에 묶이지 않게 한다. */
const V = 'fursuitfryday-v1';
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
