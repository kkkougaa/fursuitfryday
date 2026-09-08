/* drive.js — Drive API 얇은 래퍼 + Google Picker
 *
 * 규칙: 사진 파일은 읽기만 한다. 쓰기는 catalog.json 한 파일에만.
 * 이 파일에 사진을 수정/삭제하는 함수는 존재하지 않는다.
 */
import { CONFIG } from './config-load.js';
import { api, accessToken } from './auth.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CATALOG_NAME = 'fursuitfryday.catalog.json';
const CATALOG_LEGACY = 'cutdaejang.catalog.json';   // 예전 이름도 찾아본다

/* 목록에서 받아올 필드. fields 를 안 주면 id/name/mimeType 만 온다 — 최대 함정. */
const PHOTO_FIELDS = [
  'id', 'name', 'size', 'md5Checksum', 'createdTime', 'modifiedTime',
  'thumbnailLink', 'parents', 'trashed',
  'imageMediaMetadata(width,height,rotation,time,cameraMake,cameraModel,lens,exposureTime,aperture,isoSpeed,location)',
].join(',');

const IMAGE_Q = "(mimeType contains 'image/')";

/** 폴더 하위(재귀)의 이미지 전부. 페이지네이션은 1000개 단위. */
/**
 * 고른 폴더 아래의 이미지를 모두 모은다. 하위 폴더도 내려간다.
 *
 * 폴더 이름과 부모도 같이 돌려준다. 어차피 모든 폴더를 방문하니 **추가 요청이
 * 없고**, 이게 있으면 "폴더 이름 = 행사 이름" 으로 정리해 둔 사람의 첫 분류를
 * 제안으로 대신할 수 있다. 예전에는 폴더를 큐에 넣고 이름을 버렸다.
 *
 * @returns {Promise<{files: object[], folders: object[]}>}
 */
export async function listImages(folderIds, onProgress) {
  const seen = new Map();
  const folders = new Map();
  const queue = [...folderIds];
  const done = new Set();

  while (queue.length) {
    const id = queue.shift();
    if (done.has(id)) continue;
    done.add(id);

    let pageToken = '';
    do {
      // 이미지와 하위 폴더만 달라고 못 박는다. drive.readonly 로 바뀌면서
      // 폴더 안의 모든 파일이 보이게 됐으므로, 서버에서 걸러야 응답이 가볍다.
      const q = new URLSearchParams({
        q: `'${id}' in parents and trashed = false`
           + ` and (${IMAGE_Q} or mimeType = 'application/vnd.google-apps.folder')`,
        fields: `nextPageToken,files(${PHOTO_FIELDS},mimeType)`,
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) q.set('pageToken', pageToken);

      const res = await api(`${FILES}?${q}`);
      const data = await res.json();

      for (const f of data.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          queue.push(f.id);
          folders.set(f.id, { id: f.id, name: f.name, parent: (f.parents || [])[0] || null });
        } else if (f.mimeType?.startsWith('image/')) {
          seen.set(f.id, f);
        }
      }
      pageToken = data.nextPageToken || '';
      onProgress?.(seen.size);
    } while (pageToken);
  }
  return { files: [...seen.values()], folders: [...folders.values()] };
}

/** 폴더 이름 등 단건 조회 */
export async function getFile(id, fields = 'id,name,mimeType') {
  const res = await api(`${FILES}/${id}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`);
  return res.json();
}

/**
 * 썸네일을 **blob 그대로** 준다.
 *
 * ── 인증에 대해 (여기서 한 번 크게 틀렸다) ──────────────────────
 * thumbnailLink 는 lh3.googleusercontent.com 을 가리킨다. 한때 이 링크는
 * 서명돼 있으니 헤더 없이 받으면 CORS 프리플라이트를 피할 수 있다고 보고
 * 그냥 fetch 했는데, **전부 실패했다.** 이 링크는 공개가 아니라서 토큰이든
 * 구글 쿠키든 인증이 있어야 한다. 원래 코드처럼 api() 로 Bearer 를 붙여
 * 받는 것이 맞다.
 *
 * 그래도 헤더 없는 요청을 뒤에 남겨 둔다. 계정·브라우저에 따라 Bearer
 * 요청이 CORS 로 막히는 경우가 실제로 보고돼 있어서, 그때는 쿠키로 받는
 * 쪽이 통한다. 둘 다 실패했을 때만 포기한다.
 *
 * blob URL 이 아니라 blob 을 돌려주는 것은 그대로 둔다. URL 을 만들어
 * 넘기면 받는 쪽이 다시 fetch 해서 같은 이미지가 메모리에 두 벌 생긴다.
 *
 * @param {boolean} allowOriginal 썸네일이 없을 때 원본을 받을지.
 *   원본은 장당 수 MB 라 그리드·미리 받기에서는 켜지 않는다.
 */
