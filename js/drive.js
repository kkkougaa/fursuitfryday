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
export async function listImages(folderIds, onProgress) {
  const seen = new Map();
  const queue = [...folderIds];
  const done = new Set();

  while (queue.length) {
    const id = queue.shift();
    if (done.has(id)) continue;
    done.add(id);

    let pageToken = '';
    do {
      const q = new URLSearchParams({
        q: `'${id}' in parents and trashed = false`,
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
        } else if (f.mimeType?.startsWith('image/')) {
          seen.set(f.id, f);
        }
      }
      pageToken = data.nextPageToken || '';
      onProgress?.(seen.size);
    } while (pageToken);
  }
  return [...seen.values()];
}

/** 폴더 이름 등 단건 조회 */
export async function getFile(id, fields = 'id,name,mimeType') {
  const res = await api(`${FILES}/${id}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`);
  return res.json();
}

/** 썸네일을 blob URL 로. thumbnailLink 는 수명이 짧으니 저장하지 말고 그때그때 쓴다. */
export async function thumbBlob(file, size = 400) {
  const link = file.thumbnailLink
    ? file.thumbnailLink.replace(/=s\d+(-c)?$/, `=s${size}`)
    : `${FILES}/${file.id}?alt=media`;
  const res = await api(link);
  return URL.createObjectURL(await res.blob());
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
    const view = new g.DocsView(g.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    new g.PickerBuilder()
      .setOAuthToken(accessToken())
      .setDeveloperKey(CONFIG.API_KEY)
      .setAppId(CONFIG.CLIENT_ID.split('-')[0])
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
