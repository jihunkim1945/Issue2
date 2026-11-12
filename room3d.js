/* =============================================================
   WATCHMAN — ISSUE 02 — room3d.js
   The CCTV room as a curved wall of screens (150° of a circle), built with Three.js.

   You stand in the middle of the room.
     drag            look along the wall (stops at its ends), a little up/down
     scroll / pinch  zoom
     hover           read a feed's metadata
     click           open the feed (same viewer as the flat wall)

   It reuses SCENES, CAMS, fillerCam, camMeta, Tip, Viewer … from script.js.
   If this file can't load (no WebGL, offline, or index.html opened as file://)
   the flat grid from script.js is shown instead — nothing breaks.

   OFFLINE: download three.module.js (same version) into assets/vendor/
   and change the import line below to './assets/vendor/three.module.js'.
   ============================================================= */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/* ---------- settings you may want to tweak ---------- */
const ROOM = {
  radius: 9,                 // distance from you to the screens
  arc: 150,                  // how far the wall curves round you, in degrees (360 = all the way round)
  cols: 17, rows: 8,         // screens across the arc / screens high   (phones: 11 × 7)
  gap: .03,                  // space between monitors (0–1 of a monitor)
  crt: true,                 // analog CRT monitors (housings, soft glowing picture, scanlines) — false = flat digital screens
  glow: .38,                 // CRT bloom (0 = none)
  scanlines: .28,            // darkness of the scanlines (0 = none)
  soften: .7,                // CRT softness (0 = sharp, 1 = very soft)
  brightness: 1.2,           // > 1 blows the feeds out like old CCTV
  deadScreens: .06,          // share of black, switched-off screens
  tilesPerFrame: 12,         // how many feeds are redrawn per frame (lower = choppier + faster)
  grain: .2,                 // noise on each screen (0 = clean)
  drift: .0006,              // slow automatic pan when nobody touches the mouse
};

// every feed is drawn into one big canvas (an "atlas"); each screen shows one tile of it.
// Tiles are 256×192 (sharp) — or 128×96 on devices that can't hold a 4096px texture.
let TILE_W = 256, TILE_H = 192;
const ATLAS_COLS = 16, ATLAS_ROWS = 12;
const BLACK_TILE = ATLAS_COLS * ATLAS_ROWS - 1;          // never drawn → switched-off screen

// small offscreen canvases reused for the CRT soften / bloom passes
let _crt = null;
function crtScratch() {
  if (_crt) return _crt;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; return x; };
  return (_crt = { soft: mk(TILE_W, TILE_H), glow: mk(24, 18) });
}