export async function thumbBlob(file, size = 400, { allowOriginal = false } = {}) {
  if (file.thumbnailLink) {
    const link = file.thumbnailLink.replace(/=s\d+(-c)?$/, `=s${size}`);

    // 1) 토큰을 붙여서 — 원래부터 동작하던 방식
    try {
      const res = await api(link);
      if (res.ok) return res.blob();
    } catch { /* CORS·만료 — 아래로 */ }

    // 2) 구글 세션 쿠키에 기대서
    try {
      const res = await fetch(link, { credentials: 'include' });
      if (res.ok) return res.blob();
    } catch { /* 아래로 */ }
  }

  if (!allowOriginal) return null;
  const res = await api(`${FILES}/${file.id}?alt=media`);
  return res.blob();
}

/* ---------------- catalog.json ---------------- */

export async function findCatalog() {
  const q = new URLSearchParams({
    q: `(name = '${CATALOG_NAME}' or name = '${CATALOG_LEGACY}') and trashed = false`,
    fields: 'files(id,name,version,modifiedTime,size)',
    pageSize: '10',
    spaces: 'drive',
  });
  const res = await api(`${FILES}?${q}`);
  const { files = [] } = await res.json();
  // 새 이름을 우선한다
  return files.find(f => f.name === CATALOG_NAME) || files[0] || null;
}

export async function readCatalog(id) {
  const res = await api(`${FILES}/${id}?alt=media`);
  return res.json();
}

export async function createCatalog(data) {
  const meta = { name: CATALOG_NAME, mimeType: 'application/json' };
  const body = multipart(meta, JSON.stringify(data));
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id,version`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${BOUNDARY}` },
    body,
  });
  return res.json();
}

/* ---------------- 백업 ----------------
 *
 * 기록 전부가 catalog 한 파일에 들어 있다. 병합이 어긋나거나 실수로 지우면
 * 되돌릴 방법이 없었다. 그래서 날짜별 사본을 드라이브에 남긴다.
 * 사본도 이 앱이 만든 파일이라 drive.file 스코프로 충분하다.
 */
const BACKUP_PREFIX = 'fursuitfryday.backup.';

