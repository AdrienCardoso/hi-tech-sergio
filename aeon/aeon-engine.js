/**
 * Aeon Web Engine — порт SoundSpectrum Aeon для браузера (Three.js).
 */
(function (global) {
  'use strict';

  let _scenesCache = null;

  async function loadAeonScenes() {
    if (_scenesCache?.length) return _scenesCache;
    if (global.AEON_SCENES_BUILTIN?.scenes?.length) {
      _scenesCache = global.AEON_SCENES_BUILTIN.scenes;
      return _scenesCache;
    }
    const bases = [];
    try {
      bases.push(new URL('aeon/aeon-scenes.json', document.baseURI || global.location.href).href);
    } catch (_) {}
    bases.push('aeon/aeon-scenes.json', './aeon/aeon-scenes.json', '/aeon/aeon-scenes.json');
    for (const url of bases) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          const data = await res.json();
          _scenesCache = data.scenes || [];
          if (_scenesCache.length) return _scenesCache;
        }
      } catch (_) {}
    }
    _scenesCache = [];
    return _scenesCache;
  }

  const ss_PaletteBack = 1;
  const ss_PaletteFore = 2;
  const ss_PaletteFull = 0;

  const NAME_SCENE_OVERRIDES = {
    Roaming: { path: 'Roaming/Roaming.py', args: { style: 0 } },
    'Roaming - Vuze': { path: 'Roaming/Roaming.py', args: { style: 1 } },
    Ripples: { path: 'Plasma/Plasma.py', args: { fore: 1 } },
    Electronica: { path: 'Plasma/Plasma.py', args: { fore: 0 } },
    Phosphor: { path: 'Plasma/Plasma.py', args: { fore: 0 } },
    'Sakura Branch': { path: 'Plasma/Plasma.py', args: { fore: 0 } },
  };

  const PORTED_PATH_RE = [
    /Plasma\/Plasma\.py/i,
    /Roaming\/Roaming\.py/i,
    /Aurora\/Aurora\.py/i,
    /Forward\/Forward\.py/i,
    /Alien Sine\.py/i,
    /Neon Flow\/Neon Flow\.py/i,
    /Audioscope\/Audioscope\.py/i,
    /Alien Telephone\/Alien Telephone\.py/i,
  ];

  function bezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      u * u * u * p0[2] + 3 * u * u * t * p1[2] + 3 * u * t * t * p2[2] + t * t * t * p3[2],
    ];
  }

  function createDotTexture(size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.Texture(c);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  function paletteHSL(band, lum, hueShift) {
    const l = Math.max(0, Math.min(1, lum));
    if (band === ss_PaletteBack) {
      return new THREE.Color().setHSL(0.62 + l * 0.08, 0.65, 0.2 + l * 0.35);
    }
    if (band === ss_PaletteFull) {
      return new THREE.Color().setHSL((hueShift + l * 0.85) % 1, 0.8, 0.4 + l * 0.45);
    }
    return new THREE.Color().setHSL((hueShift + l * 0.7) % 1, 0.92, 0.38 + l * 0.48);
  }

  class AeonAudioData {
    constructor() {
      this.bins = new Float32Array(64);
      this.fft1 = new Float32Array(64);
      this.fft2 = new Float32Array(64);
      this.impulseFast = 0;
      this.impulseSlow = 0;
      this.energy = 0;
      this.beat = 0;
      this.level = 0;
      this._fastPrev = 0;
      this._slowPrev = 0;
    }

    updateFromReactor(reactor, sensitivity = 1, time = 0) {
      if (!reactor?.analyser) {
        for (let i = 0; i < 64; i++) {
          const v = 0.12 + 0.18 * Math.abs(Math.sin(time * 1.7 + i * 0.31));
          this.bins[i] = v;
          this.fft1[i] = v;
          this.fft2[i] = v * 0.85;
        }
        this.energy = 0.35;
        this.impulseFast = 0.15 + 0.1 * Math.sin(time * 3.2);
        this.impulseSlow = 0.2;
        return;
      }

      const analyser = reactor.analyser;
      const n = analyser.frequencyBinCount;
      const raw = reactor.dataArray;
      analyser.getByteFrequencyData(raw);

      const minHz = 120;
      const maxHz = 8000;
      const sr = reactor.ctx?.sampleRate || 44100;
      const nyquist = sr / 2;
      let total = 0;

      for (let b = 0; b < 64; b++) {
        const t0 = b / 64;
        const t1 = (b + 1) / 64;
        const f0 = minHz * Math.pow(maxHz / minHz, t0);
        const f1 = minHz * Math.pow(maxHz / minHz, t1);
        const i0 = Math.max(0, Math.floor((f0 / nyquist) * n));
        const i1 = Math.min(n - 1, Math.ceil((f1 / nyquist) * n));
        let sum = 0;
        let cnt = 0;
        for (let i = i0; i <= i1; i++) {
          sum += raw[i] / 255;
          cnt++;
        }
        const v = cnt ? (sum / cnt) * sensitivity : 0;
        this.bins[b] = v;
        total += v;
      }

      const attack = 0.35;
      const release = 0.08;
      for (let i = 0; i < 64; i++) {
        const target = this.bins[i];
        const prev = this.fft1[i];
        const k = target > prev ? attack : release;
        this.fft1[i] += (target - prev) * k;
        this.fft2[i] = this.fft2[i] * 0.92 + this.fft1[i] * 0.08;
      }

      const inst = total / 64;
      this.level = inst;
      this.energy += (inst - this.energy) * 0.1;
      this._fastPrev += (inst - this._fastPrev) * (inst > this._fastPrev ? 0.45 : 0.12);
      this._slowPrev += (inst - this._slowPrev) * 0.04;
      this.impulseFast = Math.max(0, this._fastPrev - this.energy * 0.5);
      this.impulseSlow = Math.max(0, this._slowPrev - this.energy * 0.3);
      this.beat = reactor.onset ? 1 : this.beat * 0.85;
    }
  }

  class PlasmaScene {
    constructor(args = {}) {
      this.fore = args.fore !== 0;
      this.count = this.fore ? 225 : 32;
      this.audMod = this.fore ? 1 : 0.2;
      this.paletteBand = this.fore ? ss_PaletteFore : ss_PaletteBack;
      this.widthScale = this.fore ? 0.26 : 0.5;
      this.curves = [];
      this.tOffset = new Float32Array(this.count);
      this.tOffSpeed = new Float32Array(this.count);
      const offSpeed = this.fore ? [0.03, 0.03] : [0.02, 0.02];
      for (let i = 0; i < this.count; i++) {
        this.curves.push(this._newCurve());
        this.tOffSpeed[i] = offSpeed[0] + Math.random() * (offSpeed[1] - offSpeed[0]);
      }
    }

    _newCurve() {
      const r = () => (Math.random() * 2 - 1) * 0.6;
      return {
        xyz1: [r(), r(), r()],
        xyz2: [r(), r(), r()],
        xyz3: [r(), r(), r()],
        xyz4: [r(), r(), r()],
        point(t) {
          return bezierPoint(this.xyz1, this.xyz2, this.xyz3, this.xyz4, t);
        },
        extend() {
          this.xyz1 = this.xyz4.slice();
          this.xyz2 = [
            2 * this.xyz4[0] - this.xyz3[0],
            2 * this.xyz4[1] - this.xyz3[1],
            2 * this.xyz4[2] - this.xyz3[2],
          ];
          this.xyz3 = [r(), r(), r()];
          this.xyz4 = [r(), r(), r()];
        },
      };
    }

    draw(ctx, time, dt, audio) {
      const x = Math.sin(time * 0.1) * 0.9;
      const z = Math.cos(time * 0.1) * 0.9;
      ctx.set3DCamera([x, 0, z], [0.1, 0, 0], [0, 1, 0], 0.785, 0.05, 8);
      const positions = [];
      const colors = [];
      const n = this.curves.length;
      for (let i = 0; i < n; i++) {
        this.tOffset[i] += dt * this.tOffSpeed[i];
        if (this.tOffset[i] >= 1) {
          this.tOffset[i] -= 1;
          this.curves[i].extend();
        }
        const p = this.curves[i].point(this.tOffset[i]);
        const bin = Math.floor((audio.bins.length * i) / n);
        const alpha = 0.55 + 0.45 * Math.sin(0.2 * time + i + audio.bins[bin] * this.audMod);
        const lum = 0.45 + audio.bins[bin] * 0.35;
        const col = paletteHSL(this.paletteBand, lum, ctx.hueShift);
        positions.push(p[0], p[1], p[2]);
        colors.push(col.r * alpha, col.g * alpha, col.b * alpha);
      }
      ctx.drawBillboards(positions, colors, this.widthScale);
    }
  }

  class RoamingFFTScene {
    constructor(args = {}) {
      this.style = args.style || 0;
      const mult = this.style ? 2 : 4;
      this.num = 64 * mult;
      this.bins = new Int32Array(this.num);
      const coef = 10 + Math.random() * 20;
      const off = Math.random() * 100;
      for (let i = 0; i < this.num; i++) {
        this.bins[i] = Math.floor(63 * (0.5 + 0.5 * Math.sin((i / this.num) * coef + off)));
      }
      this.range = 0.15 + Math.random() * 0.05;
      this.tAng = this.style ? 1 + Math.random() * 19 : (Math.random() > 0.5 ? 0 : 2 + Math.random() * 4);
      this.toff = Math.abs((Math.random() + Math.random() + Math.random() - 1.5) * 20);
      this.tcoef = (0.2 + Math.random() * 0.2) * (this.style ? 0.5 : 1);
      this.mvCoef = this.style ? 5 + Math.random() * 25 : 5;
      this.baseX = new Float32Array(this.num);
      for (let i = 0; i < this.num; i++) {
        this.baseX[i] = -1.2 + 2.4 * (i / this.num) + Math.random() * 0.05;
      }
      this.widthScale = 0.08 + Math.random() * 0.04;
    }

    draw(ctx, time, dt, audio) {
      time += this.toff;
      ctx.set3DCamera([0, 0, 3.2], [0, 0, 0], [0, 1, 0], 1.05, 0.1, 40);
      const positions = [];
      const colors = [];
      const invN = 1 / this.num;
      const t = time * this.tcoef + this.toff;
      for (let i = 0; i < this.num; i++) {
        const pct = i * invN;
        const fftVal = audio.fft1[this.bins[i]];
        const mv = 0.1 + 0.15 * Math.sin(time + this.mvCoef * pct);
        const sv = 0.7 + 1.25 * Math.sin(-time + 10 * pct);
        const z = mv * fftVal + Math.sin(t + pct * this.tAng) * this.range;
        const lum = Math.min(1, 0.55 + sv * fftVal * 0.4);
        const alpha = 0.55 + 0.45 * Math.sin(-0.3 * time + pct * 4 + this.toff) + 0.35 * fftVal;
        const col = paletteHSL(this.style ? ss_PaletteFore : ss_PaletteFull, lum, ctx.hueShift);
        positions.push(this.baseX[i], 0, z);
        colors.push(col.r * alpha, col.g * alpha, col.b * alpha);
      }
      ctx.drawBillboards(positions, colors, this.widthScale);
    }
  }

  class AuroraScene {
    draw(ctx, time, dt, audio) {
      ctx.set3DCamera([0, -0.32, 0], [0, 0, 0], [0, 0, 1], 1.3, 0.05, 80);
      const lines = [];
      const colors = [];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const pct = i / n;
        const idx = i * 4;
        const aud = 1.5 * audio.fft1[idx % 64] + 0.7 * audio.fft2[idx % 64];
        const rot = (i % 2 ? -1 : 1) * 0.2 * time * pct * pct + i;
        const scale = 0.5 - 0.25 * pct;
        const segs = 48;
        for (let s = 0; s < segs; s++) {
          const a0 = (s / segs) * Math.PI * 2 + rot;
          const a1 = ((s + 1) / segs) * Math.PI * 2 + rot;
          const r0 = scale * (1 + aud * 0.35);
          const r1 = scale * (1 + aud * 0.35);
          lines.push(
            r0 * Math.cos(a0), r0 * Math.sin(a0), 0,
            r1 * Math.cos(a1), r1 * Math.sin(a1), 0
          );
          const lum = 0.55 + 0.16 * Math.sin(time + i) + aud * 0.25;
          const alpha = 0.65 + 0.3 * Math.sin(-0.3 * time + i);
          const col = paletteHSL(ss_PaletteFore, lum, ctx.hueShift);
          colors.push(col.r * alpha, col.g * alpha, col.b * alpha);
          colors.push(col.r * alpha, col.g * alpha, col.b * alpha);
        }
      }
      ctx.drawLines(lines, colors, 1.5);
    }
  }

  class ForwardScene {
    constructor() {
      this.slats = [];
      for (let i = 0; i < 80; i++) {
        this.slats.push({
          pct: Math.random(),
          spd: 0.18 + Math.random() * 0.12,
          bin: Math.floor(Math.random() * 64),
          rot: Math.random() * Math.PI * 2,
          scl: 0.02 + Math.random() * 0.15,
        });
      }
    }

    draw(ctx, time, dt, audio) {
      ctx.set3DCamera([0, 0, 0.1], [0, 0, 1], [0, 1, 0], 1.2, 0.05, 20);
      const lines = [];
      const colors = [];
      for (const sl of this.slats) {
        sl.pct += dt * sl.spd * (0.7 + audio.energy);
        if (sl.pct > 1) sl.pct -= 1;
        const z = sl.pct * sl.pct * 8;
        const aud = audio.fft1[sl.bin];
        const w = sl.scl * (1 + aud * 2.5);
        const x = Math.sin(sl.rot + time * 0.3) * w;
        const y = Math.cos(sl.rot + time * 0.2) * w;
        lines.push(x, y, z, x * 0.3, y * 0.3, z + 0.4 + aud);
        const lum = 0.5 + aud * 0.5;
        const alpha = 0.35 + aud * 0.45;
        const col = paletteHSL(ss_PaletteFore, lum, ctx.hueShift);
        colors.push(col.r * alpha, col.g * alpha, col.b * alpha);
        colors.push(col.r * alpha * 0.6, col.g * alpha * 0.6, col.b * alpha * 0.6);
      }
      ctx.drawLines(lines, colors, 2);
    }
  }

  class AlienSineScene {
    constructor(args = {}) {
      this.hyper = args.hyper || 0;
      this.num = this.hyper ? 32 : 128;
      this.aoff = Math.random() * Math.PI * 2;
    }

    draw(ctx, time, dt, audio) {
      ctx.set3DCamera([0, 0, 2.8], [0, 0, 0], [0, 1, 0], 0.95, 0.05, 30);
      const lines = [];
      const colors = [];
      const invN = 1 / this.num;
      const aMod = 0.3 + (0.3 + 0.4 * audio.impulseSlow) * this.hyper;
      for (let i = 0; i < this.num; i++) {
        const pct = i * invN;
        const audv = audio.fft2[i % 64];
        const ang = Math.PI * 2 * pct + this.aoff + time * 0.05;
        const r0 = 0.55 - audv * aMod;
        const r1 = 0.72 + audv * 0.35;
        const lum = 0.5 + 0.5 * Math.sin(ang) + audv * 0.2;
        const col = paletteHSL(ss_PaletteFull, lum, ctx.hueShift);
        const alpha = 0.5 + audv * 0.4;
        lines.push(r0 * Math.cos(ang), r0 * Math.sin(ang), 0, r1 * Math.cos(ang), r1 * Math.sin(ang), 0);
        colors.push(col.r * alpha, col.g * alpha, col.b * alpha);
        colors.push(col.r * alpha * 0.7, col.g * alpha * 0.7, col.b * alpha * 0.7);
      }
      const ang0 = Math.PI * 2 * 0 + this.aoff + time * 0.05;
      const aud0 = audio.fft2[0];
      const r0a = 0.55 - aud0 * aMod;
      const r1a = 0.72 + aud0 * 0.35;
      const col0 = paletteHSL(ss_PaletteFull, 0.6, ctx.hueShift);
      lines.push(r0a * Math.cos(ang0), r0a * Math.sin(ang0), 0, r1a * Math.cos(ang0), r1a * Math.sin(ang0), 0);
      colors.push(col0.r * 0.5, col0.g * 0.5, col0.b * 0.5, col0.r * 0.35, col0.g * 0.35, col0.b * 0.35);
      ctx.drawLines(lines, colors, 1.8);
    }
  }

  class AudioscopeScene {
    draw(ctx, time, dt, audio) {
      ctx.set3DCamera([0, 0, 2.5], [0, 0, 0], [0, 1, 0], 1.0, 0.05, 20);
      const positions = [];
      const colors = [];
      for (let i = 0; i < 64; i++) {
        const ang = (i / 64) * Math.PI * 2 - Math.PI / 2;
        const v = audio.fft1[i];
        const r0 = 0.35;
        const r1 = 0.35 + v * 1.1 + 0.05 * Math.sin(time * 2 + i * 0.2);
        positions.push(r0 * Math.cos(ang), r0 * Math.sin(ang), 0);
        positions.push(r1 * Math.cos(ang), r1 * Math.sin(ang), 0);
        const lum = 0.4 + v * 0.55;
        const col = paletteHSL(ss_PaletteFore, lum, ctx.hueShift + i / 64 * 0.15);
        const a = 0.6 + v * 0.4;
        colors.push(col.r * a, col.g * a, col.b * a);
        colors.push(col.r, col.g, col.b);
      }
      ctx.drawLines(positions, colors, 2.5);
    }
  }

  class AeonDrawContext {
    constructor(renderer, scene) {
      this.renderer = renderer;
      this.scene = scene;
      this.hueShift = 0;
      this._points = null;
      this._lines = null;
      this._geom = null;
      this._lineGeom = null;
      this._mat = null;
      this._lineMat = null;
      this.dotTex = createDotTexture();
    }

    setHueShift(h) {
      this.hueShift = (h % 360) / 360;
    }

    set3DCamera(pos, lookAt, up, fov, near, far) {
      const cam = this.renderer.camera;
      cam.fov = (fov * 180) / Math.PI;
      cam.near = near;
      cam.far = far;
      cam.position.set(pos[0], pos[1], pos[2]);
      cam.up.set(up[0], up[1], up[2]);
      cam.lookAt(lookAt[0], lookAt[1], lookAt[2]);
      cam.updateProjectionMatrix();
    }

    _pointSize(scale) {
      const dim = Math.min(this.renderer.width, this.renderer.height);
      return Math.max(14, scale * dim * 0.22);
    }

    drawBillboards(positions, colors, scale) {
      if (!this._geom) {
        this._geom = new THREE.BufferGeometry();
        this._mat = new THREE.PointsMaterial({
          map: this.dotTex,
          size: this._pointSize(scale),
          transparent: true,
          opacity: 1,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexColors: true,
          sizeAttenuation: true,
        });
        this._points = new THREE.Points(this._geom, this._mat);
        this.scene.add(this._points);
      }
      this._mat.size = this._pointSize(scale);
      this._geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      this._geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this._geom.attributes.position.needsUpdate = true;
      this._geom.attributes.color.needsUpdate = true;
      this._geom.computeBoundingSphere();
    }

    drawLines(positions, colors, width) {
      if (!this._lineGeom) {
        this._lineGeom = new THREE.BufferGeometry();
        this._lineMat = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          linewidth: width,
        });
        this._lines = new THREE.LineSegments(this._lineGeom, this._lineMat);
        this.scene.add(this._lines);
      }
      this._lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      this._lineGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this._lineGeom.attributes.position.needsUpdate = true;
      this._lineGeom.attributes.color.needsUpdate = true;
      this._lineGeom.computeBoundingSphere();
    }

    dispose() {
      if (this._points) this.scene.remove(this._points);
      if (this._lines) this.scene.remove(this._lines);
      this.dotTex?.dispose();
      this._geom?.dispose();
      this._lineGeom?.dispose();
      this._mat?.dispose();
      this._lineMat?.dispose();
      this._points = null;
      this._lines = null;
      this._geom = null;
      this._lineGeom = null;
      this._mat = null;
      this._lineMat = null;
    }
  }

  function resolveSceneSpec(entry) {
    if (NAME_SCENE_OVERRIDES[entry.name]) {
      return NAME_SCENE_OVERRIDES[entry.name];
    }
    return { path: (entry.path || '').replace(/\\/g, '/'), args: entry.args || {} };
  }

  function createSceneFromEntry(entry) {
    const spec = resolveSceneSpec(entry);
    const path = spec.path;
    const args = spec.args;
    if (/Plasma\/Plasma\.py/i.test(path)) return new PlasmaScene(args);
    if (/Roaming\/Roaming\.py/i.test(path)) return new RoamingFFTScene({ style: args.style !== undefined ? args.style : 0 });
    if (/Aurora\/Aurora\.py/i.test(path)) return new AuroraScene();
    if (/Forward\/Forward\.py/i.test(path)) return new ForwardScene();
    if (/Alien Sine\.py/i.test(path)) return new AlienSineScene(args);
    if (/Neon Flow\/Neon Flow\.py/i.test(path)) return new PlasmaScene({ fore: 1 });
    if (/Audioscope\/Audioscope\.py/i.test(path)) return new AudioscopeScene();
    if (/Alien Telephone\/Alien Telephone\.py/i.test(path)) return new AlienSineScene({ hyper: 0 });
    return null;
  }

  function isScenePorted(entry) {
    if (NAME_SCENE_OVERRIDES[entry.name]) return true;
    const path = resolveSceneSpec(entry).path;
    return PORTED_PATH_RE.some((re) => re.test(path));
  }

  class AeonEngine {
    constructor(canvas, reactor) {
      this.canvas = canvas;
      this.reactor = reactor;
      this.scenes = [];
      this.sceneIndex = -1;
      this.activeScene = null;
      this.audio = new AeonAudioData();
      this.ready = false;
      this._sceneImpl = null;
      this._drawCtx = null;
      this._placeholder = null;
      this.placeholderEl = null;
      this.time = 0;

      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.threeScene = new THREE.Scene();
      this.threeScene.background = new THREE.Color(0x000000);
      this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
      this.renderer.camera = this.camera;
      this.width = window.innerWidth;
      this.height = window.innerHeight;
    }

    async loadManifest() {
      if (this.scenes.length) return this.scenes;
      this.scenes = await loadAeonScenes();
      return this.scenes;
    }

    getPortedCount() {
      return this.scenes.filter(isScenePorted).length;
    }

    getFirstPortedIndex() {
      return this.scenes.findIndex(isScenePorted);
    }

    showsPlaceholder() {
      return !!this._placeholder && !this._sceneImpl;
    }

    async loadSceneByIndex(idx) {
      await this.loadManifest();
      if (idx < 0 || idx >= this.scenes.length) return;
      this.sceneIndex = idx;
      const entry = this.scenes[idx];
      this._disposeScene();
      this.time = 0;

      if (isScenePorted(entry)) {
        this._sceneImpl = createSceneFromEntry(entry);
        if (!this._sceneImpl) {
          console.warn('Aeon: не удалось создать сцену', entry.name);
          this.activeScene = entry;
          this._showPlaceholder(entry.name);
          this.ready = true;
          return;
        }
        this._drawCtx = new AeonDrawContext(this.renderer, this.threeScene);
        this._placeholder = null;
        this._hidePlaceholder();
        this.activeScene = entry;
      } else {
        this._sceneImpl = null;
        this._drawCtx = null;
        this.activeScene = entry;
        this._showPlaceholder(entry.name);
      }
      this.ready = true;
      this.resize();
    }

    setPlaceholderElement(el) {
      this.placeholderEl = el;
    }

    _showPlaceholder(name) {
      this._placeholder = name;
      if (this.placeholderEl) {
        this.placeholderEl.style.display = 'flex';
        const title = this.placeholderEl.querySelector('[data-aeon-ph-title]');
        const sub = this.placeholderEl.querySelector('[data-aeon-ph-sub]');
        const stat = this.placeholderEl.querySelector('[data-aeon-ph-stat]');
        if (title) title.textContent = name;
        if (sub) sub.textContent = 'Сцена в очереди на портирование';
        if (stat) stat.textContent = `Портировано: ${this.getPortedCount()} / ${this.scenes.length || '…'}`;
      }
    }

    _hidePlaceholder() {
      this._placeholder = null;
      if (this.placeholderEl) this.placeholderEl.style.display = 'none';
    }

    _disposeScene() {
      this._drawCtx?.dispose();
      this._drawCtx = null;
      this._sceneImpl = null;
      while (this.threeScene.children.length) {
        const ch = this.threeScene.children[0];
        this.threeScene.remove(ch);
        ch.geometry?.dispose();
        ch.material?.dispose();
      }
    }

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.width = w;
      this.height = h;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.renderer.setSize(w, h, true);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    render(dt) {
      if (!this.ready) return;
      const sens = parseFloat(document.getElementById('paramSensitivity')?.value || '1');
      this.audio.updateFromReactor(this.reactor, sens, this.time);
      this.time += dt;

      const eng = global.engine;
      const themeIdx = eng?.themeIdx !== undefined ? eng.themeIdx : 0;
      const hues = [0, 0, 30, 55, 120, 210, 275, 190, 165, 0];
      const hue = hues[Math.min(9, Math.max(0, themeIdx))] || 0;

      if (this._sceneImpl && this._drawCtx) {
        this._drawCtx.setHueShift(hue);
        this._sceneImpl.draw(this._drawCtx, this.time, dt, this.audio);
        this.renderer.render(this.threeScene, this.camera);
      } else if (this._placeholder) {
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.clear();
      }
    }
  }

  global.AeonEngine = AeonEngine;
  global.isAeonScenePorted = isScenePorted;
  global.loadAeonScenes = loadAeonScenes;
})();
