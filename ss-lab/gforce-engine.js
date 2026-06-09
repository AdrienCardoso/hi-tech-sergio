/**
 * G-Force / WhiteCap Engine — оригинальный pipeline SoundSpectrum:
 * 8-bit буфер → FlowField → WaveShape → ColorMap (GLSL ColorizePixels)
 */
(function (global) {
  'use strict';

  const { buildConfig, parseConfigText } = global.SSFormula;
  const { parseColorMapText, createColorMapTexture } = global.SSColorMap;

  const FF_VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  const FF_FRAG = `
    precision highp float;
    uniform sampler2D uPrev;
    uniform vec2 uRes;
    uniform float uAspic;
    uniform float uT;
    uniform float uA0, uA1, uA2;
    uniform int uPolar;
    uniform float uSrcR_k, uSrcT_k, uSrcX_k, uSrcY_k;
    varying vec2 vUv;

    float trwv(float x) {
      float w = x - floor(x);
      return w < 0.5 ? 2.0 * w : 2.0 * (1.0 - w);
    }

    vec2 toPolar(vec2 p) {
      float r = length(p);
      float theta = atan(p.y, p.x);
      return vec2(r, theta);
    }

    vec2 fromPolar(float r, float theta) {
      return vec2(r * cos(theta), r * sin(theta));
    }

    void main() {
      vec2 uv = vUv;
      vec2 p = (uv - 0.5) * 2.0;
      if (uAspic > 0.5) {
        float aspect = uRes.x / uRes.y;
        if (aspect > 1.0) p.x *= aspect; else p.y /= aspect;
      }
      float r = length(p);
      float theta = atan(p.y, p.x);
      float srcR = r;
      float srcT = theta;
      if (uSrcR_k > 0.5) {
        srcR = 0.987 * r + 0.005 * sin(theta * uA0);
      }
      if (uSrcT_k > 0.5) {
        srcT = trwv(0.005 * sin(r * uA1) + (theta * uA2)) / max(uA2, 0.001);
      }
      vec2 src = fromPolar(srcR, srcT);
      if (uAspic > 0.5) {
        float aspect = uRes.x / uRes.y;
        if (aspect > 1.0) src.x /= aspect; else src.y *= aspect;
      }
      vec2 srcUv = src * 0.5 + 0.5;
      gl_FragColor = texture2D(uPrev, clamp(srcUv, 0.001, 0.999));
    }`;

  const COL_FRAG = `
    precision highp float;
    uniform sampler2D uFrame;
    uniform sampler2D uColorMap;
    varying vec2 vUv;
    void main() {
      float v = texture2D(uFrame, vUv).r;
      vec2 cm = vec2(v, 0.5);
      gl_FragColor = vec4(texture2D(uColorMap, cm).rgb, 1.0);
    }`;

  class GForceEngine {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
      if (!this.gl) throw new Error('WebGL unavailable');
      this.w = 512;
      this.h = 512;
      this.time = 0;
      this.flowConfig = null;
      this.waveConfig = null;
      this.colorMapTex = null;
      this.fft = new Float32Array(64);
      this.mag = new Float32Array(512);
      this._initGL();
      this._clearBuffer(0);
    }

    _initGL() {
      const gl = this.gl;
      this.fb = gl.createFramebuffer();
      this.texA = this._makeTex();
      this.texB = this._makeTex();
      this.ffProg = this._prog(FF_VERT, FF_FRAG);
      this.colProg = this._prog(FF_VERT, COL_FRAG);
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this._setDefaultColorMap();
    }

    _makeTex() {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    _prog(vs, fs) {
      const gl = this.gl;
      const p = gl.createProgram();
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      };
      compile(gl.VERTEX_SHADER, vs);
      compile(gl.FRAGMENT_SHADER, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }

    _setDefaultColorMap() {
      const ramp = new Uint8Array(256 * 3);
      for (let i = 0; i < 256; i++) {
        ramp[i * 3] = i;
        ramp[i * 3 + 1] = Math.min(255, i * 2);
        ramp[i * 3 + 2] = 255 - i;
      }
      this.colorMapTex = createColorMapTexture(this.gl, ramp);
    }

    async loadConfigText(flowText, waveText, colorText) {
      const fftBin = (x) => {
        const i = Math.max(0, Math.min(63, Math.floor(x * 64)));
        return this.fft[i] || 0;
      };
      const magBin = (x) => {
        const i = Math.max(0, Math.min(511, Math.floor(x * 512)));
        return this.mag[i] || 0;
      };
      if (flowText) {
        const raw = parseConfigText(flowText);
        this.flowConfig = buildConfig(raw, { WIDTH: this.w, HEIGHT: this.h, fftBin, magBin, seed: 42 });
      }
      if (waveText) {
        const raw = parseConfigText(waveText);
        this.waveConfig = buildConfig(raw, { WIDTH: this.w, HEIGHT: this.h, fftBin, magBin, seed: 99 });
      }
      if (colorText) {
        const colors = parseColorMapText(colorText);
        if (this.colorMapTex) this.gl.deleteTexture(this.colorMapTex);
        this.colorMapTex = createColorMapTexture(this.gl, colors);
      }
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(this.canvas.clientWidth * dpr) || 512;
      const h = Math.floor(this.canvas.clientHeight * dpr) || 512;
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
      this.texA = this._makeTex();
      this.texB = this._makeTex();
      this._clearBuffer(0);
    }

    _clearBuffer(val) {
      const gl = this.gl;
      const data = new Uint8Array(this.w * this.h * 4);
      for (let i = 0; i < this.w * this.h; i++) data[i * 4] = val;
      gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.bindTexture(gl.TEXTURE_2D, this.texB);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    _bindQuad(prog) {
      const gl = this.gl;
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    _sampleBilinear(pixels, w, h, u, v) {
      const x = u * (w - 1);
      const y = v * (h - 1);
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      const s = (a, b, c, d) => a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
      return [
        s(pixels[i00], pixels[i10], pixels[i01], pixels[i11]),
        s(pixels[i00 + 1], pixels[i10 + 1], pixels[i01 + 1], pixels[i11 + 1]),
        s(pixels[i00 + 2], pixels[i10 + 2], pixels[i01 + 2], pixels[i11 + 2]),
        255,
      ];
    }

    _applyFlowField() {
      if (!this.flowConfig) return;
      const gl = this.gl;
      const cfg = this.flowConfig;
      const w = this.w, h = this.h;
      const prev = new Uint8Array(w * h * 4);
      const next = new Uint8Array(w * h * 4);
      gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.getTexImage(gl.TEXTURE_2D, 0, gl.RGBA, gl.UNSIGNED_BYTE, prev);

      const aspic = cfg.aspic > 0.5;
      const aspect = w / h;
      const hasPolar = cfg.formulas.srcR || cfg.formulas.srcT;
      const hasCart = cfg.formulas.srcX || cfg.formulas.srcY;

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          let x = (px / (w - 1)) * 2 - 1;
          let y = 1 - (py / (h - 1)) * 2;
          if (aspic) {
            if (aspect > 1) x *= aspect; else y /= aspect;
          }
          const r = Math.hypot(x, y);
          const theta = Math.atan2(y, x);
          const ctx = { t: this.time, r, theta, x, y, WIDTH: w, HEIGHT: h, vars: {} };
          let sx, sy;
          if (hasPolar) {
            const srcR = cfg.formulas.srcR ? cfg.eval('srcR', ctx) : r;
            const srcT = cfg.formulas.srcT ? cfg.eval('srcT', ctx) : theta;
            sx = srcR * Math.cos(srcT);
            sy = srcR * Math.sin(srcT);
          } else if (hasCart) {
            sx = cfg.formulas.srcX ? cfg.eval('srcX', ctx) : x;
            sy = cfg.formulas.srcY ? cfg.eval('srcY', ctx) : y;
          } else {
            sx = x; sy = y;
          }
          if (aspic) {
            if (aspect > 1) sx /= aspect; else sy *= aspect;
          }
          const u = sx * 0.5 + 0.5;
          const v = 1 - (sy * 0.5 + 0.5);
          const out = this._sampleBilinear(prev, w, h, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
          const oi = (py * w + px) * 4;
          next[oi] = out[0]; next[oi + 1] = out[1]; next[oi + 2] = out[2]; next[oi + 3] = 255;
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, next);
    }

    _drawWaveShapeCPU() {
      if (!this.waveConfig) return;
      const cfg = this.waveConfig;
      const gl = this.gl;
      const steps = cfg.vars.Vers || 256;
      const pixels = new Uint8Array(this.w * this.h * 4);
      gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.getTexImage(gl.TEXTURE_2D, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      const w = this.w, h = this.h;
      const drawDot = (px, py, intensity) => {
        const ix = Math.floor((px * 0.5 + 0.5) * w);
        const iy = Math.floor((1 - (py * 0.5 + 0.5)) * h);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;
        const idx = (iy * w + ix) * 4;
        const v = Math.min(255, pixels[idx] + Math.floor(intensity * 200));
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = v;
        pixels[idx + 3] = 255;
      };

      let px = 0, py = 0;
      for (let i = 0; i < steps; i++) {
        const s = i / Math.max(1, steps - 1);
        const ctx = { t: this.time, s, dt: 1 / 60, WIDTH: w, HEIGHT: h, vars: {} };
        const x = cfg.eval('X0', ctx) ?? cfg.eval('X', ctx);
        const y = cfg.eval('Y0', ctx) ?? cfg.eval('Y', ctx);
        const pen = cfg.eval('Pen', ctx) || 0.99;
        if (i > 0) {
          const stepsL = 8;
          for (let j = 0; j <= stepsL; j++) {
            const t = j / stepsL;
            drawDot(px + (x - px) * t, py + (y - py) * t, pen);
          }
        }
        px = x; py = y;
      }

      gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }

    _colorizeToScreen() {
      const gl = this.gl;
      gl.viewport(0, 0, this.w, this.h);
      gl.useProgram(this.colProg);
      this._bindQuad(this.colProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.uniform1i(gl.getUniformLocation(this.colProg, 'uFrame'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.colorMapTex);
      gl.uniform1i(gl.getUniformLocation(this.colProg, 'uColorMap'), 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    setAudio(fft, mag, bass) {
      if (fft) this.fft.set(fft);
      if (mag) this.mag.set(mag);
      this.bass = bass || 0;
    }

    render(dt) {
      this.time += dt;
      if (!this.flowConfig && !this.waveConfig) return;
      this._applyFlowField();
      this._drawWaveShapeCPU();
      this._colorizeToScreen();
    }
  }

  global.GForceEngine = GForceEngine;
})(typeof window !== 'undefined' ? window : globalThis);
