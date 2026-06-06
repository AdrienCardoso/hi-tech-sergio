/**
 * Aeon Web Engine — порт движка SoundSpectrum Aeon для браузера (WebGL / Three.js).
 * Сцены переносятся из Python 2 по алгоритму; полный паритет — поэтапно.
 */
(function (global) {
  'use strict';

  const ss_PaletteBack = 1;
  const ss_PaletteFore = 2;
  const ss_PaletteFull = 0;

  const PORTED_PATHS = new Set([
    'Plasma/Plasma.py',
    'Roaming/Roaming.py',
  ]);

  const NAME_SCENE_OVERRIDES = {
    Roaming: { path: 'Roaming/Roaming.py', args: { style: 0 } },
    Ripples: { path: 'Plasma/Plasma.py', args: { fore: 1 } },
    Electronica: { path: 'Plasma/Plasma.py', args: { fore: 0 } },
    Phosphor: { path: 'Plasma/Plasma.py', args: { fore: 0 } },
    'Sakura Branch': { path: 'Plasma/Plasma.py', args: { fore: 0 } },
  };

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
    grd.addColorStop(0.35, 'rgba(255,255,255,0.85)');
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
      return new THREE.Color().setHSL(0.62 + l * 0.08, 0.55, 0.12 + l * 0.28);
    }
    if (band === ss_PaletteFull) {
      return new THREE.Color().setHSL((hueShift + l * 300) % 1, 0.75, 0.35 + l * 0.4);
    }
    return new THREE.Color().setHSL((hueShift + l * 0.75) % 1, 0.9, 0.32 + l * 0.45);
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

    /** Маппинг Web Audio → 64 бина Aeon (120–8000 Hz, логарифмически). */
    updateFromReactor(reactor, sensitivity = 1) {
      if (!reactor?.analyser) return;
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
      const w = this.fore ? 0.26 : 0.5;
      this.audMod = this.fore ? 1 : 0.2;
      this.paletteBand = this.fore ? ss_PaletteFore : ss_PaletteBack;
      this.widthScale = w;
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
      ctx.set3DCamera([x, 0, z], [0.1, 0, 0], [0, 1, 0], 0.785, 0.01, 5);
      ctx.setBlendAdditive();

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
        const alpha = 0.5 + 0.4 * Math.sin(0.2 * time + i + audio.bins[bin] * this.audMod);
        const lum = 0.3;
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
      this.lastUpdate = -1;
      this.baseX = new Float32Array(this.num);
      for (let i = 0; i < this.num; i++) {
        this.baseX[i] = -0.05 + 3 * (i / this.num) + Math.random() * 0.05;
      }
      this.widthScale = 0.065 + Math.random() * 0.035;
    }

    draw(ctx, time, dt, audio) {
      time += this.toff;
      ctx.set3DCamera([0, 0, 4.5], [0, 0, 0], [0, 1, 0], 0.9, 0.1, 50);
      ctx.setBlendAdditive();

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
        const lum = 0.6 + sv * fftVal;
        const alpha = 0.5 + 0.45 * Math.sin(-0.3 * time + pct * 4 + this.toff) + 0.2 * fftVal;
        const col = paletteHSL(this.style ? ss_PaletteFore : ss_PaletteFull, Math.min(1, lum * 0.55), ctx.hueShift);
        positions.push(this.baseX[i], 0, z);
        colors.push(col.r * alpha, col.g * alpha, col.b * alpha);
      }
      ctx.drawBillboards(positions, colors, this.widthScale);
    }
  }

  class AeonDrawContext {
    constructor(renderer, scene) {
      this.renderer = renderer;
      this.scene = scene;
      this.hueShift = 0;
      this._points = null;
      this._geom = null;
      this._mat = null;
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

    setBlendAdditive() {
      if (this._mat) this._mat.blending = THREE.AdditiveBlending;
    }

    drawBillboards(positions, colors, scale) {
      const n = positions.length / 3;
      if (!this._geom) {
        this._geom = new THREE.BufferGeometry();
        this._mat = new THREE.PointsMaterial({
          map: this.dotTex,
          size: scale * 120,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexColors: true,
          sizeAttenuation: true,
        });
        this._points = new THREE.Points(this._geom, this._mat);
        this.scene.add(this._points);
      }
      this._mat.size = scale * Math.min(this.renderer.width, this.renderer.height) * 0.08;
      this._geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      this._geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this._geom.attributes.position.needsUpdate = true;
      this._geom.attributes.color.needsUpdate = true;
      this._geom.computeBoundingSphere();
    }

    dispose() {
      if (this._points) this.scene.remove(this._points);
      this.dotTex?.dispose();
      this._geom?.dispose();
      this._mat?.dispose();
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
    if (path === 'Plasma/Plasma.py' || path.endsWith('Plasma/Plasma.py')) {
      return new PlasmaScene(args);
    }
    if (path === 'Roaming/Roaming.py' || path.includes('Roaming/Roaming.py')) {
      return new RoamingFFTScene({ style: args.style !== undefined ? args.style : 0 });
    }
    return null;
  }

  function isScenePorted(entry) {
    if (NAME_SCENE_OVERRIDES[entry.name]) return true;
    const path = (entry.path || '').replace(/\\/g, '/');
    if (PORTED_PATHS.has(path)) return true;
    if (path.includes('Plasma/Plasma.py')) return true;
    if (path === 'Roaming/Roaming.py' && (entry.args?.style === 0 || entry.args?.style === undefined)) {
      return true;
    }
    return false;
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

      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.threeScene = new THREE.Scene();
      this.threeScene.background = new THREE.Color(0x000000);
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
      this.renderer.camera = this.camera;
      this.width = 1;
      this.height = 1;
    }

    async loadManifest() {
      if (this.scenes.length) return this.scenes;
      try {
        const res = await fetch('aeon/aeon-scenes.json');
        if (res.ok) {
          const data = await res.json();
          this.scenes = data.scenes || [];
          return this.scenes;
        }
      } catch (e) {
        console.warn('Aeon manifest fetch failed:', e);
      }
      this.scenes = [];
      return this.scenes;
    }

    getPortedCount() {
      return this.scenes.filter(isScenePorted).length;
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

      if (isScenePorted(entry)) {
        this._sceneImpl = createSceneFromEntry(entry);
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
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    render(dt) {
      if (!this.ready) return;
      const sens = parseFloat(document.getElementById('paramSensitivity')?.value || '1');
      this.audio.updateFromReactor(this.reactor, sens);
      this.time += dt;

      const themeIdx = (typeof global.engine !== 'undefined' && global.engine?.themeIdx) ? global.engine.themeIdx : 0;
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
})();
