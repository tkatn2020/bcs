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

// Load the scene as a WebGL-uploadable texture source (Image or Canvas).
// Resolution priority mirrors buildEnvironmentScene:
//   1. localStorage uploaded photo  2. scenes/{env}.{ext}  3. procedural canvas
// Returns { source, width, height } — never rejects (always resolves to a
// usable source, falling back to the procedural canvas).
export function loadSceneTexture(env = 'driving') {
  const tryImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });

  const stored = getStoredPhoto(env);
  const candidates = [];
  if (stored) candidates.push(stored);
  for (const ext of PHOTO_EXTENSIONS) candidates.push(`scenes/${env}.${ext}?v=${Date.now()}`);

  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i >= candidates.length) { resolve(officeFallbackTexture()); return; }
      tryImage(candidates[i++]).then(resolve).catch(next);
    };
    next();
  });
}

// Procedural office scene rendered to an offscreen canvas (WebGL texture
// source). Mirrors drawOfficeFallback's 3-zone layout.
function officeFallbackTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 640;
  const ctx = c.getContext('2d');
  // Distance (top) — projector wall
  let g = ctx.createLinearGradient(0, 0, 0, c.height * 0.35);
  g.addColorStop(0, '#d8d6d2'); g.addColorStop(1, '#b9b5ae');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height * 0.35);
  ctx.fillStyle = '#f5f5f3';
  ctx.fillRect(c.width * 0.25, c.height * 0.05, c.width * 0.5, c.height * 0.22);
  // Intermediate (middle) — desk + monitor
  g = ctx.createLinearGradient(0, c.height * 0.35, 0, c.height * 0.70);
  g.addColorStop(0, '#a89a85'); g.addColorStop(1, '#8a7d68');
  ctx.fillStyle = g; ctx.fillRect(0, c.height * 0.35, c.width, c.height * 0.35);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(c.width * 0.30, c.height * 0.38, c.width * 0.4, c.height * 0.25);
  ctx.fillStyle = '#f0f0ec';
  ctx.fillRect(c.width * 0.32, c.height * 0.40, c.width * 0.36, c.height * 0.21);
  // Near (bottom) — open book
  g = ctx.createLinearGradient(0, c.height * 0.70, 0, c.height);
  g.addColorStop(0, '#7a6850'); g.addColorStop(1, '#5a4838');
  ctx.fillStyle = g; ctx.fillRect(0, c.height * 0.70, c.width, c.height * 0.30);
  g = ctx.createLinearGradient(c.width * 0.15, 0, c.width * 0.85, 0);
  g.addColorStop(0, '#f4ead8'); g.addColorStop(0.5, '#e8dcc6'); g.addColorStop(1, '#f4ead8');
  ctx.fillStyle = g;
  ctx.fillRect(c.width * 0.15, c.height * 0.74, c.width * 0.70, c.height * 0.24);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(c.width * 0.5, c.height * 0.74, 1, c.height * 0.24);
  return { source: c, width: c.width, height: c.height };
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
