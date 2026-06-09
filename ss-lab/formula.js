/**
 * SoundSpectrum Config Formula Engine
 * Реализация DSL из G-Force/WhiteCap Documentation (config-programming.html)
 */
(function (global) {
  'use strict';

  const PI = 3.141592653;

  function trwv(x) {
    const w = wrap(x);
    return w < 0.5 ? 2 * w : 2 * (1 - w);
  }

  function sqwv(x) {
    return Math.abs(x) <= 1 ? 1 : 0;
  }

  function wrap(x) {
    return x - Math.floor(x);
  }

  function flip(x) {
    const w = wrap(x * 0.5);
    return w < 0.5 ? 2 * w : 2 * (1 - w);
  }

  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  class RNG {
    constructor(seed = 12345) {
      this.state = seed >>> 0;
    }
    srand(x) {
      this.state = (Math.imul(x >>> 0, 1103515245) + 12345) >>> 0;
      return x;
    }
    rnd(max) {
      this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
      return (this.state / 0xffffffff) * max;
    }
  }

  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    abs: Math.abs, sqrt: Math.sqrt, hypot: Math.hypot,
    exp: Math.exp, log: Math.log, pow: Math.pow,
    floor: Math.floor, round: Math.round, trunc: (x) => x < 0 ? Math.ceil(x) : Math.trunc(x),
    min: Math.min, max: Math.max,
    wrap, flip, trwv, sqwv,
    clamp: clamp01,
    pos: (x) => (x > 0 ? x : 0),
    sign: (x) => (x >= 0 ? 1 : -1),
    rnd: (x, ctx) => ctx.rng.rnd(x),
    srand: (x, ctx) => ctx.rng.srand(x),
    fft: (x, ctx) => ctx.fftBin(x),
    mag: (x, ctx) => ctx.magBin(x),
  };

  const TOK = {
    NUM: 'NUM', ID: 'ID', STR: 'STR',
    OP: 'OP', LP: '(', RP: ')', COMMA: ',', EOF: 'EOF',
  };

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === "'") {
        const q = c; i++;
        let s = '';
        while (i < src.length && src[i] !== q) { s += src[i++]; }
        i++;
        tokens.push({ t: TOK.STR, v: s });
        continue;
      }
      if (/[0-9.]/.test(c)) {
        let n = '';
        while (i < src.length && /[0-9.eE+-]/.test(src[i])) { n += src[i++]; }
        tokens.push({ t: TOK.NUM, v: parseFloat(n) });
        continue;
      }
      if (/[a-zA-Z_]/.test(c)) {
        let id = '';
        while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) { id += src[i++]; }
        tokens.push({ t: TOK.ID, v: id });
        continue;
      }
      if ('+-*/%^(),<>=!&|'.includes(c)) {
        let op = c; i++;
        if ((c === '<' || c === '>' || c === '=' || c === '!') && src[i] === '=') { op += src[i++]; }
        if (c === '&' && src[i] === '&') { op = '&&'; i++; }
        if (c === '|' && src[i] === '|') { op = '||'; i++; }
        if (c === '^' && src[i] === '^') { op = '^^'; i++; }
        if ('(),'.includes(op)) tokens.push({ t: op });
        else tokens.push({ t: TOK.OP, v: op });
        continue;
      }
      i++;
    }
    tokens.push({ t: TOK.EOF });
    return tokens;
  }

  class Parser {
    constructor(tokens, ctx) {
      this.toks = tokens;
      this.p = 0;
      this.ctx = ctx;
    }
    peek() { return this.toks[this.p]; }
    eat(t) {
      const tk = this.toks[this.p];
      if (t && tk.t !== t && !(t === TOK.OP && tk.t === TOK.OP)) throw new Error('parse err at ' + this.p);
      this.p++;
      return tk;
    }

    parse() { return this.logicOr(); }

    logicOr() {
      let l = this.logicAnd();
      while (this.peek().t === TOK.OP && this.peek().v === '||') {
        this.eat(); const r = this.logicAnd();
        l = l ? 1 : r ? 1 : 0;
      }
      return l;
    }
    logicAnd() {
      let l = this.bitOr();
      while (this.peek().t === TOK.OP && this.peek().v === '&&') {
        this.eat(); const r = this.bitOr();
        l = l && r ? 1 : 0;
      }
      return l;
    }
    bitOr() {
      let l = this.bitXor();
      while (this.peek().t === TOK.OP && this.peek().v === '|') {
        this.eat(); l = (l | this.bitXor()) >>> 0;
      }
      return l;
    }
    bitXor() {
      let l = this.cmp();
      while (this.peek().t === TOK.OP && this.peek().v === '^^') {
        this.eat(); l = (l ^ this.cmp()) >>> 0;
      }
      return l;
    }
    cmp() {
      let l = this.add();
      while (this.peek().t === TOK.OP && ['<', '>', '<=', '>=', '==', '!='].includes(this.peek().v)) {
        const op = this.eat().v; const r = this.add();
        l = op === '<' ? (l < r ? 1 : 0) : op === '>' ? (l > r ? 1 : 0)
          : op === '<=' ? (l <= r ? 1 : 0) : op === '>=' ? (l >= r ? 1 : 0)
          : op === '==' ? (l === r ? 1 : 0) : (l !== r ? 1 : 0);
      }
      return l;
    }
    add() {
      let l = this.mul();
      while (this.peek().t === TOK.OP && (this.peek().v === '+' || this.peek().v === '-')) {
        const op = this.eat().v; const r = this.mul();
        l = op === '+' ? l + r : l - r;
      }
      return l;
    }
    mul() {
      let l = this.pow();
      while (this.peek().t === TOK.OP && (this.peek().v === '*' || this.peek().v === '/' || this.peek().v === '%')) {
        const op = this.eat().v; const r = this.pow();
        l = op === '*' ? l * r : op === '/' ? l / r : l % r;
      }
      return l;
    }
    pow() {
      let l = this.unary();
      if (this.peek().t === TOK.OP && this.peek().v === '^') {
        this.eat(); l = Math.pow(l, this.pow());
      }
      return l;
    }
    unary() {
      const tk = this.peek();
      if (tk.t === TOK.OP && tk.v === '-') { this.eat(); return -this.unary(); }
      if (tk.t === TOK.OP && tk.v === '+') { this.eat(); return this.unary(); }
      if (tk.t === TOK.ID && tk.v === 'int' && this.peek(1)?.t === '(') {
        this.eat(); this.eat('('); const v = this.parse(); this.eat(')'); return v | 0;
      }
      if (tk.t === TOK.ID && tk.v === 'float' && this.peek(1)?.t === '(') {
        this.eat(); this.eat('('); const v = this.parse(); this.eat(')'); return +v;
      }
      return this.primary();
    }
    primary() {
      const tk = this.peek();
      if (tk.t === TOK.NUM) { this.eat(); return tk.v; }
      if (tk.t === TOK.STR) { this.eat(); return this.evalQuoted(tk.v); }
      if (tk.t === TOK.ID) {
        const name = tk.v;
        this.eat();
        if (name === 'PI') return PI;
        if (name === 'BASS') return this.ctx.BASS || 0;
        if (name === 'WIDTH') return this.ctx.WIDTH || 1;
        if (name === 'HEIGHT') return this.ctx.HEIGHT || 1;
        if (name === 'X_EXTENTS') return this.ctx.X_EXTENTS ?? 1;
        if (name === 'Y_EXTENTS') return this.ctx.Y_EXTENTS ?? 1;
        if (name === 'NUM_FFT_BINS') return this.ctx.NUM_FFT_BINS || 64;
        if (name === 'NUM_SAMPLE_BINS') return this.ctx.NUM_SAMPLE_BINS || 512;
        if (name === 'NUM_S_STEPS') return this.ctx.NUM_S_STEPS || 256;
        if (this.peek().t === '(') {
          this.eat('(');
          const args = [];
          if (this.peek().t !== ')') {
            args.push(this.parse());
            while (this.peek().t === ',') { this.eat(); args.push(this.parse()); }
          }
          this.eat(')');
          const fn = FUNCS[name];
          if (!fn) throw new Error('unknown fn ' + name);
          return fn.length > 1 ? fn(...args, this.ctx) : fn(...args);
        }
        if (Object.prototype.hasOwnProperty.call(this.ctx.vars, name)) return this.ctx.vars[name];
        if (Object.prototype.hasOwnProperty.call(this.ctx, name)) return this.ctx[name];
        return 0;
      }
      if (tk.t === '(') {
        this.eat('('); const v = this.parse(); this.eat(')'); return v;
      }
      throw new Error('unexpected token ' + JSON.stringify(tk));
    }
    evalQuoted(s) {
      return new Parser(tokenize(s), this.ctx).parse();
    }
  }

  function compileFormula(expr, baseCtx = {}) {
    const tokens = tokenize(expr);
    return (ctx) => {
      const merged = Object.create(null);
      merged.vars = { ...baseCtx.vars, ...ctx.vars };
      merged.rng = ctx.rng || baseCtx.rng || new RNG();
      merged.fftBin = ctx.fftBin || (() => 0);
      merged.magBin = ctx.magBin || (() => 0);
      for (const k of ['t', 's', 'dt', 'r', 'theta', 'x', 'y', 'row', 'Rows', 'WIDTH', 'HEIGHT', 'X_EXTENTS', 'Y_EXTENTS', 'BASS', 'NUM_FFT_BINS', 'NUM_SAMPLE_BINS', 'NUM_S_STEPS']) {
        if (ctx[k] !== undefined) merged[k] = ctx[k];
        else if (baseCtx[k] !== undefined) merged[k] = ctx[k];
      }
      return new Parser(tokens, merged).parse();
    };
  }

  function parseConfigText(text) {
    const raw = {};
    const lines = text.split(/\r?\n/);
    let inBlock = false;
    for (let line of lines) {
      if (inBlock) {
        if (line.includes('*/')) inBlock = false;
        continue;
      }
      if (line.trim().startsWith('/*')) { inBlock = !line.includes('*/'); continue; }
      const trimmed = line.replace(/\/\/.*$/, '').trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      raw[m[1]] = val;
    }
    return raw;
  }

  function buildConfig(raw, opts = {}) {
    const rng = new RNG(opts.seed ?? 42);
    const vars = {};
    const formulas = {};
    const evalOrder = [];

    const ctx = {
      rng,
      vars,
      fftBin: opts.fftBin || (() => 0),
      magBin: opts.magBin || (() => 0),
      WIDTH: opts.WIDTH || 512,
      HEIGHT: opts.HEIGHT || 512,
      X_EXTENTS: 1,
      Y_EXTENTS: 1,
      NUM_FFT_BINS: 64,
      NUM_SAMPLE_BINS: 512,
      NUM_S_STEPS: 256,
      BASS: 0,
    };

    const perPixel = /^(srcR|srcT|srcX|srcY|X\d*|Y\d*|C\d*|Z\d*|W\d*|LWdt|Pen|D\d*|B\d*|H|S|L|LvlH|LvlS|LvlL|Cam|Cm|CUp|Con|TMap)$/i;
    const perSample = /^(X|Y|Z|W|A)$/;

    // 1) скаляры и однократные A0/D0/…
    for (const [k, v] of Object.entries(raw)) {
      if (perPixel.test(k) || perSample.test(k)) continue;
      if (/^\d+$/.test(v)) vars[k] = parseFloat(v);
      else {
        try {
          vars[k] = compileFormula(v, { vars, rng })({ vars, rng, t: 0, s: 0, dt: 0 });
        } catch (_) {
          vars[k] = v;
        }
      }
    }
    // 2) per-pixel / per-sample формулы
    for (const [k, v] of Object.entries(raw)) {
      if (perPixel.test(k) || perSample.test(k)) {
        formulas[k] = compileFormula(v, { vars, rng });
        evalOrder.push(k);
      }
    }

    return {
      raw,
      vars,
      formulas,
      rng,
      aspic: vars.Aspc !== undefined ? vars.Aspc : (vars.ASPC !== undefined ? vars.ASPC : 0),
      vers: vars.Vers || 200,
      rows: vars.Rows || 0,
      eval(name, ctx) {
        const fn = formulas[name];
        if (!fn) return vars[name] ?? 0;
        return fn({ ...ctx, vars: { ...vars, ...ctx.vars }, rng });
      },
    };
  }

  global.SSFormula = { compileFormula, parseConfigText, buildConfig, RNG, PI, trwv, wrap };
})(typeof window !== 'undefined' ? window : globalThis);
