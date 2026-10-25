// Page curl: a WebGL page that bends around a moving cylinder, the way a
// sheet of paper does when you lift its corner (as in Apple Books).
//
// The turning page ("leaf") is a mesh in its own coordinates: u runs from
// the hinge (the spine, or the left edge of a single page) to the free edge,
// y from top to bottom. A fold line crosses it; everything on the free side
// of the line wraps around a cylinder of radius r and, past half a turn,
// lies back down on top of the page, upside down. Moving the fold line from
// beyond the free edge to the hinge (and shrinking r to nothing) turns the
// page over completely.
//
// Layers, drawn into one canvas over the book:
//   base  – the parts of the old spread that stay put until the leaf lands,
//           plus the shadows the leaf casts; everywhere else is transparent,
//           so the new page (already rendered underneath) shows through
//   leaf  – front: the old page; back: paper with the print showing through
//
// In "hole" mode (turning back on a single page) the leaf is the *new* page
// arriving: its flat front is cut out of the canvas so the live page shows,
// and the base is the whole old page.

const VS_BASE = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.999, 1.0); }`;

const COMMON = `
precision highp float;
uniform vec2 uRes;        // canvas size in css px
uniform float uHinge;     // hinge x (css px)
uniform float uSide;      // +1: leaf to the right of the hinge, -1: to the left
uniform vec3 uLeaf;       // leaf width, top, height
uniform vec3 uFold;       // fold point x, fold point y, radius (leaf coords)
uniform vec2 uN;          // fold normal (points to the free edge)
uniform vec4 uCap;        // texture region: x, y, w, h (css px)
uniform sampler2D uTex;
uniform float uRigid;     // >= 0: rigid flip at this angle (radians); < 0: curl

vec2 toLeaf(vec2 px) { return vec2((px.x - uHinge) * uSide, px.y - uLeaf.y); }
vec2 texAt(vec2 px) { return (px - uCap.xy) / uCap.zw; }