/* ---------- an old CRT monitor: cabinet + front bezel (drawn once, shared by every monitor) ---------- */
function makeHousing(hw, hh, sw, sh) {
  const PX = 320, W = PX, H = Math.round(PX * hh / hw);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  // plastic body
  const body = x.createLinearGradient(0, 0, 0, H);
  body.addColorStop(0, '#3b3b39'); body.addColorStop(.12, '#2a2a29'); body.addColorStop(1, '#161616');
  x.fillStyle = body; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},.05)`; x.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
  x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 2; x.strokeRect(1, 1, W - 2, H - 2);
  // the tube opening (rounded, with a dark inner lip)
  const sx = (W - W * sw / hw) / 2, sy = H * (sh * .1 / hh), swp = W * sw / hw, shp = H * sh / hh, rad = swp * .1;
  const hole = () => { x.beginPath(); x.roundRect(sx, sy, swp, shp, rad); };
  x.lineWidth = 10; x.strokeStyle = '#060606'; hole(); x.stroke();
  x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.roundRect(sx - 7, sy - 7, swp + 14, shp + 14, rad + 6); x.stroke();
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000'; hole(); x.fill(); x.globalCompositeOperation = 'source-over';   // cut the hole fully
  // control strip: vents on the left, a small light, two knobs on the right
  const cy = sy + shp + (H - sy - shp) / 2;
  x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, sy + shp + 8, W, 1);
  x.fillStyle = '#0b0b0b';
  for (let i = 0; i < 10; i++) x.fillRect(sx + i * 9, cy - 5, 5, 10);
  x.fillStyle = 'rgba(255,255,255,.75)'; x.beginPath(); x.arc(W * .52, cy, 2.2, 0, Math.PI * 2); x.fill();
  [W * .78, W * .88].forEach(kx => {
    const kg = x.createRadialGradient(kx - 2, cy - 2, 1, kx, cy, 8);
    kg.addColorStop(0, '#6a6a68'); kg.addColorStop(1, '#141414');
    x.fillStyle = kg; x.beginPath(); x.arc(kx, cy, 7, 0, Math.PI * 2); x.fill();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const depth = hw * .9;
  return {
    face: new THREE.PlaneGeometry(hw, hh),
    faceMat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: .5 }),
    box: new THREE.BoxGeometry(hw * .98, hh * .98, depth),
    boxMat: [0x161616, 0x161616, 0x222221, 0x0c0c0c, 0x111111, 0x111111].map(col => new THREE.MeshBasicMaterial({ color: col })),
    depth,
  };
}

const Room3D = {
  mounted: false,

  mount(stage) {
    if (this.mounted) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch (e) { console.warn('WebGL not available — using the flat wall', e); return; }
    this.mounted = true;
    this.stage = stage;
    stage.classList.add('has-3d');
    const hint = stage.querySelector('.hud-hint');
    if (hint) hint.textContent = 'DRAG TO LOOK AROUND / SCROLL TO ZOOM / CLICK A FEED TO ENLARGE';

    const small = innerWidth < 700;
    const R = ROOM.radius, COLS = small ? 11 : ROOM.cols, ROWS = small ? 7 : ROOM.rows;
    const ARC = ROOM.arc * Math.PI / 180, TH0 = Math.PI - ARC / 2;     // the wall is centred in front of you (θ = π)

    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    if (renderer.capabilities.maxTextureSize < TILE_W * ATLAS_COLS) { TILE_W = 128; TILE_H = 96; }
    renderer.domElement.className = 'room3d';
    stage.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(70, 1, .1, 100);
    this.renderer = renderer; this.camera = camera; this.scene = scene;

    /* ---------- the feed atlas ---------- */
    const atlas = document.createElement('canvas');
    atlas.width = TILE_W * ATLAS_COLS; atlas.height = TILE_H * ATLAS_ROWS;
    const actx = atlas.getContext('2d');
    this.atlas = atlas;                                  // (handy for debugging: Room3D.atlas)
    actx.fillStyle = '#000'; actx.fillRect(0, 0, atlas.width, atlas.height);
    const tex = new THREE.CanvasTexture(atlas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;                         // (rebuilding mipmaps every frame is far too slow)
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();   // screens seen at an angle stay crisp

    // tile 0…13 = the named cameras in CAMS, the rest = generic city feeds
    const tiles = [];
    for (let k = 0; k < BLACK_TILE; k++) {
      const cam = k < CAMS.length ? CAMS[k] : fillerCam(k - CAMS.length);
      tiles.push({ cam, p: params(cam.seed || k + 1), off: Math.random() * 100 });
    }

    /* ---------- the screens ---------- */
    const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
    mat.color.setScalar(ROOM.brightness);
    // one monitor = a CRT housing with the screen set into it (bezel on top/sides, control strip below)
    const cellW = (ARC * R) / COLS;
    const hw = cellW * (1 - ROOM.gap);
    const sw = ROOM.crt ? hw * .82 : hw, sh = sw * .75;
    const hh = ROOM.crt ? sh * 1.36 : sh, rowPitch = hh * (1 + ROOM.gap);
    const housing = ROOM.crt ? makeHousing(hw, hh, sw, sh) : null;
    // scanlines: a separate glass layer with its own small, mipmapped texture
    // (far-away screens average it into an even dimming instead of flickering)
    let scanGeo, scanMat;
    if (ROOM.crt && ROOM.scanlines) {
      const sc = document.createElement('canvas'); sc.width = 4; sc.height = 4;
      const sx = sc.getContext('2d'); sx.fillStyle = `rgba(0,0,0,${ROOM.scanlines * 2})`; sx.fillRect(0, 0, 4, 1);
      const st = new THREE.CanvasTexture(sc);
      st.wrapS = st.wrapT = THREE.RepeatWrapping; st.repeat.set(1, 72);
      st.minFilter = THREE.LinearMipmapLinearFilter; st.anisotropy = renderer.capabilities.getMaxAnisotropy();
      scanGeo = new THREE.PlaneGeometry(sw, sh);
      scanMat = new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false });
    }
    this.geo = { R, COLS, ROWS, rowPitch, ARC };

    // named cameras go in front of you (θ = π), the rest fill the circle
    const slots = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) slots.push({ r, c });
    const front = s => Math.abs(TH0 + (s.c + .5) / COLS * ARC - Math.PI) + Math.abs(s.r - (ROWS - 1) / 2) * .25;
    slots.sort((a, b) => front(a) - front(b));
    const rnd = seeded(404);
    slots.forEach((s, k) => {
      if (k < CAMS.length * 2) s.tile = k % 2 === 0 ? k / 2 : CAMS.length + Math.floor(rnd() * (BLACK_TILE - CAMS.length));
      else s.tile = rnd() < ROOM.deadScreens ? BLACK_TILE : CAMS.length + Math.floor(rnd() * (BLACK_TILE - CAMS.length));
    });

    // the camera you are looking for (cam.hide) is moved far out to the edge of the wall
    const hideIdx = CAMS.findIndex(c => c.hide);
    if (hideIdx >= 0) {
      const a = slots.find(s => s.tile === hideIdx);
      const far = slots.slice(Math.floor(slots.length * .72)).filter(s => s.r > 0 && s.r < ROWS - 1);
      const b = far[Math.floor(rnd() * far.length)];
      if (a && b) [a.tile, b.tile] = [b.tile, a.tile];
    }

    this.pick = [];
    slots.forEach(s => {
      const g = new THREE.PlaneGeometry(sw, sh);
      const tx = s.tile % ATLAS_COLS, ty = Math.floor(s.tile / ATLAS_COLS);
      const u0 = tx / ATLAS_COLS, u1 = (tx + 1) / ATLAS_COLS, v1 = 1 - ty / ATLAS_ROWS, v0 = 1 - (ty + 1) / ATLAS_ROWS;
      const uv = g.attributes.uv;
      uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
      const b = .62 + rnd() * .38;                       // each screen a different brightness
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12).fill(b), 3));

      const m = new THREE.Mesh(g, mat);
      const th = TH0 + ((s.c + .5) / COLS) * ARC;
      const y = (s.r - (ROWS - 1) / 2) * rowPitch;
      m.position.set(Math.sin(th) * R, y, Math.cos(th) * R);
      m.lookAt(0, y, 0);
      m.userData = { th, y, cam: s.tile === BLACK_TILE ? null : tiles[s.tile].cam };
      scene.add(m);
      if (housing) {
        // the cabinet behind (gives the monitors depth when seen at an angle) …
        const box = new THREE.Mesh(housing.box, housing.boxMat);
        const hy = y - sh * .08, bd = housing.depth;
        box.position.set(Math.sin(th) * (R + bd / 2 + .02), hy, Math.cos(th) * (R + bd / 2 + .02));
        box.lookAt(0, hy, 0);
        scene.add(box);
        if (scanGeo) {
          const sl = new THREE.Mesh(scanGeo, scanMat);
          sl.position.set(Math.sin(th) * (R - .01), y, Math.cos(th) * (R - .01));
          sl.lookAt(0, y, 0);
          scene.add(sl);
        }
        // … and the front bezel with a rounded hole for the tube, just in front of the screen
        const face = new THREE.Mesh(housing.face, housing.faceMat);
        face.position.set(Math.sin(th) * (R - .02), hy, Math.cos(th) * (R - .02));
        face.lookAt(0, hy, 0);
        scene.add(face);
      }
      if (m.userData.cam) this.pick.push(m);
    });
    this.cams = this.pick.map(m => m.userData.cam);

    // black shell, floor and ceiling
    const H = ROWS * rowPitch + 1;
    scene.add(new THREE.Mesh(
      new THREE.CylinderGeometry(R + .1, R + .1, H + 2, 64, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.BackSide })));
    [-1, 1].forEach(sgn => {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R + .2, 64), new THREE.MeshBasicMaterial({ color: 0x010101 }));
      disc.rotation.x = sgn * Math.PI / 2;
      disc.position.y = -sgn * (H / 2 + .6);
      scene.add(disc);
    });

    // white frames: one follows the hovered screen, one blinks on the match
    const frameGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(sw * 1.05, sh * 1.07));
    this.hover = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.hover.visible = false;
    this.matchFrame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.matchFrame.visible = false;
    scene.add(this.hover, this.matchFrame);

    /* ---------- look controls ---------- */
    const look = this.look = { yaw: Math.PI, pitch: 0, tyaw: Math.PI, tpitch: 0, fov: 70, tfov: 70 };
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null, lastInput = 0;
    const el = renderer.domElement;

    const hit = e => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(this.pick, false)[0]?.object || null;
    };
    el.addEventListener('pointerdown', e => {
      if (this.arrival) return;
      down = { x: e.clientX, y: e.clientY, moved: 0 };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      lastInput = Date.now();
      if (this.arrival) return;
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        down.moved += Math.abs(dx) + Math.abs(dy);
        down.x = e.clientX; down.y = e.clientY;
        const k = look.fov / 70;
        look.tyaw += dx * .0042 * k;
        look.tpitch = THREE.MathUtils.clamp(look.tpitch + dy * .0032 * k, -.42, .42);
        Tip.hide();
        return;
      }
      const m = hit(e);
      if (m) {
        this.place(this.hover, m); this.hover.visible = true;
        Tip.show(camMeta(m.userData.cam), e);
        el.style.cursor = 'pointer';
      } else {
        this.hover.visible = false; Tip.hide();
        el.style.cursor = '';
      }
    });
    el.addEventListener('pointerup', e => {
      if (down && down.moved < 6) {
        const m = hit(e);
        if (m) pickFeed(m.userData.cam, e);              // → the feed comes to the centre (script.js → Viewer)
      }
      down = null;
    });
    el.addEventListener('pointerleave', () => { this.hover.visible = false; Tip.hide(); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      look.tfov = THREE.MathUtils.clamp(look.tfov + e.deltaY * .03, 32, 85);
      lastInput = Date.now();
    }, { passive: false });

    /* ---------- size + render loop ---------- */
    const size = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    size();
    addEventListener('resize', size);

    let k = 0;
    const loop = now => {
      requestAnimationFrame(loop);
      if (!stage.classList.contains('is-active') || document.hidden) return;
      if (!renderer.domElement.width) size();
      const t = now / 1000;

      // redraw a few feeds per frame → each one updates a few times a second (CCTV choppiness)
      for (let n = 0; n < ROOM.tilesPerFrame; n++) this.drawTile(actx, tiles, k++ % BLACK_TILE, t);
      tex.needsUpdate = true;

      if (this.arrival) {                                   // walking in from the door
        const a = this.arrival;
        const p = THREE.MathUtils.clamp((now - a.t0) / a.ms, 0, 1);
        const e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        camera.position.set(0, 0, R * .82 * (1 - e));
        look.fov = look.tfov = 38 + 32 * e;
        if (p >= 1) this.arrival = null;
      } else {
        // how far you can turn: until the end of the wall reaches the edge of the screen (+ a little dark beyond)
        const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
        const lim = Math.max(0, ARC / 2 - half + .12);
        if (!down && Date.now() - lastInput > 6000 && !REDUCED) {                         // the room keeps scanning, side to side
          look.tyaw += ROOM.drift * (this.dir ||= 1);
          if (Math.abs(look.tyaw - Math.PI) > lim) this.dir = -this.dir;
        }
        look.tyaw = THREE.MathUtils.clamp(look.tyaw, Math.PI - lim, Math.PI + lim);
        look.yaw += (look.tyaw - look.yaw) * .07;           // delayed, observational
        look.pitch += (look.tpitch - look.pitch) * .07;
        look.fov += (look.tfov - look.fov) * .1;
      }
      if (Math.abs(camera.fov - look.fov) > .01) { camera.fov = look.fov; camera.updateProjectionMatrix(); }
      const cp = Math.cos(look.pitch);
      camera.lookAt(camera.position.x + Math.sin(look.yaw) * cp, camera.position.y + Math.sin(look.pitch), camera.position.z + Math.cos(look.yaw) * cp);
      if (this.matchFrame.userData.on) this.matchFrame.visible = Math.floor(t * 2) % 2 === 0;
      if (this.blink) this.blinkStep(t);
      renderer.render(scene, camera);
    };
    requestAnimationFrame(loop);
  },

  // one feed → its tile in the atlas
  drawTile(actx, tiles, i, t) {
    if (Math.random() < .03) return;                       // dropped frame
    const tl = tiles[i];
    const x = (i % ATLAS_COLS) * TILE_W, y = Math.floor(i / ATLAS_COLS) * TILE_H;
    actx.save();
    actx.beginPath(); actx.rect(x, y, TILE_W, TILE_H); actx.clip();
    actx.translate(x, y);
    const figs = paintCam(actx, TILE_W, TILE_H, t + tl.off, tl.cam, tl.p);      // real clip, or a generated scene (script.js)
    if (!paintCam.video) {                                         // generated scenes are darker → lift them
      actx.globalCompositeOperation = 'screen';
      actx.fillStyle = 'rgb(70,70,70)'; actx.fillRect(0, 0, TILE_W, TILE_H);
      actx.globalCompositeOperation = 'source-over';
    }
    grain(actx, TILE_W, TILE_H, ROOM.grain);
    const k = TILE_W / 128;                                        // text and lines scale with the tile size
    if (ROOM.crt) {
      const cv = actx.canvas, S = crtScratch();
      // soft focus: shrink the picture and stretch it back (cheap blur) — the tube never quite resolves it
      if (ROOM.soften) {
        const f = 1 / (1 + ROOM.soften), w2 = Math.round(TILE_W * f), h2 = Math.round(TILE_H * f);
        S.soft.clearRect(0, 0, w2, h2); S.soft.drawImage(cv, x, y, TILE_W, TILE_H, 0, 0, w2, h2);
        actx.drawImage(S.soft.canvas, 0, 0, w2, h2, 0, 0, TILE_W, TILE_H);
      }
      // bloom: a tiny copy stretched over the picture, added as light — bright parts bleed
      if (ROOM.glow) {
        S.glow.clearRect(0, 0, 24, 18); S.glow.drawImage(cv, x, y, TILE_W, TILE_H, 0, 0, 24, 18);
        actx.globalCompositeOperation = 'screen'; actx.globalAlpha = ROOM.glow;
        actx.drawImage(S.glow.canvas, 0, 0, 24, 18, -4 * k, -3 * k, TILE_W + 8 * k, TILE_H + 6 * k);
        actx.globalAlpha = 1; actx.globalCompositeOperation = 'source-over';
      }
      // a slow rolling bar, like an unsynced tube
      const bar = ((t * 18 + tl.off * 7) % (TILE_H * 1.6)) - TILE_H * .3;
      const bg = actx.createLinearGradient(0, bar - 14 * k, 0, bar + 14 * k);
      bg.addColorStop(0, 'rgba(255,255,255,0)'); bg.addColorStop(.5, 'rgba(255,255,255,.06)'); bg.addColorStop(1, 'rgba(255,255,255,0)');
      actx.fillStyle = bg; actx.fillRect(0, bar - 14 * k, TILE_W, 28 * k);
    }
    // the tube's edges fall off into dark
    const g = actx.createRadialGradient(TILE_W / 2, TILE_H / 2, TILE_H * (ROOM.crt ? .2 : .3), TILE_W / 2, TILE_H / 2, TILE_W * (ROOM.crt ? .62 : .75));
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${ROOM.crt ? .8 : .45})`);
    actx.fillStyle = g; actx.fillRect(0, 0, TILE_W, TILE_H);
    if (ROOM.crt) {                                                // glass: a faint reflection across the tube
      const gl = actx.createLinearGradient(0, 0, TILE_W, TILE_H);
      gl.addColorStop(0, 'rgba(255,255,255,.07)'); gl.addColorStop(.35, 'rgba(255,255,255,0)');
      actx.fillStyle = gl; actx.fillRect(0, 0, TILE_W, TILE_H);
    } else if (paintCam.tracked) {                                 // (digital mode only) detection boxes
      actx.strokeStyle = 'rgba(255,255,255,.9)'; actx.fillStyle = 'rgba(255,255,255,.9)';
      actx.lineWidth = k; actx.font = `${7 * k}px sans-serif`;
      figs.slice(0, 6).forEach(f => {
        actx.strokeRect(f.x * TILE_W + .5, f.y * TILE_H + .5, f.w * TILE_W, f.h * TILE_H);
        actx.fillText(f.short || f.cls.toUpperCase(), f.x * TILE_W, f.y * TILE_H - 2 * k);
      });
    }
    // camera number, small, like a burned-in character generator
    actx.fillStyle = 'rgba(255,255,255,.6)';
    actx.font = `${8 * k}px "Courier Prime", monospace`;
    actx.fillText(tl.cam.id, 14 * k, 20 * k);
    if (tl.cam.scene === 'nosignal') actx.fillText('NO SIGNAL', TILE_W / 2 - 22 * k, TILE_H / 2 + 3 * k);
    if (!ROOM.crt && /REC|LIVE/.test(tl.cam.status) && Math.floor(t * 1.2) % 2) actx.fillRect(TILE_W - 9 * k, 5 * k, 4 * k, 4 * k);
    actx.restore();
  },

  place(frame, m) { frame.position.copy(m.position).multiplyScalar(.995); frame.quaternion.copy(m.quaternion); },

  // the door opens: start near the entrance with a narrow lens, walk to the centre
  arrive(ms = 7000) {
    if (!this.mounted) return;
    Object.assign(this.look, { yaw: Math.PI, tyaw: Math.PI, pitch: 0, tpitch: 0 });
    this.camera.position.set(0, 0, this.geo.R * .82);
    this.arrival = { t0: performance.now(), ms };
  },
  reset() {
    if (!this.mounted) return;
    this.arrival = null;
    this.camera.position.set(0, 0, 0);
    Object.assign(this.look, { yaw: Math.PI, tyaw: Math.PI, pitch: 0, tpitch: 0, fov: 70, tfov: 70 });
    this.matchFrame.userData.on = false; this.matchFrame.visible = false;
    if (this.blink) this.hint(false);
  },

  // SYSTEM: POSSIBLE MATCH → the room turns, mechanically, to face CAM 03
  focusMatch() {
    const m = this.pick?.find(p => p.userData.cam.match);
    if (!m) return;
    this.place(this.matchFrame, m);
    this.matchFrame.userData.on = true;
    const L = this.look;
    let d = m.userData.th - L.tyaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));              // shortest way round
    L.tyaw += d;
    L.tpitch = Math.atan2(m.userData.y, this.geo.R);
  },
  // HINT: the camera you are looking for blinks — its screen flickers and a white frame flashes. Room3D.hint(false) stops it.
  hint(on = true) {
    if (!this.mounted) return;
    const m = this.pick.find(p => p.userData.cam.hide);
    if (!m) return;
    this.blink = on ? m : null;
    this.place(this.matchFrame, m);
    this.matchFrame.userData.on = on; this.matchFrame.visible = on;
    const col = m.geometry.attributes.color;
    if (!on && m.userData.b0) { col.array.fill(m.userData.b0); col.needsUpdate = true; }
  },
  blinkStep(t) {
    const m = this.blink, col = m.geometry.attributes.color;
    m.userData.b0 ??= col.array[0];
    const lit = Math.floor(t * 2.5) % 2 === 0;                  // ~2.5 blinks a second
    col.array.fill(lit ? 1.5 : .25); col.needsUpdate = true;
  },
  openMatch() {
    const i = this.pick.findIndex(p => p.userData.cam.match);
    if (i >= 0) Viewer.open(this.cams, i);
  },
};

Room3D.settings = ROOM;                                   // (debug: Room3D.settings.glow = 0 …)
window.Room3D = Room3D;
dispatchEvent(new Event('room3d-ready'));
