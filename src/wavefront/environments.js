// Three real-world environments showing where a progressive lens wearer
// looks at each distance — driving / outdoor / indoor.
//
// PRIMARY: real photo at `scenes/{id}.jpg` (object-fit: cover).
// FALLBACK: procedurally generated scene from CSS gradients + shapes
//           — used automatically if the photo file is missing.

export const ENVIRONMENTS = [
  { id: 'driving', label: '운전 환경',     icon: '🚗', desc: '도로 표지판(원) · 대시보드(중) · 휴대폰(근)' },
  { id: 'outdoor', label: '야외활동 환경', icon: '🏞️', desc: '풍경(원) · 산책로/강(중) · 운동앱(근)' },
  { id: 'indoor',  label: '실내 환경',     icon: '🏠', desc: 'TV/장식(원·중) · 휴대폰·태블릿(근)' },
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
      drawFallback(root, env, blur);
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

function drawFallback(root, env, blur) {
  if (blur) root.style.filter = 'blur(0.4px) saturate(0.95)';
  if (env === 'driving') drawDriving(root);
  else if (env === 'outdoor') drawOutdoor(root);
  else drawIndoor(root);
}

// ─────────────────────────────────────────────────────────────────
// Procedural fallbacks (used only when scenes/*.jpg is absent)
// ─────────────────────────────────────────────────────────────────
function drawDriving(root) {
  root.innerHTML = `
    <div style="position:absolute;left:0;top:0;width:100%;height:55%;
                background:linear-gradient(#9ec0d9 0%, #c9d8e3 60%, #b9b39c 100%)"></div>
    <div style="position:absolute;left:0;top:18%;width:22%;height:38%;
                background:linear-gradient(90deg, rgba(40,55,30,0.7), rgba(40,55,30,0));
                clip-path:polygon(0 30%,8% 18%,16% 26%,22% 12%,30% 24%,38% 14%,46% 28%,56% 18%,68% 26%,80% 16%,90% 26%,100% 22%,100% 100%,0 100%)"></div>
    <div style="position:absolute;right:0;top:18%;width:25%;height:40%;
                background:linear-gradient(-90deg, rgba(40,55,30,0.7), rgba(40,55,30,0));
                clip-path:polygon(0 22%,12% 26%,22% 16%,32% 26%,42% 18%,56% 28%,68% 14%,82% 26%,90% 18%,100% 30%,100% 100%,0 100%)"></div>
    <div style="position:absolute;left:0;top:48%;width:100%;height:30%;
                background:linear-gradient(#7a8390 0%, #4f5660 100%);
                clip-path:polygon(36% 0%, 64% 0%, 100% 100%, 0% 100%)"></div>
    <div style="position:absolute;left:38%;top:8%;width:24%;height:10%;
                background:#2c6f3f;border:1.5px solid #1d4527;border-radius:3px;
                color:white;font-weight:700;line-height:1.2;text-align:center;
                display:flex;flex-direction:column;justify-content:center;font-size:7px">
      <div>SEOUL  65 km</div><div style="margin-top:1px">경기도  12 km</div>
    </div>
    <div style="position:absolute;left:8%;bottom:-8%;width:50%;height:42%;
                background:#0d0d0d;border-radius:50%;border:6px solid #1f1f1f"></div>
    <div style="position:absolute;left:34%;bottom:18%;width:18%;height:13%;
                background:#0a0a0a;border-radius:5px;color:white;text-align:center;padding-top:2px">
      <div style="font-size:13px;font-weight:800;font-family:ui-monospace,monospace">78</div>
      <div style="font-size:5px;color:#888">km/h</div>
    </div>
    <div style="position:absolute;right:3%;bottom:8%;width:30%;height:32%;
                background:linear-gradient(135deg, #1a3a4a 0%, #0f1c30 100%);border-radius:5px"></div>
    <div style="position:absolute;left:48%;bottom:1%;width:18%;height:42%;
                background:#0f0f0f;border-radius:9px"></div>
  `;
}

function drawOutdoor(root) {
  root.innerHTML = `
    <div style="position:absolute;left:0;top:0;width:100%;height:42%;
                background:linear-gradient(#7eb6e0 0%, #c5dcec 100%)"></div>
    <div style="position:absolute;left:0;top:18%;width:48%;height:60%;
                background:linear-gradient(135deg,#3d6f3a 0%,#1f3d20 60%,#3d6f3a 100%);
                clip-path:polygon(0 20%,8% 12%,18% 22%,28% 8%,38% 24%,46% 14%,54% 28%,60% 18%,72% 30%,82% 22%,92% 32%,100% 28%,100% 100%,0 100%)"></div>
    <div style="position:absolute;left:55%;top:38%;width:45%;height:48%;
                background:linear-gradient(225deg,#3d6f3a 0%,#1f3d20 60%,#3d6f3a 100%);
                clip-path:polygon(0 30%,12% 22%,22% 32%,32% 18%,42% 30%,52% 22%,64% 32%,76% 24%,88% 32%,100% 28%,100% 100%,0 100%)"></div>
    <div style="position:absolute;right:-5%;top:42%;width:55%;height:42%;
                background:linear-gradient(#8aabc2 0%, #5a8aa8 100%);
                clip-path:polygon(8% 0%,40% 0%,75% 100%,0 100%)"></div>
    <div style="position:absolute;left:0;bottom:0;width:100%;height:48%;
                background:linear-gradient(#7d7568 0%, #5a554a 100%);
                clip-path:polygon(38% 0%, 56% 0%, 100% 100%, 0% 100%)"></div>
    <div style="position:absolute;left:35%;bottom:5%;width:30%;height:55%;
                background:#0a0a0a;border-radius:14px"></div>
  `;
}

function drawIndoor(root) {
  root.innerHTML = `
    <div style="position:absolute;left:0;top:0;width:100%;height:62%;
                background:linear-gradient(#e8ddc8 0%, #c8b89a 100%)"></div>
    <div style="position:absolute;left:0;top:62%;width:100%;height:38%;
                background:linear-gradient(#9c7d5a 0%, #5d4630 100%)"></div>
    <div style="position:absolute;left:21%;top:14%;width:58%;height:38%;
                background:#0a0a0a;border:3px solid #1a1a1a;border-radius:3px">
      <div style="position:absolute;inset:3%;background:linear-gradient(180deg,#8db8d4 0%,#d4be7a 50%,#8a6d44 100%)"></div>
    </div>
    <div style="position:absolute;left:18%;top:55%;width:64%;height:9%;
                background:linear-gradient(180deg,#7a5a40 0%,#5a3e2a 100%);border-radius:2px"></div>
    <div style="position:absolute;left:0;bottom:0;width:100%;height:30%;
                background:linear-gradient(180deg,#1a2535 0%,#0a131e 100%);
                clip-path:polygon(0 30%, 100% 20%, 100% 100%, 0% 100%)"></div>
    <div style="position:absolute;left:35%;bottom:-2%;width:30%;height:48%;
                background:#0a0a0a;border-radius:12px"></div>
  `;
}