// How far a point that the flipped-over part covers lies outside the page:
// q is a point on the flat plane (leaf coords). Returns <0 if covered.
float flippedOutside(vec2 q) {
  float r = uFold.z;
  float dq = dot(q - uFold.xy, uN);
  if (dq > 0.0) return 1e4;
  vec2 v = q + uN * (3.14159265 * r - 2.0 * dq);
  vec2 o = max(vec2(-v.x, -v.y), v - vec2(uLeaf.x, uLeaf.z));
  return max(o.x, o.y);
}
`;

const FS_BASE = COMMON + `
uniform vec2 uStatic;     // x range (css px) where the old page stays put
uniform float uShadow;    // 0..1 strength of cast shadows
uniform float uDpr;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec4 c = vec4(0.0);
  if (px.x >= uStatic.x && px.x < uStatic.y && px.y >= uCap.y) {
    c = vec4(texture2D(uTex, texAt(px)).rgb, 1.0);
  }
  vec2 l = toLeaf(px);
  float sh = 0.0;
  if (l.x >= -2.0 && l.y >= -2.0 && l.y <= uLeaf.z + 2.0) {
    float d = dot(l - uFold.xy, uN);
    float r = uFold.z;
    // ambient occlusion under the lifted part, strongest at the fold
    if (d > 0.0 && l.x <= uLeaf.x) sh = 0.42 * exp(-d / (r * 1.6 + 6.0));
    // soft drop shadow around the part lying flipped over
    float o = flippedOutside(l);
    if (o > 0.0 && o < 60.0) sh = max(sh, 0.22 * exp(-o / 14.0) * clamp(r / 20.0 + 0.4, 0.0, 1.0));
  }
  if (uRigid >= 0.0 && l.y >= 0.0 && l.y <= uLeaf.z) {
    float s = sin(uRigid);
    // the lifted page shades the page it uncovers, most near the hinge,
    // and the page it is about to land on
    if (l.x >= 0.0 && l.x <= uLeaf.x) sh = max(sh, 0.30 * s * pow(clamp(1.0 - l.x / (uLeaf.x * 0.8), 0.0, 1.0), 1.5));
    if (l.x < 0.0) sh = max(sh, 0.20 * s * clamp(1.0 + l.x / (uLeaf.x * 0.6), 0.0, 1.0));
  }
  sh *= uShadow;
  gl_FragColor = vec4(c.rgb * (1.0 - sh), c.a + (1.0 - c.a) * sh);
}`;

const VS_LEAF = COMMON + `
attribute vec2 aUV;
uniform float uPersp;
varying vec2 vTex;
varying vec2 vLocal;
varying vec3 vNorm;
varying float vCurl;      // 0 flat, 1 on the cylinder, 2 flipped flat
void main() {
  vec2 p = aUV * vec2(uLeaf.x, uLeaf.z);
  vLocal = p;
  vec2 screen0 = vec2(uHinge + uSide * p.x, uLeaf.y + p.y);
  vTex = texAt(screen0);
  float r = max(uFold.z, 0.01);
  float d = dot(p - uFold.xy, uN);
  vec2 q = p;
  float z = 0.0;
  vec3 n = vec3(0.0, 0.0, 1.0);
  vCurl = 0.0;
  if (uRigid >= 0.0) {
    q = vec2(p.x * cos(uRigid), p.y);
    z = p.x * sin(uRigid);
    n = vec3(-sin(uRigid), 0.0, cos(uRigid));
    vCurl = uRigid > 0.001 ? 1.0 : 0.0;
  } else if (d > 0.0) {
    float circ = 3.14159265 * r;
    vec2 base = p - uN * d;
    if (d < circ) {
      float th = d / r;
      q = base + uN * (r * sin(th));
      z = r * (1.0 - cos(th));
      n = vec3(-uN * sin(th), cos(th));
      vCurl = 1.0;
    } else {
      q = base - uN * (d - circ);
      z = 2.0 * r;
      n = vec3(0.0, 0.0, -1.0);
      vCurl = 2.0;
    }
  }
  // back to screen; mirroring for a left-hand leaf flips the x of the normal
  vec2 s = vec2(uHinge + uSide * q.x, uLeaf.y + q.y);
  n.x *= uSide;
  vNorm = n;
  vec2 c = uRes * 0.5;
  s = c + (s - c) * (1.0 + z * uPersp);
  gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, -z * 0.0005, 1.0);
}`;

const FS_LEAF = COMMON + `
uniform vec3 uPaper;
uniform float uBackAlpha;
uniform float uFrontLive;
uniform float uShowThrough;
uniform float uShadow;
uniform vec3 uTint;       // night light / dimming applied to drawn paper
varying vec2 vTex;
varying vec2 vLocal;
varying vec3 vNorm;
varying float vCurl;
void main() {
  vec3 n = normalize(vNorm);
  bool front = n.z >= 0.0;
  vec3 nf = front ? n : -n;
  vec3 L = normalize(vec3(-0.35, -0.45, 1.0));
  float diff = clamp(dot(nf, L), 0.0, 1.0) / L.z;
  float shade = mix(0.42, 1.0, clamp(diff, 0.0, 1.0)) + 0.04 * clamp(diff - 1.0, 0.0, 1.0);
  vec3 V = vec3(0.0, 0.0, 1.0);
  float spec = pow(max(dot(reflect(-L, nf), V), 0.0), 10.0) * (vCurl > 0.5 && vCurl < 1.5 && uRigid < 0.0 ? 0.09 : 0.0);
  if (front) {
    if (uFrontLive > 0.5 && vCurl < 0.5) {
      // the arriving page lying in place: let the real page show through,
      // darkened by the shadow of the part still lifted over it
      float o = flippedOutside(vLocal);
      float sh = (o > 0.0 && o < 60.0) ? 0.22 * exp(-o / 14.0) * uShadow : 0.0;
      gl_FragColor = vec4(0.0, 0.0, 0.0, sh);
      return;
    }
    if (uFrontLive > 0.5 && uRigid >= 0.0) {
      float a = smoothstep(0.0, 0.9, uRigid) ;
      gl_FragColor = vec4(uPaper * uTint * shade * a, a);
      return;
    }
    vec3 col = uFrontLive > 0.5 ? uPaper * uTint : texture2D(uTex, vTex).rgb;
    if (vCurl < 0.5) {
      float o = flippedOutside(vLocal);
      if (o > 0.0 && o < 60.0) shade *= 1.0 - 0.22 * exp(-o / 14.0) * uShadow;
    }
    gl_FragColor = vec4(col * shade + spec, 1.0);
  } else {
    // print showing through the paper: only the ink, faintly, never the page
    vec3 front = uFrontLive > 0.5 ? uPaper * uTint : texture2D(uTex, vTex).rgb;
    float ink = clamp(length(front - uPaper * uTint) * 1.6, 0.0, 1.0);
    vec3 col = mix(uPaper * uTint, front, ink * uShowThrough);
    // a touch darker than the page, like the underside of a sheet
    col *= 0.94;
    float a = uBackAlpha;
    gl_FragColor = vec4((col * shade + spec) * a, a);
  }
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const hexRgb = (hex) => {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class Curl {
  constructor(host, { grid = [56, 40] } = {}) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'curl-canvas';
    this.canvas.hidden = true;
    host.append(this.canvas);
    this.grid = grid;
    this.ok = false;
    try { this.init(); this.ok = true; } catch (e) { console.warn('page curl unavailable:', e.message || e); }
  }

  init() {
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true, depth: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('no WebGL');
    this.gl = gl;
    this.base = program(gl, VS_BASE, FS_BASE);
    this.leaf = program(gl, VS_LEAF, FS_LEAF);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const [nx, ny] = this.grid;
    const uv = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) uv.push(i / nx, j / ny);
    const idx = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    this.mesh = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    this.index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.count = idx.length;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
  }

  // opts: { image, W, H, cap:{x,y,w,h}, hinge, side, leaf:{w,top,h}, stat:[x0,x1],
  //         frontLive, paper, tint, showThrough, persp }
  begin(opts) {
    if (!this.ok) return false;
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    this.o = { showThrough: 0.06, persp: 0.00035, stat: [0, 0], frontLive: false, tint: [1, 1, 1], ...opts };
    this.dpr = dpr;
    const cw = Math.round(opts.W * dpr), ch = Math.round(opts.H * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    Object.assign(this.canvas.style, { width: `${opts.W}px`, height: `${opts.H}px` });
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, opts.image);
    this.paper = hexRgb(opts.paper);
    return true;
  }

  show(on = true) { this.canvas.hidden = !on; }

  // Fold line and radius for a point in the turn.
  params(t, angle) {
    const w = this.o.leaf.w, h = this.o.leaf.h;
    const a = angle * Math.pow(1 - t, 1.3);
    const rMax = Math.max(28, Math.min(w * 0.14, 130));
    const r = Math.max(0.01, rMax * Math.pow(1 - t, 0.85) * Math.min(1, 0.35 + t * 5));
    const p0 = w + Math.abs(Math.tan(a)) * h * 0.5 + 2;
    return { a, r, p: p0 * (1 - t) };
  }

  // Where the free edge of the leaf is (leaf coords, along the page's
  // middle row) at a point in the turn: used to keep it under the pointer.
  edgeAt(t, angle) {
    const w = this.o.leaf.w;
    const { r, p } = this.params(t, angle);
    const d = w - p;
    if (d <= 0) return w;
    if (d < Math.PI * r) return p + r * Math.sin(d / r);
    return p - (d - Math.PI * r);
  }

  // The turn position that puts the free edge at leaf coordinate x.
  tForEdge(x, angle) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (this.edgeAt(mid, angle) > x) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // t: 0 (flat, not turned) .. 1 (turned over). angle: tilt of the fold line
  // (>0: the bottom corner leads). Returns nothing; draws one frame.
  draw(t, angle = 0.3, { backAlpha = 1, shadow = 1, rigid = false } = {}) {
    if (!this.ok || !this.o) return;
    const gl = this.gl, o = this.o;
    const w = o.leaf.w, h = o.leaf.h;
    const tt = Math.min(1, Math.max(0, t));
    let { a, r, p } = this.params(tt, angle);
    if (rigid) { a = 0; r = 0.01; p = -1e5; }
    const N = [Math.cos(a), Math.sin(a)];

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const set = (prog) => {
      const u = prog.u;
      gl.useProgram(prog.p);
      gl.uniform2f(u.uRes, o.W, o.H);
      gl.uniform1f(u.uHinge, o.hinge);
      gl.uniform1f(u.uSide, o.side);
      gl.uniform3f(u.uLeaf, w, o.leaf.top, h);
      gl.uniform3f(u.uFold, p, h * 0.5, r);
      gl.uniform2f(u.uN, N[0], N[1]);
      gl.uniform4f(u.uCap, o.cap.x, o.cap.y, o.cap.w, o.cap.h);
      gl.uniform1i(u.uTex, 0);
      if (u.uShadow) gl.uniform1f(u.uShadow, shadow);
      gl.uniform1f(u.uRigid, rigid ? Math.PI * tt : -1);
      return u;
    };

    // base layer
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    let u = set(this.base);
    gl.uniform2f(u.uStatic, o.stat[0], o.stat[1]);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const aPos = gl.getAttribLocation(this.base.p, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(aPos);

    // leaf: written over the base (no blending, so its alpha replaces the
    // base's and the live page can show through its back as it lands)
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    u = set(this.leaf);
    gl.uniform1f(u.uPersp, rigid ? o.persp * 1.6 : o.persp);
    gl.uniform3f(u.uPaper, ...this.paper);
    gl.uniform3f(u.uTint, ...o.tint);
    gl.uniform1f(u.uBackAlpha, backAlpha);
    gl.uniform1f(u.uFrontLive, o.frontLive ? 1 : 0);
    gl.uniform1f(u.uShowThrough, o.showThrough);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh);
    const aUV = gl.getAttribLocation(this.leaf.p, 'aUV');
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(aUV);
  }

  destroy() {
    try { this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* gone */ }
    this.canvas.remove();
    this.ok = false;
  }

  end() {
    this.show(false);
    this.o = null;
    if (this.ok) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
  }
}
