/**
 * SoundSpectrum ColorMap — 256 RGB entries from .txt
 */
(function (global) {
  'use strict';

  function parseColorMapText(text) {
    const colors = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      colors[i * 3] = i;
      colors[i * 3 + 1] = i;
      colors[i * 3 + 2] = i;
    }
    const lines = text.split(/\r?\n/);
    let idx = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('/*')) continue;
      const parts = t.split(/[\s,;]+/).filter(Boolean);
      if (parts.length >= 3) {
        const r = Math.max(0, Math.min(255, parseInt(parts[0], 10) || 0));
        const g = Math.max(0, Math.min(255, parseInt(parts[1], 10) || 0));
        const b = Math.max(0, Math.min(255, parseInt(parts[2], 10) || 0));
        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;
        idx++;
        if (idx >= 256) break;
      }
    }
    return colors;
  }

  function createColorMapTexture(gl, colors) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, colors);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  global.SSColorMap = { parseColorMapText, createColorMapTexture };
})(typeof window !== 'undefined' ? window : globalThis);