export async function createBackup(data, stamp) {
  const meta = { name: `${BACKUP_PREFIX}${stamp}.json`, mimeType: 'application/json' };
  const body = multipart(meta, JSON.stringify(data));
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${BOUNDARY}` },
    body,
  });
  return res.json();
}

/** 최신 사본이 먼저. 이름에 날짜가 들어 있어 이름 역순이 곧 최신순이다. */
export async function listBackups() {
  const q = new URLSearchParams({
    q: `name contains '${BACKUP_PREFIX}' and trashed = false`,
    fields: 'files(id,name,size,modifiedTime)',
    orderBy: 'name desc',
    pageSize: '30',
    spaces: 'drive',
  });
  const res = await api(`${FILES}?${q}`);
  const { files = [] } = await res.json();
  return files;
}

export async function deleteFile(id) {
  await api(`${FILES}/${id}`, { method: 'DELETE' });
}

/**
 * catalog 저장. baseVersion 이 서버와 다르면 충돌로 알린다.
 * (다른 기기에서 먼저 저장한 경우 — 호출자가 병합 후 다시 시도)
 */
export async function writeCatalog(id, data, baseVersion) {
  if (baseVersion != null) {
    const cur = await getFile(id, 'version');
    if (String(cur.version) !== String(baseVersion)) {
      throw Object.assign(new Error('conflict'), { conflict: true, serverVersion: cur.version });
    }
  }
  const res = await api(`${UPLOAD}/${id}?uploadType=media&fields=id,version`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

const BOUNDARY = 'cdjb' + Math.random().toString(36).slice(2);
function multipart(meta, body) {
  return [
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8', '',
    JSON.stringify(meta), '',
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8', '',
    body, '',
    `--${BOUNDARY}--`, '',
  ].join('\r\n');
}

/* ---------------- 폴더 목록 (자체 선택기용) ---------------- */

const FOLDER_Q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";

/** 한 폴더 안의 하위 폴더. parentId 를 안 주면 내 드라이브 최상위. */
export async function listFolders(parentId = 'root') {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      q: `'${parentId}' in parents and ${FOLDER_Q}`,
      fields: 'nextPageToken,files(id,name)',
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await (await api(`${FILES}?${q}`)).json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

/**
 * 이름으로 폴더를 찾는다. 위치를 가리지 않으므로 깊이 묻힌 폴더도 걸린다 —
 * 게이트 가이드가 "목록에 안 보이면 검색하면 나옵니다" 라고 약속한 그것이다.
 */
export async function searchFolders(text) {
  /* 폴더 이름에 아포스트로피가 있으면 드라이브 질의가 깨진다.
     백슬래시로 감싸 넘긴다 — 예전 코드는 ' 를 ' 로 바꿔 아무 일도 안 했다. */
  const term = String(text || '').trim().replace(/'/g, "\\'");
  if (!term) return [];
  const q = new URLSearchParams({
    q: `${FOLDER_Q} and name contains '${term}'`,
    fields: 'files(id,name,parents)',
    pageSize: '80',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const data = await (await api(`${FILES}?${q}`)).json();
  return data.files || [];
}

/** 빵부스러기용 이름. 최상위(root)는 따로 부르지 않는다. */
export async function folderName(id) {
  const data = await (await api(`${FILES}/${id}?fields=id,name&supportsAllDrives=true`)).json();
  return data.name || '';
}

/* ---------------- Google Picker ---------------- */

let pickerReady = null;

function loadPicker() {
  if (pickerReady) return pickerReady;
  pickerReady = new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => window.gapi.load('picker', { callback: ok, onerror: no });
    s.onerror = no;
    document.head.appendChild(s);
  });
  return pickerReady;
}

/**
 * 폴더를 고른다. drive.file 스코프에서는 여기서 고른 폴더에만 접근 권한이 생긴다.
 * @returns {Promise<Array<{id:string,name:string}>>}
 */
export async function pickFolders() {
  await loadPicker();
  const g = window.google.picker;
  return new Promise(resolve => {
    /* 목록 모양으로 띄운다. 기본은 격자인데 폰 폭에서는 칸이 두 개밖에
       안 들어가 폴더 이름이 잘린다. 목록이면 이름을 끝까지 읽을 수 있다. */
    const view = new g.DocsView(g.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');
    if (g.DocsViewMode && view.setMode) view.setMode(g.DocsViewMode.LIST);

    /* 피커는 기본으로 데스크톱 크기의 대화상자를 화면 가운데 띄운다.
       폰에서는 화면을 꽉 채우게 크기를 직접 준다.
       ※ 왼쪽 탐색 패널(내 드라이브 / 공유 항목 / 최근)은 그대로 둔다.
         Feature.NAV_HIDDEN 으로 지울 수 있고 그러면 훨씬 앱처럼 보이지만,
         공유받은 폴더로 갈 길이 함께 사라진다. */
    const W = Math.min(window.innerWidth || 400, 1051);
    const H = Math.min(window.innerHeight || 700, 650);

    new g.PickerBuilder()
      .setOAuthToken(accessToken())
      .setDeveloperKey(CONFIG.API_KEY)
      .setAppId(CONFIG.CLIENT_ID.split('-')[0])
      .setSize(W, H)
      .addView(view)
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .enableFeature(g.Feature.SUPPORT_DRIVES)
      .setCallback(d => {
        if (d.action === g.Action.PICKED) {
          resolve((d.docs || []).map(x => ({ id: x.id, name: x.name })));
        } else if (d.action === g.Action.CANCEL) {
          resolve([]);
        }
      })
      .build()
      .setVisible(true);
  });
}
