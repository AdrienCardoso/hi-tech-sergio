/**
 * Aether — lightweight 2D rosette flow for 10D-5.
 * Optimized: few particles, batched strokes, strong audio reactivity.
 */
(function (global) {
  'use strict';

  const PRESET = {
    symmetryFold: 8,
    foldDepth: 0.62,
    streamTwist: 1.4,
    streamCount: 20,
    tubeRadius: 40
  };

  const MAX_PARTICLES = 160;
  const DRAW_FOLDS = 6;

  class AetherEngine {
    constructor(canvas, reactor) {
      this.canvas = canvas;
      this.reactor = reactor;
      this.ctx = null;
      this.time = 0;
      this.particles = [];
      this.kick = 0;
      this.spinBoost = 0;
      this._lastW = 0;
      this._lastH = 0;
      this._foldSin = new Float32Array(DRAW_FOLDS);
      this._foldCos = new Float32Array(DRAW_FOLDS);
      for (let i = 0; i < DRAW_FOLDS; i++) {
        const a = (i / DRAW_FOLDS) * Math.PI * 2;
        this._foldSin[i] = Math.sin(a);
        this._foldCos[i] = Math.cos(a);
      }
    }

    init() {
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this._spawnParticles();
    }

    setPreset() {
      this._spawnParticles();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
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
          this.ctx.setTransform(1, 0, 0, 1, 0, 0);
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
        decayRate: el('paramTrails', 0.88),
        noiseForce: el('paramNoise', 1.5),
        lineWeight: el('paramParticleSize', 2) * 0.28
      };
    }

    _spawnParticles() {
      const lanes = PRESET.streamCount;
      const count = Math.min(MAX_PARTICLES, lanes * 8);
      this.particles = [];
      for (let i = 0; i < count; i++) {
        const lane = i % lanes;
        const ang = (lane / lanes) * Math.PI * 2;
        const r = PRESET.tubeRadius * (0.35 + (i / count) * 0.55);
        this.particles.push({
          x: Math.cos(ang) * r,
          y: Math.sin(ang) * r,
          wpx: 0,
          wpy: 0,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    _flow(x, y, t, audio, settings) {
      const ang = Math.atan2(y, x);
      const rad = Math.hypot(x, y) + 1e-4;
      const fold = PRESET.symmetryFold;
      const rose = Math.cos(fold * ang + t * (0.9 + audio.mid * 2.2 + this.spinBoost));
      const targetR = PRESET.tubeRadius * (0.5 + rose * PRESET.foldDepth * (0.55 + audio.bass * 0.35));
      const radial = (targetR - rad) * (0.022 + audio.bass * 0.018);
      const twist = PRESET.streamTwist * (1 + audio.high * 0.9 + audio.energy * 0.4);
      const wob = Math.sin(ang * 3 + t * 2.1) * settings.noiseForce * (0.35 + audio.mid * 0.5);
      const spd = (1.6 + audio.bass * 2.4 + audio.energy * 0.8) * (1 + this.kick * 0.6);
      return {
        vx: (-Math.sin(ang) * twist + Math.cos(ang) * radial + wob) * spd,
        vy: ( Math.cos(ang) * twist + Math.sin(ang) * radial - wob * 0.7) * spd
      };
    }

    render(dt) {
      if (!this.ctx) return;

      const settings = this._readSettings();
      const sens = settings.sensitivity;
      const bass = this.reactor.bass * sens;
      const mid = this.reactor.mid * sens;
      const high = this.reactor.high * sens;
      const energy = this.reactor.energy * sens;
      const audio = { bass, mid, high, energy };

      if (this.reactor.onset) {
        this.kick = 1;
        this.spinBoost = 1.6;
      }
      this.kick *= Math.pow(0.82, dt * 60);
      this.spinBoost *= Math.pow(0.88, dt * 60);

      this.time += dt * (1 + mid * 0.8 + energy * 0.35);

      const cssW = this.canvas.clientWidth || window.innerWidth;
      const cssH = this.canvas.clientHeight || window.innerHeight;
      const dpr = this.canvas.width / cssW;
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const fade = 0.08 + (1 - settings.decayRate) * 0.55 + high * 0.04;
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.42, fade)})`;
      ctx.fillRect(0, 0, cssW, cssH);

      const cx = cssW * 0.5;
      const cy = cssH * 0.5;
      const scale = Math.min(cssW, cssH) * 0.38 * (1 + bass * 0.18 + this.kick * 0.12);
      const lw = Math.max(0.35, settings.lineWeight * (0.85 + high * 0.9 + this.kick * 0.5));
      const alpha = Math.min(1, 0.28 + energy * 0.55 + high * 0.25 + this.kick * 0.35);
      const t = this.time;
      const kickPush = this.kick * 18;

      ctx.lineWidth = lw;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();

      const pts = this.particles;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const f = this._flow(pt.x, pt.y, t + pt.phase, audio, settings);
        pt.x += f.vx * dt * 60;
        pt.y += f.vy * dt * 60;

        if (this.kick > 0.05) {
          pt.x += Math.sin(t * 12 + pt.phase) * kickPush * dt;
          pt.y += Math.cos(t * 10 + pt.phase) * kickPush * dt;
        }

        if (pt.wpx === 0 && pt.wpy === 0) {
          pt.wpx = pt.x;
          pt.wpy = pt.y;
          continue;
        }

        for (let fIdx = 0; fIdx < DRAW_FOLDS; fIdx++) {
          const ca = this._foldCos[fIdx];
          const sa = this._foldSin[fIdx];
          const curX = cx + (pt.x * ca - pt.y * sa) * scale;
          const curY = cy + (pt.x * sa + pt.y * ca) * scale;
          const prevX = cx + (pt.wpx * ca - pt.wpy * sa) * scale;
          const prevY = cy + (pt.wpx * sa + pt.wpy * ca) * scale;
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(curX, curY);
        }

        pt.wpx = pt.x;
        pt.wpy = pt.y;

        if (Math.hypot(pt.x, pt.y) > PRESET.tubeRadius * 2.2) {
          const ang = Math.random() * Math.PI * 2;
          const r = PRESET.tubeRadius * 0.25;
          pt.x = Math.cos(ang) * r;
          pt.y = Math.sin(ang) * r;
          pt.wpx = 0;
          pt.wpy = 0;
        }
      }

      ctx.stroke();

      if (this.kick > 0.2) {
        ctx.beginPath();
        ctx.arc(cx, cy, scale * (0.12 + bass * 0.08), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${this.kick * 0.45})`;
        ctx.lineWidth = lw * 1.8;
        ctx.stroke();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  global.AetherEngine = AetherEngine;
})(typeof window !== 'undefined' ? window : globalThis);
