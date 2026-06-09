/**
 * WhiteCap Engine — WaveShape + ColorScheme из оригинальных .txt
 * (без FlowField / Particles — это проще G-Force)
 */
(function (global) {
  'use strict';

  const { buildConfig, parseConfigText } = global.SSFormula;

  function hslToRgb(h, s, l) {
    h = ((h % 1) + 1) % 1;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (x) => {
      if (x < 0) x += 1;
      if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
  }

  function lookAtMatrix(eye, target, up) {
    const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    const z = [zx / len, zy / len, zz / len];
    let xx = up[1] * z[2] - up[2] * z[1];
    let xy = up[2] * z[0] - up[0] * z[2];
    let xz = up[0] * z[1] - up[1] * z[0];
    len = Math.hypot(xx, xy, xz) || 1;
    const x = [xx / len, xy / len, xz / len];
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return { x, y, z, eye };
  }

  class WhiteCapEngine {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.w = 640;
      this.h = 480;
      this.time = 0;
      this.waveConfig = null;
      this.colorConfig = null;
      this.fft = new Float32Array(64);
      this.mag = new Float32Array(512);
      this.bass = 0;
      this.sensitivity = 1;
      this.persist = 0.88;
      this._buffer = null;
      this._setDefaultColor();
      this.resize();
    }

    _setDefaultColor() {
      this.colorConfig = {
        eval(name, ctx) {
          if (name === 'H') return (ctx.s + ctx.t * 0.02) % 1;
          if (name === 'S') return 0.75;
          if (name === 'L') return 0.35 + 0.45 * (ctx.fftVal || 0);
          return 0;
        },
        vars: {},
      };
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor((this.canvas.clientWidth || window.innerWidth) * dpr);
      const h = Math.floor((this.canvas.clientHeight || window.innerHeight) * dpr);
      if (w < 32 || h < 32) return;
      this.w = w; this.h = h;
      this.canvas.width = w;
      this.canvas.height = h;
      this._buffer = this.ctx.createImageData(w, h);
      this._clear();
    }

    _clear() {
      const d = this._buffer.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
      }
    }

    async loadWaveText(text) {
      const fftBin = (x) => {
        const i = Math.max(0, Math.min(63, Math.floor(x * 64 * this.sensitivity)));
        return this.fft[i] || 0;
      };
      const magBin = (x) => {
        const i = Math.max(0, Math.min(511, Math.floor(x * 512)));
        return this.mag[i] || 0;
      };
      this.waveConfig = buildConfig(parseConfigText(text), {
        WIDTH: this.w, HEIGHT: this.h, fftBin, magBin, seed: Date.now() & 0xffff,
      });
      this._clear();
    }

    async loadColorText(text) {
      if (!text) return;
      const fftBin = (x) => {
        const i = Math.max(0, Math.min(63, Math.floor(x * 64 * this.sensitivity)));
        return this.fft[i] || 0;
      };
      this.colorConfig = buildConfig(parseConfigText(text), {
        WIDTH: this.w, HEIGHT: this.h, fftBin, magBin: () => 0, seed: 7,
      });
    }

    setAudio(fft, mag, bass) {
      if (fft) this.fft.set(fft);
      if (mag) this.mag.set(mag);
      this.bass = bass || 0;
    }

    _project(x, y, z, cam) {
      const vx = x - cam.eye[0], vy = y - cam.eye[1], vz = z - cam.eye[2];
      const cx = vx * cam.x[0] + vy * cam.x[1] + vz * cam.x[2];
      const cy = vx * cam.y[0] + vy * cam.y[1] + vz * cam.y[2];
      const cz = vx * cam.z[0] + vy * cam.z[1] + vz * cam.z[2];
      const fov = (cam.fov || 70) * Math.PI / 180;
      const scale = 1 / Math.tan(fov / 2);
      const iz = cz <= 0.1 ? 0.1 : cz;
      const ndcX = (cx * scale) / iz;
      const ndcY = (cy * scale) / iz;
      const px = (ndcX * 0.5 + 0.5) * this.w;
      const py = (1 - (ndcY * 0.5 + 0.5)) * this.h;
      return [px, py, iz];
    }

    _plotLine(x0, y0, x1, y1, r, g, b, w) {
      const data = this._buffer.data;
      const W = this.w, H = this.h;
      const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = Math.floor(x0 + (x1 - x0) * t);
        const py = Math.floor(y0 + (y1 - y0) * t);
        const rad = Math.max(1, Math.floor(w * 2));
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dy * dy > rad * rad) continue;
            const ix = px + dx, iy = py + dy;
            if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
            const idx = (iy * W + ix) * 4;
            data[idx] = Math.min(255, data[idx] + Math.floor(r * 220));
            data[idx + 1] = Math.min(255, data[idx + 1] + Math.floor(g * 220));
            data[idx + 2] = Math.min(255, data[idx + 2] + Math.floor(b * 220));
          }
        }
      }
    }

    _fade(decay) {
      const d = this._buffer.data;
      const f = Math.max(0, Math.min(0.999, decay));
      const m = Math.floor(f * 256);
      for (let i = 0; i < d.length; i += 4) {
        d[i] = (d[i] * m) >> 8;
        d[i + 1] = (d[i + 1] * m) >> 8;
        d[i + 2] = (d[i + 2] * m) >> 8;
      }
    }

    _colorAt(ctx) {
      const cc = this.colorConfig;
      let H = (ctx.s + this.time * 0.03) % 1;
      let S = 0.8;
      let L = 0.25 + 0.5 * (ctx.fftVal || 0);
      if (cc?.formulas?.H) H = cc.eval('H', ctx);
      else if (cc?.eval) try { H = cc.eval('H', ctx); } catch (_) {}
      if (cc?.formulas?.S) S = cc.eval('S', ctx);
      else if (cc?.eval) try { const v = cc.eval('S', ctx); if (v) S = v; } catch (_) {}
      if (cc?.formulas?.L) L = cc.eval('L', ctx);
      else if (cc?.eval) try { const v = cc.eval('L', ctx); if (v) L = v; } catch (_) {}
      return hslToRgb(H, Math.min(1, Math.max(0, S)), Math.min(1, Math.max(0, L)));
    }

    render(dt) {
      if (!this.waveConfig || !this._buffer) return;
      const cfg = this.waveConfig;
      const frameDt = dt;
      this.time += dt;

      const decayCtx = { t: this.time, dt: frameDt, s: 0, row: 0, WIDTH: this.w, HEIGHT: this.h, vars: {}, BASS: this.bass };
      let decay = this.persist;
      try {
        const a = cfg.eval('A', decayCtx);
        if (a > 0 && a < 1) decay = a;
      } catch (_) {}
      this._fade(decay);

      const rows = Math.max(1, Math.floor(cfg.vars.Rows || 1));
      const steps = Math.max(16, Math.floor(cfg.vars.Vers || 256));
      const tmapFn = cfg.formulas.TMap;

      const camCtx = { t: this.time, dt: frameDt, WIDTH: this.w, HEIGHT: this.h, vars: {}, BASS: this.bass };
      const camX = cfg.eval('CamX', camCtx) || 0;
      const camY = cfg.eval('CamY', camCtx) || 0;
      const camZ = cfg.eval('CamZ', camCtx) || 200;
      const cmLX = cfg.eval('CmLX', camCtx) ?? 0;
      const cmLY = cfg.eval('CmLY', camCtx) ?? 0;
      const cmLZ = cfg.eval('CmLZ', camCtx) ?? 1;
      const cUpX = cfg.eval('CUpX', camCtx) ?? 0;
      const cUpY = cfg.eval('CUpY', camCtx) ?? 1;
      const cUpZ = cfg.eval('CUpZ', camCtx) ?? 0;
      const camD = cfg.eval('CamD', camCtx) || 70;
      const cam = lookAtMatrix(
        [camX, camY, camZ],
        [camX + cmLX, camY + cmLY, camZ + cmLZ],
        [cUpX, cUpY, cUpZ]
      );
      cam.fov = camD;

      for (let row = 0; row < rows; row++) {
        let px = null, py = null, pz = null;
        for (let i = 0; i < steps; i++) {
          const s = i / Math.max(1, steps - 1);
          let sampleDt = frameDt;
          if (tmapFn) {
            sampleDt = cfg.eval('TMap', { t: this.time, s, row, dt: frameDt, Rows: rows, WIDTH: this.w, HEIGHT: this.h, vars: {}, BASS: this.bass });
          }
          const ctx = {
            t: this.time, s, row, dt: sampleDt, Rows: rows,
            WIDTH: this.w, HEIGHT: this.h, vars: {}, BASS: this.bass,
            fftVal: cfg.raw.fft ? 0 : 0,
          };
          ctx.fftVal = this.fft[Math.floor(s * 63)] || 0;

          const x = cfg.eval('X', ctx) ?? cfg.eval('X0', ctx) ?? 0;
          const y = cfg.eval('Y', ctx) ?? cfg.eval('Y0', ctx) ?? 0;
          const z = cfg.eval('Z', ctx) ?? cfg.eval('Z0', ctx) ?? 0;
          const wLine = cfg.eval('W', ctx) || cfg.eval('LWdt', ctx) || 0.5;
          const [sx, sy] = this._project(x, y, z, cam);
          const [cr, cg, cb] = this._colorAt({ ...ctx, fftVal: cfg.eval('D1', ctx) || ctx.fftVal });

          if (px !== null && cfg.vars.ConL !== 0) {
            this._plotLine(px, py, sx, sy, cr, cg, cb, wLine);
          } else if (cfg.vars.ConL === 0) {
            this._plotLine(sx, sy, sx, sy, cr, cg, cb, wLine);
          }
          px = sx; py = sy; pz = z;
        }
      }

      this.ctx.putImageData(this._buffer, 0, 0);
    }
  }

  global.WhiteCapEngine = WhiteCapEngine;
})(typeof window !== 'undefined' ? window : globalThis);
