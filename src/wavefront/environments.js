// Single environment showing where a progressive lens wearer looks at each
// distance — projector screen (distance) · monitor (intermediate) · book (near).
//
// PRIMARY: real photo at `scenes/driving.jpg` (object-fit: cover).
// FALLBACK: procedurally generated office scene (used if photo missing).
//
// Note: id is kept as 'driving' for backward compatibility with code that
// references the env by id; the visible content is now an office scene.

export const ENVIRONMENTS = [
  { id: 'driving', label: '사무실 환경', icon: '🏢', desc: '프로젝터(원) · 모니터(중) · 책(근)' },
];

const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

// Photo source priority:
//   1. localStorage (uploaded via the in-app dropzone — survives reload)
//   2. scenes/{env}.{ext} on disk (manually saved by the user)
//   3. Procedural fallback (always works)
export function getStoredPhoto(env) {
  try { return localStorage.getItem(`wf_scene_${env}`); }
  catch (e) { return null; }
}

export function setStoredPhoto(env, dataUri) {
  try { localStorage.setItem(`wf_scene_${env}`, dataUri); return true; }
  catch (e) { console.error('localStorage set failed:', e); return false; }
}

export function clearStoredPhoto(env) {
  try { localStorage.removeItem(`wf_scene_${env}`); }
  catch (e) {}
}

export function buildEnvironmentScene(env, opts = {}) {
  const { blur = false } = opts;
  const root = document.createElement('div');
  root.style.cssText = 'position: absolute; inset: 0; overflow: hidden;';

  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.style.cssText = `
    position: absolute; inset: 0;
    width: 100%; height: 100%; object-fit: cover;
    filter: ${blur ? 'blur(0.6px) saturate(0.95)' : 'none'};
    user-select: none; -webkit-user-drag: none;
  `;

  const stored = getStoredPhoto(env);
  let attemptIdx = 0;
  function tryNext() {
    if (attemptIdx >= PHOTO_EXTENSIONS.length) {
      img.remove();
      drawFallback(root, blur);
      return;
    }
    img.src = `scenes/${env}.${PHOTO_EXTENSIONS[attemptIdx++]}?v=${Date.now()}`;
  }
  img.onerror = tryNext;
  if (stored) {
    img.src = stored;
    img.onerror = tryNext;  // if data URI corrupt → file system → procedural
  } else {
    tryNext();
  }
  root.appendChild(img);

  return root;
}

function drawFallback(root, blur) {
  if (blur) root.style.filter = 'blur(0.4px) saturate(0.95)';
  drawOfficeFallback(root);
}

// Procedural fallback — simple office scene (3 vertical zones matching
// distance/intermediate/near). Only triggers when scenes/driving.jpg is
// missing — normally the real photo is shown.
function drawOfficeFallback(root) {
  root.innerHTML = `
    <!-- Top: projector screen area (distance) -->
    <div style="position:absolute;left:0;top:0;width:100%;height:35%;
                background:linear-gradient(#d8d6d2 0%, #b9b5ae 100%)"></div>
    <div style="position:absolute;left:25%;top:5%;width:50%;height:22%;
                background:#f5f5f3;border:2px solid #888;border-radius:3px"></div>
    <!-- Middle: desk surface + monitor (intermediate) -->
    <div style="position:absolute;left:0;top:35%;width:100%;height:35%;
                background:linear-gradient(#a89a85 0%, #8a7d68 100%)"></div>
    <div style="position:absolute;left:30%;top:38%;width:40%;height:25%;
                background:#0a0a0a;border:2px solid #1a1a1a;border-radius:4px">
      <div style="position:absolute;inset:6%;background:#f0f0ec"></div>
    </div>
    <!-- Bottom: open book (near) -->
    <div style="position:absolute;left:0;top:70%;width:100%;height:30%;
                background:linear-gradient(#7a6850 0%, #5a4838 100%)"></div>
    <div style="position:absolute;left:15%;top:74%;width:70%;height:24%;
                background:linear-gradient(90deg, #f4ead8 0%, #e8dcc6 50%, #f4ead8 100%);
                border-radius:2px;
                box-shadow: 0 -2px 4px rgba(0,0,0,0.2)"></div>
    <div style="position:absolute;left:50%;top:74%;width:1px;height:24%;
                background:rgba(0,0,0,0.2)"></div>
  `;
}
