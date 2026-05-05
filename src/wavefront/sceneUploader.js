// In-app drag-drop / file-picker uploader for the 3 environment photos.
// Saves images to localStorage as data URIs (resized to ≤1280×720 jpeg
// to stay under the per-origin localStorage budget).

import { ENVIRONMENTS, getStoredPhoto, setStoredPhoto, clearStoredPhoto } from './environments.js';

const MAX_W = 1280;
const MAX_H = 720;
const QUALITY = 0.85;

export function mountSceneUploader(root) {
  root.innerHTML = '';
  root.className = 'photo-grid';

  const slots = {};
  ENVIRONMENTS.forEach(env => {
    const slot = createSlot(env);
    slots[env.id] = slot;
    root.appendChild(slot);
  });

  function refresh(envId) {
    const slot = slots[envId];
    const data = getStoredPhoto(envId);
    const thumb = slot.querySelector('.ps-thumb');
    const clear = slot.querySelector('.ps-clear');
    if (data) {
      thumb.style.backgroundImage = `url('${data}')`;
      thumb.classList.add('has-photo');
      clear.style.display = '';
    } else {
      thumb.style.backgroundImage = 'none';
      thumb.classList.remove('has-photo');
      clear.style.display = 'none';
    }
  }

  function createSlot(env) {
    const stored = getStoredPhoto(env.id);
    const slot = document.createElement('div');
    slot.className = 'photo-slot';
    slot.dataset.env = env.id;
    slot.innerHTML = `
      <div class="ps-thumb${stored ? ' has-photo' : ''}"
           style="${stored ? `background-image:url('${stored}')` : ''}">
        <span class="ps-icon">${env.icon}</span>
        <span class="ps-cta">사진 드롭<br>또는 클릭</span>
        <button class="ps-clear" style="${stored ? '' : 'display:none'}" title="제거">✕</button>
      </div>
      <div class="ps-label">${env.label.replace(' 환경', '')}</div>
      <input type="file" class="ps-input" accept="image/*" hidden>
    `;

    const fileInput = slot.querySelector('.ps-input');
    const thumb = slot.querySelector('.ps-thumb');
    const clearBtn = slot.querySelector('.ps-clear');

    thumb.addEventListener('click', e => {
      if (e.target === clearBtn) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) processFile(env.id, file).then(() => { refresh(env.id); notifyChange(); });
      fileInput.value = '';
    });

    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(env.id, file).then(() => { refresh(env.id); notifyChange(); });
    });

    clearBtn.addEventListener('click', e => {
      e.stopPropagation();
      clearStoredPhoto(env.id);
      refresh(env.id);
      notifyChange();
    });

    return slot;
  }

  return { refresh: () => ENVIRONMENTS.forEach(e => refresh(e.id)) };
}

async function processFile(envId, file) {
  if (!file.type.startsWith('image/')) {
    alert('이미지 파일만 업로드 가능합니다');
    return;
  }
  const dataUri = await readAsDataURL(file);
  const resized = await resizeImage(dataUri, MAX_W, MAX_H, QUALITY);
  const ok = setStoredPhoto(envId, resized);
  if (!ok) alert('저장 실패 — 브라우저 저장공간 부족 가능. 다른 사진 제거 후 시도하세요.');
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function resizeImage(srcDataUri, maxW, maxH, quality) {
  return new Promise(resolve => {
    const im = new Image();
    im.onload = () => {
      const ratio = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight, 1);
      const w = Math.round(im.naturalWidth * ratio);
      const h = Math.round(im.naturalHeight * ratio);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    im.onerror = () => resolve(srcDataUri);  // fallback to original on resize failure
    im.src = srcDataUri;
  });
}

function notifyChange() {
  window.dispatchEvent(new CustomEvent('wf:photos-changed'));
}
