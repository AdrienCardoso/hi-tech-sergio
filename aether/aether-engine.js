/**
 * Aether — Sakr Flow particle engine (Canvas 2D, 3D projection).
 * Ported from index 2.html for hi-tech-sergio 10D-5 slot.
 */
(function (global) {
  'use strict';

  const PRESETS = {
    geo_rosette_vortex:     { symmetryFold: 10, foldDepth: 0.65, streamTwist: 1.35, streamCount: 64, tubeRadius: 38, hollow: false, dotted: false },
    geo_dotted_fern:        { symmetryFold: 14, foldDepth: 0.55, streamTwist: 1.1,  streamCount: 72, tubeRadius: 32, hollow: false, dotted: true },
    geo_hollow_swirl:       { symmetryFold: 20, foldDepth: 0.75, streamTwist: 2.0,  streamCount: 80, tubeRadius: 42, hollow: true,  dotted: false },
    geo_rosette_crown:      { symmetryFold: 12, foldDepth: 0.7,  streamTwist: 1.2,  streamCount: 56, tubeRadius: 44, hollow: false, dotted: false },
    geo_rosette_bloom:      { symmetryFold: 8,  foldDepth: 0.5,  streamTwist: 0.9,  streamCount: 48, tubeRadius: 50, hollow: false, dotted: false },
    geo_rosette_petal_ring: { symmetryFold: 16, foldDepth: 0.6,  streamTwist: 1.5,  streamCount: 88, tubeRadius: 36, hollow: false, dotted: false },
    geo_rosette_deep_eye:   { symmetryFold: 9,  foldDepth: 0.85, streamTwist: 1.8,  streamCount: 52, tubeRadius: 34, hollow: false, dotted: false },
    geo_rosette_needle:     { symmetryFold: 11, foldDepth: 0.72, streamTwist: 2.2,  streamCount: 60, tubeRadius: 28, hollow: false, dotted: false },
    geo_micro_halo:         { symmetryFold: 18, foldDepth: 0.45, streamTwist: 1.0,  streamCount: 96, tubeRadius: 30, hollow: false, dotted: true },
    geo_micro_crown:        { symmetryFold: 22, foldDepth: 0.58, streamTwist: 1.3,  streamCount: 100,tubeRadius: 26, hollow: false, dotted: true },
    geo_micro_lattice:      { symmetryFold: 12, foldDepth: 0.62, streamTwist: 1.15, streamCount: 92, tubeRadius: 24, hollow: false, dotted: true },
    geo_micro_vortex:       { symmetryFold: 16, foldDepth: 0.68, streamTwist: 1.9,  streamCount: 84, tubeRadius: 22, hollow: false, dotted: true },
    geo_micro_shell:        { symmetryFold: 20, foldDepth: 0.52, streamTwist: 1.4,  streamCount: 76, tubeRadius: 20, hollow: false, dotted: true },
    geo_hollow_crown:       { symmetryFold: 24, foldDepth: 0.78, streamTwist: 1.6,  streamCount: 68, tubeRadius: 46, hollow: true,  dotted: false },
    geo_hollow_lattice:     { symmetryFold: 18, foldDepth: 0.7,  streamTwist: 1.25, streamCount: 72, tubeRadius: 40, hollow: true,  dotted: false },
    geo_hollow_needle:      { symmetryFold: 28, foldDepth: 0.82, streamTwist: 2.4,  streamCount: 64, tubeRadius: 18, hollow: true,  dotted: false },
    geo_hollow_bloom:       { symmetryFold: 16, foldDepth: 0.6,  streamTwist: 1.05, streamCount: 56, tubeRadius: 48, hollow: true,  dotted: false },
    geo_hollow_deep_ring:    { symmetryFold: 20, foldDepth: 0.88, streamTwist: 1.75, streamCount: 60, tubeRadius: 42, hollow: true,  dotted: false }
  };

  const CAM_VIEWS = [
    { yaw: 0.0,  pitch: 0.35, roll: 0 },
    { yaw: 0.85, pitch: 0.55, roll: 0.08 },
    { yaw: 1.65, pitch: 1.05, roll: -0.05 }
  ];

  function lerp(a, b, t) { return a + (b - a) * t; }

  class SimplexNoise {
    constructor(seed) {
      this.p = new Uint8Array(512);
      const perm = new Uint8Array(256);
      for (let i = 0; i < 256; i++) perm[i] = i;
      let s = seed | 0;
      for (let i = 255; i > 0; i--) {
        s = (s * 16807 + 12345) & 0x7fffffff;
        const j = s % (i + 1);
        const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
      }
      for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
    }
    dot(g, x, y) { return g[0] * x + g[1] * y; }
    noise2D(x, y) {
      const F2 = 0.5 * (Math.sqrt(3) - 1);
      const G2 = (3 - Math.sqrt(3)) / 6;
      const s = (x + y) * F2;
      const i = Math.floor(x + s), j = Math.floor(y + s);
      const t = (i + j) * G2;
      const X0 = i - t, Y0 = j - t;
      const x0 = x - X0, y0 = y - Y0;
      const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      const grad = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
      let n0 = 0, n1 = 0, n2 = 0;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) { t0 *= t0; const g = grad[this.p[ii + this.p[jj]] % 8]; n0 = t0 * t0 * this.dot(g, x0, y0); }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) { t1 *= t1; const g = grad[this.p[ii + i1 + this.p[jj + j1]] % 8]; n1 = t1 * t1 * this.dot(g, x1, y1); }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) { t2 *= t2; const g = grad[this.p[ii + 1 + this.p[jj + 1]] % 8]; n2 = t2 * t2 * this.dot(g, x2, y2); }
      return 70 * (n0 + n1 + n2);
    }
  }

  class AetherEngine {
    constructor(canvas, reactor) {
      this.canvas = canvas;
      this.reactor = reactor;
      this.ctx = null;
      this.noise = new SimplexNoise(42);
      this.time = 0;
      this.cameraIdx = 0;
      this.cameraBlend = 0;
      this.presetName = 'geo_rosette_vortex';
      this.params = { ...PRESETS.geo_rosette_vortex };
      this.particles = [];
      this.explode = 0;
      this._lastW = 0;
      this._lastH = 0;
    }

    init() {
      this.ctx = this.canvas.getContext('2d');
      this._spawnParticles();
    }

    setPreset(name) {
      const p = PRESETS[name] || PRESETS.geo_rosette_vortex;
      this.presetName = PRESETS[name] ? name : 'geo_rosette_vortex';
      this.params = { ...p };
      this._spawnParticles();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      if (w !== this._lastW || h !== this._lastH) {
        this._lastW = w;
        this._lastH = h;
        if (this.ctx) {
          this.ctx.fillStyle = '#000';
          this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
      }
    }

    _readSettings() {
      const el = (id, def) => {
        const n = document.getElementById(id);
        return n ? parseFloat(n.value) : def;
      };
      return {
        sensitivity: el('paramSensitivity', 1),
        decayRate: el('paramTrails', 0.9),
        noiseForce: el('paramNoise', 1.5),
        flowSpeed: 2.0,
        lineWeight: el('paramParticleSize', 2) * 0.22,
        cameraZoom: 1.0,
        spinSpeed: 0.8,
        beatPush: 1.0
      };
    }

    _spawnParticles() {
      const count = Math.min(8000, Math.max(800, (this.params.streamCount || 64) * 55));
      this.particles = [];
      for (let i = 0; i < count; i++) {
        const lane = i % (this.params.streamCount || 64);
        const t = lane / (this.params.streamCount || 64);
        const ang = t * Math.PI * 2 * (this.params.symmetryFold || 10);
        const r = (this.params.tubeRadius || 38) * (0.3 + Math.random() * 0.7);
        this.particles.push({
          x: Math.cos(ang) * r,
          y: Math.sin(ang) * r,
          z: (Math.random() - 0.5) * r * 0.8,
          lane,
          phase: Math.random() * Math.PI * 2,
          px: 0, py: 0,
          life: Math.random()
        });
      }
    }

    _project(x, y, z, cam, cx, cy, scale) {
      const cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      let x1 = x * cyaw - z * syaw;
      let z1 = x * syaw + z * cyaw;
      let y1 = y * cp - z1 * sp;
      let z2 = y * sp + z1 * cp;
      const persp = 1 / (280 + z2 * 0.6);
      return {
        x: cx + x1 * scale * persp,
        y: cy + y1 * scale * persp,
        depth: z2
      };
    }

    _flowField(x, y, z, t, settings, audio) {
      const p = this.params;
      const fold = p.symmetryFold || 10;
      const ang = Math.atan2(y, x);
      const rad = Math.sqrt(x * x + y * y) + 1e-5;
      const rose = Math.cos(fold * ang + t * settings.spinSpeed * (1 + audio.mid * 0.4));
      const targetR = (p.tubeRadius || 38) * (0.55 + rose * p.foldDepth * 0.45);
      const radial = (targetR - rad) * 0.018;
      const twist = p.streamTwist * (1 + audio.high * 0.35);
      const tang = twist * (1 + 0.15 * Math.sin(t * 0.7 + z * 0.02));
      const nx = this.noise.noise2D(x * 0.012 + t * 0.15, y * 0.012 + t * 0.12);
      const ny = this.noise.noise2D(y * 0.012 - t * 0.1, z * 0.012 + t * 0.08);
      const nz = this.noise.noise2D(z * 0.012 + t * 0.11, x * 0.012 - t * 0.09);
      const nf = settings.noiseForce * (1 + audio.bass * 0.5);
      return {
        vx: (-Math.sin(ang) * tang + Math.cos(ang) * radial + nx * nf) * settings.flowSpeed,
        vy: ( Math.cos(ang) * tang + Math.sin(ang) * radial + ny * nf) * settings.flowSpeed,
        vz: (nz * nf * 0.6 + Math.sin(ang * fold + t) * 0.08) * settings.flowSpeed
      };
    }

    render(dt) {
      if (!this.ctx) return;
      const settings = this._readSettings();
      const bass = this.reactor.bass * settings.sensitivity;
      const mid = this.reactor.mid * settings.sensitivity;
      const high = this.reactor.high * settings.sensitivity;
      const energy = this.reactor.energy * settings.sensitivity;
      const audio = { bass, mid, high, energy };

      this.time += dt;
      this.cameraBlend += dt * 0.04;
      if (this.cameraBlend >= 1) {
        this.cameraBlend = 0;
        this.cameraIdx = (this.cameraIdx + 1) % CAM_VIEWS.length;
      }
      const camA = CAM_VIEWS[this.cameraIdx];
      const camB = CAM_VIEWS[(this.cameraIdx + 1) % CAM_VIEWS.length];
      const cam = {
        yaw: lerp(camA.yaw, camB.yaw, this.cameraBlend),
        pitch: lerp(camA.pitch, camB.pitch, this.cameraBlend),
        roll: lerp(camA.roll, camB.roll, this.cameraBlend)
      };

      if (this.reactor.onset) this.explode = 1;
      this.explode *= Math.pow(0.92, dt * 60);

      const cssW = this.canvas.clientWidth || window.innerWidth;
      const cssH = this.canvas.clientHeight || window.innerHeight;
      const dpr = this.canvas.width / cssW;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const fade = 1 - Math.min(0.98, settings.decayRate);
      this.ctx.fillStyle = `rgba(0,0,0,${fade})`;
      this.ctx.fillRect(0, 0, cssW, cssH);

      const cx = cssW * 0.5;
      const cy = cssH * 0.5;
      const scale = Math.min(cssW, cssH) * 0.42 * settings.cameraZoom * (1 + bass * 0.08 * settings.beatPush);
      const p = this.params;
      const folds = p.symmetryFold || 10;
      const lw = Math.max(0.15, settings.lineWeight * (0.7 + high * 0.5));
      const alphaBase = 0.35 + energy * 0.45 + high * 0.15;
      const hollow = p.hollow;
      const dotted = p.dotted;

      const t = this.time;
      const step = (Math.PI * 2) / folds;

      for (let i = 0; i < this.particles.length; i++) {
        const pt = this.particles[i];
        const f = this._flowField(pt.x, pt.y, pt.z, t + pt.phase, settings, audio);
        const kick = this.explode * settings.beatPush * 12;
        pt.x += f.vx * dt * 60 + (Math.random() - 0.5) * kick;
        pt.y += f.vy * dt * 60 + (Math.random() - 0.5) * kick;
        pt.z += f.vz * dt * 60 + (Math.random() - 0.5) * kick * 0.5;

        const pr = this._project(pt.x, pt.y, pt.z, cam, cx, cy, scale);
        if (pt.px === 0 && pt.py === 0) { pt.px = pr.x; pt.py = pr.y; continue; }

        for (let fIdx = 0; fIdx < folds; fIdx++) {
          const ca = Math.cos(fIdx * step), sa = Math.sin(fIdx * step);
          const rx = pt.x * ca - pt.y * sa;
          const ry = pt.x * sa + pt.y * ca;
          const rpx = pt.px * ca - pt.py * sa;
          const rpy = pt.px * sa + pt.py * ca;
          const cur = this._project(rx, ry, pt.z, cam, cx, cy, scale);
          const prev = this._project(rpx, rpy, pt.z, cam, cx, cy, scale);

          if (hollow) {
            const midX = (cur.x + prev.x) * 0.5;
            const midY = (cur.y + prev.y) * 0.5;
            const dist = Math.hypot(cur.x - cx, cur.y - cy);
            if (dist < scale * 0.18 || dist > scale * 0.92) continue;
            this.ctx.beginPath();
            this.ctx.moveTo(prev.x, prev.y);
            this.ctx.lineTo(midX, midY);
            this.ctx.strokeStyle = `rgba(255,255,255,${alphaBase * 0.55})`;
            this.ctx.lineWidth = lw * 0.65;
            this.ctx.stroke();
            continue;
          }

          if (dotted && (i + fIdx) % 3 !== 0) continue;

          this.ctx.beginPath();
          this.ctx.moveTo(prev.x, prev.y);
          this.ctx.lineTo(cur.x, cur.y);
          const depthA = 0.55 + Math.max(0, 1 - (pr.depth + 120) / 280) * 0.45;
          this.ctx.strokeStyle = `rgba(255,255,255,${alphaBase * depthA})`;
          this.ctx.lineWidth = lw * (dotted ? 0.85 : 1);
          this.ctx.stroke();
        }

        pt.px = pr.x;
        pt.py = pr.y;

        const rLen = Math.hypot(pt.x, pt.y);
        if (rLen > (p.tubeRadius || 38) * 2.5) {
          const ang = Math.random() * Math.PI * 2;
          const r = (p.tubeRadius || 38) * 0.2;
          pt.x = Math.cos(ang) * r;
          pt.y = Math.sin(ang) * r;
          pt.z = (Math.random() - 0.5) * r;
          pt.px = 0;
          pt.py = 0;
        }
      }

      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  global.AetherEngine = AetherEngine;
})(typeof window !== 'undefined' ? window : globalThis);
