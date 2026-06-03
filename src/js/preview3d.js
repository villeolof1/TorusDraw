// Accurate parameter-surface 3D preview.
// Everything in this renderer comes from the same single-cell (u, v) domain:
// surface, image texture, grid, and lifted paint ribbons.
import { state } from "./state.js";
import { clamp, determinant, dot, edgeTopology, length, worldToBasis } from "./math.js";

let canvas;
let gl;
let program;
let texture = null;
let textureSource = null;
let fallbackCtx = null;

const TAU = Math.PI * 2;
const STRIDE_FLOATS = 12;
const WARM_SURFACE = [0.985, 0.975, 0.945, 1.0];

export function initPreview3d() {
  canvas = state.ui.preview3dCanvas;
  gl = canvas.getContext("webgl", { antialias: true, alpha: false }) || canvas.getContext("experimental-webgl", { antialias: true, alpha: false });
  if (!gl || typeof gl.createShader !== "function") gl = null;

  if (gl) program = createProgram(gl, vertexShaderSource(), fragmentShaderSource());
  else fallbackCtx = canvas.getContext("2d");

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerEnd);
  canvas.addEventListener("pointercancel", handlePointerEnd);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
}

export function resetPreviewAngle() {
  state.preview.zoom = 1.0;
  const topo = edgeTopology(state.surface);
  if (topo.repeatV1 && topo.repeatV2) {
    state.preview.yaw = -0.74;
    state.preview.pitch = 0.45;
  } else if (topo.repeatV1) {
    state.preview.yaw = -0.56;
    state.preview.pitch = 0.42;
  } else if (topo.repeatV2) {
    state.preview.yaw = 1.08;
    state.preview.pitch = 0.34;
  } else {
    state.preview.yaw = -0.62;
    state.preview.pitch = 0.62;
  }
  drawPreview3d();
}

function vertexShaderSource() {
  return `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    attribute vec4 aColor;
    uniform float uYaw;
    uniform float uPitch;
    uniform float uAspect;
    uniform float uCameraDistance;
    uniform float uFov;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;

    vec3 rotateModel(vec3 p) {
      float cy = cos(uYaw), sy = sin(uYaw);
      float cp = cos(uPitch), sp = sin(uPitch);
      vec3 y = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
      return vec3(y.x, y.y * cp - y.z * sp, y.y * sp + y.z * cp);
    }

    void main() {
      vec3 view = rotateModel(aPosition);
      vec3 normal = normalize(rotateModel(aNormal));
      view.z -= uCameraDistance;
      float near = 0.1;
      float far = 100.0;
      float f = 1.0 / tan(uFov * 0.5);
      gl_Position = vec4(
        (f / uAspect) * view.x,
        f * view.y,
        ((far + near) / (near - far)) * view.z + ((2.0 * far * near) / (near - far)),
        -view.z
      );
      vNormal = normal;
      vUV = aUV;
      vColor = aColor;
    }
  `;
}

function fragmentShaderSource() {
  return `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform bool uUseTexture;
    uniform bool uUseLighting;
    uniform vec4 uTexRect;
    uniform float uImageStrength;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;

    void main() {
      vec4 base = vColor;
      if (uUseTexture) {
        vec2 t = vec2(uTexRect.x + vUV.x * uTexRect.z, uTexRect.y + (1.0 - vUV.y) * uTexRect.w);
        vec4 tex = texture2D(uTexture, t);
        vec3 warm = vec3(0.985, 0.975, 0.945);
        base.rgb = mix(warm, tex.rgb, clamp(uImageStrength, 0.0, 1.0));
        base.a = 1.0;
      }
      if (uUseLighting) {
        vec3 n = normalize(vNormal);
        vec3 light = normalize(vec3(-0.35, 0.72, 0.82));
        float l = 0.82 + 0.18 * max(dot(n, light), 0.0);
        base.rgb *= l;
      }
      gl_FragColor = base;
    }
  `;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return {
    raw: p,
    aPosition: gl.getAttribLocation(p, "aPosition"),
    aNormal: gl.getAttribLocation(p, "aNormal"),
    aUV: gl.getAttribLocation(p, "aUV"),
    aColor: gl.getAttribLocation(p, "aColor"),
    uYaw: gl.getUniformLocation(p, "uYaw"),
    uPitch: gl.getUniformLocation(p, "uPitch"),
    uAspect: gl.getUniformLocation(p, "uAspect"),
    uCameraDistance: gl.getUniformLocation(p, "uCameraDistance"),
    uFov: gl.getUniformLocation(p, "uFov"),
    uTexture: gl.getUniformLocation(p, "uTexture"),
    uUseTexture: gl.getUniformLocation(p, "uUseTexture"),
    uUseLighting: gl.getUniformLocation(p, "uUseLighting"),
    uTexRect: gl.getUniformLocation(p, "uTexRect"),
    uImageStrength: gl.getUniformLocation(p, "uImageStrength")
  };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function resizePreviewCanvas() {
  const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width * ratio));
  const height = Math.max(220, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function shapeType() {
  const topo = edgeTopology(state.surface);
  if (topo.repeatV1 && topo.repeatV2) return (topo.flipU || topo.flipV) ? "Klein" : "Torus";
  if (topo.repeatV1 || topo.repeatV2) return (topo.flipU || topo.flipV) ? "Mobius" : "Cylinder";
  return "Plane";
}

function modelParameters() {
  const topo = edgeTopology(state.surface);
  const l1 = Math.max(1, length(state.surface.v1));
  const l2 = Math.max(1, length(state.surface.v2));
  const det = determinant(state.surface);
  const areaHeight = Math.max(1, Math.abs(det) / l1);
  const skew = dot(state.surface.v2, state.surface.v1) / Math.max(1, l1 * l1);
  const type = shapeType();

  if (type === "Torus") {
    let R = 1.28;
    let r = clamp((areaHeight / l1) * 1.18, 0.20, 0.82);
    return { type, l1, l2, R, r, skew: clamp(skew, -1.8, 1.8), repeatV1: topo.repeatV1, repeatV2: topo.repeatV2, flipU: topo.flipU, flipV: topo.flipV };
  }

  if (type === "Klein") return { type, l1, l2, R: 1.08, r: 0.36, skew: clamp(skew, -1.2, 1.2), repeatV1: topo.repeatV1, repeatV2: topo.repeatV2, flipU: topo.flipU, flipV: topo.flipV };

  if (type === "Cylinder" || type === "Mobius") {
    const repeatIsV1 = topo.repeatV1;
    const repeatVector = repeatIsV1 ? state.surface.v1 : state.surface.v2;
    const openVector = repeatIsV1 ? state.surface.v2 : state.surface.v1;
    const repeatLength = Math.max(1, length(repeatVector));
    const openLength = Math.max(1, length(openVector));
    const openPerp = Math.max(openLength * 0.25, Math.abs(det) / repeatLength);
    return {
      type, repeatIsV1, repeatV1: topo.repeatV1, repeatV2: topo.repeatV2, flipU: topo.flipU, flipV: topo.flipV,
      radius: type === "Mobius" ? 0.92 : 0.78,
      width: clamp(openPerp / repeatLength * 1.15, 0.32, 0.82),
      height: clamp(openPerp / repeatLength * 4.3, 1.15, 3.0),
      skew: clamp(dot(openVector, repeatVector) / Math.max(1, repeatLength * repeatLength), -1.8, 1.8),
      l1, l2
    };
  }

  const maxLen = Math.max(l1, l2, 1);
  return { type, planeScale: 2.4 / maxLen, l1, l2, repeatV1: topo.repeatV1, repeatV2: topo.repeatV2, flipU: topo.flipU, flipV: topo.flipV };
}

function surfacePoint(u, v, params) {
  if (params.type === "Torus") {
    const theta = TAU * mod1(u + params.skew * v);
    const phi = TAU * mod1(v);
    return [
      (params.R + params.r * Math.cos(phi)) * Math.cos(theta),
      params.r * Math.sin(phi),
      (params.R + params.r * Math.cos(phi)) * Math.sin(theta)
    ];
  }

  if (params.type === "Mobius") {
    const repeat = params.repeatIsV1 ? u : v;
    const open = params.repeatIsV1 ? v : u;
    const theta = TAU * repeat;
    const w = (open - 0.5) * params.width;
    const x = (params.radius + w * Math.cos(theta / 2)) * Math.cos(theta);
    const y = w * Math.sin(theta / 2);
    const z = (params.radius + w * Math.cos(theta / 2)) * Math.sin(theta);
    return params.repeatIsV1 ? [x, y, z] : [y, x, z];
  }

  if (params.type === "Klein") {
    const uu = TAU * (params.flipV ? v : u);
    const vv = TAU * (params.flipV ? u : v);
    const tube = Math.cos(uu / 2) * Math.sin(vv) - Math.sin(uu / 2) * Math.sin(2 * vv);
    const x = (params.R + params.r * tube) * Math.cos(uu);
    const z = (params.R + params.r * tube) * Math.sin(uu);
    const y = params.r * (Math.sin(uu / 2) * Math.sin(vv) + Math.cos(uu / 2) * Math.sin(2 * vv));
    return [x, y, z];
  }

  if (params.type === "Cylinder") {
    const repeat = params.repeatIsV1 ? u : v;
    const open = params.repeatIsV1 ? v : u;
    const theta = TAU * mod1(repeat + params.skew * open);
    const h = (open - 0.5) * params.height;
    const x = params.radius * Math.cos(theta);
    const z = params.radius * Math.sin(theta);
    return params.repeatIsV1 ? [x, h, z] : [h, x, z];
  }

  const p = [
    state.surface.v1.x * u + state.surface.v2.x * v,
    -(state.surface.v1.y * u + state.surface.v2.y * v),
    0
  ];
  return [p[0] * params.planeScale, p[1] * params.planeScale, p[2]];
}

function surfaceNormal(u, v, params) {
  const e = 0.001;
  const p = surfacePoint(u, v, params);
  const pu = surfacePoint(u + e, v, params);
  const pv = surfacePoint(u, v + e, params);
  return normalize(cross(sub3(pv, p), sub3(pu, p)));
}

function mod1(value) { return ((value % 1) + 1) % 1; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a) { const l = Math.max(0.000001, len3(a)); return [a[0] / l, a[1] / l, a[2] / l]; }
function clampUV(uv) { return { u: clamp(uv.u, 0, 1), v: clamp(uv.v, 0, 1) }; }

function pushVertex(out, pos, normal, uv, color) {
  out.push(pos[0], pos[1], pos[2], normal[0], normal[1], normal[2], uv.u, uv.v, color[0], color[1], color[2], color[3]);
}

function pushTri(out, a, b, c, color) {
  pushVertex(out, a.pos, a.normal, a.uv, color);
  pushVertex(out, b.pos, b.normal, b.uv, color);
  pushVertex(out, c.pos, c.normal, c.uv, color);
}

function surfaceVertex(u, v, params, lift = 0) {
  const uv = { u: clamp(u, 0, 1), v: clamp(v, 0, 1) };
  const normal = surfaceNormal(uv.u, uv.v, params);
  const pos = add3(surfacePoint(uv.u, uv.v, params), scale3(normal, lift));
  return { pos, normal, uv };
}

function buildSurfaceMesh(params) {
  const out = [];
  const uSteps = params.type === "Plane" ? 1 : (params.type === "Torus" || params.type === "Klein") ? 128 : 96;
  const vSteps = params.type === "Plane" ? 1 : (params.type === "Torus" || params.type === "Klein") ? 64 : 48;
  for (let i = 0; i < uSteps; i++) {
    const u0 = i / uSteps;
    const u1 = (i + 1) / uSteps;
    for (let j = 0; j < vSteps; j++) {
      const v0 = j / vSteps;
      const v1 = (j + 1) / vSteps;
      const a = surfaceVertex(u0, v0, params);
      const b = surfaceVertex(u1, v0, params);
      const c = surfaceVertex(u1, v1, params);
      const d = surfaceVertex(u0, v1, params);
      pushTri(out, a, b, c, WARM_SURFACE);
      pushTri(out, a, c, d, WARM_SURFACE);
    }
  }
  return new Float32Array(out);
}

function buildGridMesh(params) {
  const out = [];
  const gridColor = [0.12, 0.12, 0.12, 0.42];
  const uLines = params.type === "Plane" ? 8 : 16;
  const vLines = params.type === "Plane" ? 8 : 14;
  for (let i = 0; i <= uLines; i++) pushRibbonFromUVLine(out, t => ({ u: i / uLines, v: t }), params, 0.006, 0.009, gridColor);
  for (let j = 0; j <= vLines; j++) pushRibbonFromUVLine(out, t => ({ u: t, v: j / vLines }), params, 0.006, 0.009, gridColor);
  return new Float32Array(out);
}

function pushRibbonFromUVLine(out, fn, params, halfWidth, lift, color) {
  const samples = [];
  const count = 160;
  for (let i = 0; i <= count; i++) samples.push(fn(i / count));
  for (const path of splitAndGluePolyline(samples, params)) pushRibbon(out, path, params, halfWidth, lift, color);
}

function buildStrokeMesh(params) {
  const out = [];
  if (Math.abs(determinant(state.surface)) < 0.001) return new Float32Array(out);
  for (const object of state.objects) {
    if (!object.points || object.points.length < 2) continue;
    const paths = objectToUVPaths(object, params);
    const color = cssColorToRgba(object.color || "#111111");
    const halfWidth = strokeHalfWidth(object, params);
    const haloColor = [0.995, 0.985, 0.955, 0.92];
    for (const path of paths) {
      if (state.preview.enhanced) pushRibbon(out, path, params, halfWidth + 0.010, 0.024, haloColor);
      pushRibbon(out, path, params, halfWidth, 0.030, color);
    }
  }
  return new Float32Array(out);
}

function strokeHalfWidth(object, params) {
  const l1 = Math.max(1, length(state.surface.v1));
  const l2 = Math.max(1, length(state.surface.v2));
  let scalePerWorld = 0.003;
  if (params.type === "Torus" || params.type === "Klein") scalePerWorld = ((TAU * (params.R || 1)) / l1 + (TAU * (params.r || 0.35)) / l2) * 0.5;
  if (params.type === "Cylinder" || params.type === "Mobius") scalePerWorld = ((TAU * params.radius) / (params.repeatIsV1 ? l1 : l2) + (params.height || params.width) / (params.repeatIsV1 ? l2 : l1)) * 0.5;
  if (params.type === "Plane") scalePerWorld = params.planeScale;
  const accurate = (object.size || 1) * scalePerWorld * 0.5;
  const enhanced = Math.max(accurate * 1.9, 0.014);
  return clamp(state.preview.enhanced ? enhanced : accurate, 0.0035, state.preview.enhanced ? 0.042 : 0.022);
}

function objectToUVPaths(object, params) {
  const basisPoints = object.points.map(point => worldToBasis(point, state.surface)).filter(Boolean);
  return splitAndGluePolyline(basisPoints, params);
}

function splitAndGluePolyline(points, params) {
  const paths = [];
  let current = [];
  const pushCurrent = () => { if (current.length > 1) paths.push(current); current = []; };

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) { pushCurrent(); continue; }
    for (const piece of splitAndGlueSegment(a, b, params)) {
      const sampled = sampleSegment(piece[0], piece[1], params);
      if (sampled.length < 2) continue;
      const first = sampled[0];
      const last = current[current.length - 1];
      if (!last || uvDistance(last, first) > 0.025) pushCurrent();
      if (!current.length) current.push(first);
      for (let k = 1; k < sampled.length; k++) current.push(sampled[k]);
    }
  }
  pushCurrent();
  return paths;
}

function splitAndGlueSegment(a, b, params) {
  const cuts = collectBoundaryCuts(a, b, params);
  const pieces = [];
  for (let i = 1; i < cuts.length; i++) {
    let t0 = cuts[i - 1];
    let t1 = cuts[i];
    if (t1 - t0 < 0.00001) continue;
    const mid = lerpUV(a, b, (t0 + t1) / 2);
    if (!isVisibleLiftedUV(mid, params)) continue;

    const crossed = t0 > 0.000001 || t1 < 0.999999;
    const p0 = lerpUV(a, b, t0 === 0 ? t0 : t0 + 0.000001);
    const p1 = lerpUV(a, b, t1 === 1 ? t1 : t1 - 0.000001);
    const c0 = cellUVFromLifted(p0, params);
    const c1 = cellUVFromLifted(p1, params);

    // If a seam produced a long in-cell jump, do not draw a chord through the 3D model.
    // The neighboring local piece will carry the continuation on the glued side.
    if (crossed && uvDistance(c0, c1) > 0.78) continue;
    pieces.push([c0, c1]);
  }
  return pieces;
}

function collectBoundaryCuts(a, b, params) {
  const cuts = [0, 1];
  addAxisCuts(cuts, a.u, b.u, axisRepeats("u", params) || axisOpen("u", params));
  addAxisCuts(cuts, a.v, b.v, axisRepeats("v", params) || axisOpen("v", params));
  cuts.sort((x, y) => x - y);
  return cuts.filter((t, i) => t >= -0.000001 && t <= 1.000001 && (i === 0 || Math.abs(t - cuts[i - 1]) > 0.00001));
}

function addAxisCuts(cuts, a, b, active) {
  if (!active || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) < 0.000001) return;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const first = Math.ceil(lo + 0.000001);
  const last = Math.floor(hi - 0.000001);
  for (let boundary = first; boundary <= last; boundary++) cuts.push((boundary - a) / (b - a));
  if (lo < 0 && hi > 0) cuts.push((0 - a) / (b - a));
  if (lo < 1 && hi > 1) cuts.push((1 - a) / (b - a));
}

function axisRepeats(axis, params) { return axis === "u" ? !!params.repeatV1 : !!params.repeatV2; }
function axisOpen(axis, params) { return !axisRepeats(axis, params) && (params.type === "Plane" || params.type === "Cylinder" || params.type === "Mobius"); }

function cellUVFromLifted(uv, params) {
  const iu = params.repeatV1 ? Math.floor(uv.u) : 0;
  const iv = params.repeatV2 ? Math.floor(uv.v) : 0;
  let cu = params.repeatV1 ? uv.u - iu : uv.u;
  let cv = params.repeatV2 ? uv.v - iv : uv.v;
  if (params.flipV && params.repeatV1 && Math.abs(iu) % 2 === 1) cv = 1 - cv;
  if (params.flipU && params.repeatV2 && Math.abs(iv) % 2 === 1) cu = 1 - cu;
  return { u: clamp(cu, 0, 1), v: clamp(cv, 0, 1) };
}

function isVisibleLiftedUV(uv, params) {
  if (params.type === "Torus" || params.type === "Klein") return true;
  if (params.type === "Cylinder" || params.type === "Mobius") {
    const open = params.repeatV1 ? uv.v : uv.u;
    return open >= -0.001 && open <= 1.001;
  }
  return uv.u >= -0.001 && uv.u <= 1.001 && uv.v >= -0.001 && uv.v <= 1.001;
}

function lerpUV(a, b, t) { return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t }; }
function uvDistance(a, b) { return Math.hypot(a.u - b.u, a.v - b.v); }

function sampleSegment(a, b, params) {
  const distance = Math.max(Math.abs(b.u - a.u), Math.abs(b.v - a.v));
  const count = clamp(Math.ceil(distance * 260), 2, 96);
  const samples = [];
  for (let i = 0; i <= count; i++) samples.push(clampUV(lerpUV(a, b, i / count)));
  return samples;
}

function pushRibbon(out, uvPath, params, halfWidth, lift, color) {
  if (uvPath.length < 2) return;
  const left = [];
  const right = [];
  for (let i = 0; i < uvPath.length; i++) {
    const prev = uvPath[Math.max(0, i - 1)];
    const next = uvPath[Math.min(uvPath.length - 1, i + 1)];
    const uv = uvPath[i];
    const normal = surfaceNormal(uv.u, uv.v, params);
    const p = add3(surfacePoint(uv.u, uv.v, params), scale3(normal, lift));
    const pPrev = surfacePoint(prev.u, prev.v, params);
    const pNext = surfacePoint(next.u, next.v, params);
    const tangent = normalize(sub3(pNext, pPrev));
    let side = normalize(cross(normal, tangent));
    if (len3(side) < 0.001) side = [1, 0, 0];
    left.push({ pos: add3(p, scale3(side, halfWidth)), normal, uv });
    right.push({ pos: add3(p, scale3(side, -halfWidth)), normal, uv });
  }
  for (let i = 1; i < uvPath.length; i++) {
    pushTri(out, left[i - 1], right[i - 1], right[i], color);
    pushTri(out, left[i - 1], right[i], left[i], color);
  }
}

function cssColorToRgba(value) {
  if (!value || value[0] !== "#") return [0.07, 0.07, 0.07, 1];
  const hex = value.slice(1);
  const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
  const num = Number.parseInt(full, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255, 1];
}

function uploadTextureIfNeeded() {
  if (!state.background.image) return null;
  if (texture && textureSource === state.background.image) return texture;
  if (!texture) texture = gl.createTexture();
  textureSource = state.background.image;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.background.image);
  return texture;
}

function textureRect() {
  const iw = state.background.naturalWidth || 1;
  const ih = state.background.naturalHeight || 1;
  if (state.imageFitMode === "stretch") return [0, 0, 1, 1];
  const cellAspect = Math.max(1, length(state.surface.v1)) / Math.max(1, length(state.surface.v2));
  const imageAspect = iw / ih;
  if (imageAspect > cellAspect) {
    const sw = ih * cellAspect;
    return [(iw - sw) / 2 / iw, 0, sw / iw, 1];
  }
  const sh = iw / cellAspect;
  return [0, (ih - sh) / 2 / ih, 1, sh / ih];
}

function drawMesh(data, options) {
  if (!data.length) return;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
  const stride = STRIDE_FLOATS * 4;
  gl.vertexAttribPointer(program.aPosition, 3, gl.FLOAT, false, stride, 0);
  gl.vertexAttribPointer(program.aNormal, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.vertexAttribPointer(program.aUV, 2, gl.FLOAT, false, stride, 6 * 4);
  gl.vertexAttribPointer(program.aColor, 4, gl.FLOAT, false, stride, 8 * 4);
  gl.enableVertexAttribArray(program.aPosition);
  gl.enableVertexAttribArray(program.aNormal);
  gl.enableVertexAttribArray(program.aUV);
  gl.enableVertexAttribArray(program.aColor);
  gl.uniform1i(program.uUseTexture, options.useTexture ? 1 : 0);
  gl.uniform1i(program.uUseLighting, options.lighting ? 1 : 0);
  gl.uniform4fv(program.uTexRect, options.texRect || [0, 0, 1, 1]);
  gl.uniform1f(program.uImageStrength, options.imageStrength ?? 0);
  if (options.texture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, options.texture);
    gl.uniform1i(program.uTexture, 0);
  }
  gl.drawArrays(gl.TRIANGLES, 0, data.length / STRIDE_FLOATS);
  gl.deleteBuffer(buffer);
}

export function drawPreview3d() {
  if (!canvas) return;
  resizePreviewCanvas();
  if (!gl) return drawFallback();

  const params = modelParameters();
  const surface = buildSurfaceMesh(params);
  const grid = buildGridMesh(params);
  const strokes = buildStrokeMesh(params);
  const tex = uploadTextureIfNeeded();

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(1.0, 0.995, 0.975, 1.0);
  gl.clearDepth(1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(program.raw);
  gl.uniform1f(program.uYaw, state.preview.yaw);
  gl.uniform1f(program.uPitch, state.preview.pitch);
  gl.uniform1f(program.uAspect, canvas.width / Math.max(1, canvas.height));
  gl.uniform1f(program.uCameraDistance, 5.1 / Math.max(0.55, state.preview.zoom));
  gl.uniform1f(program.uFov, 0.72);

  gl.depthMask(true);
  drawMesh(surface, { useTexture: !!tex, texture: tex, texRect: textureRect(), imageStrength: state.imageOpacity, lighting: true });
  drawMesh(grid, { useTexture: false, lighting: false });
  drawMesh(strokes, { useTexture: false, lighting: false });

  updateSummary(params);
}

function updateSummary(params) {
  if (!state.ui.preview3dSummary) return;
  const name = params.type;
  const l1 = Math.round(length(state.surface.v1));
  const l2 = Math.round(length(state.surface.v2));
  state.ui.preview3dSummary.textContent = `${name} preview · single cell mapped to 3D · |v1| ${l1} · |v2| ${l2}`;
}

function drawFallback() {
  const ctx = fallbackCtx || canvas.getContext("2d");
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#6f6a60";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("3D preview needs WebGL in this browser.", 18, 32);
}

function handlePointerDown(event) {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  state.preview.dragging = true;
  state.preview.last = { x: event.clientX, y: event.clientY, yaw: state.preview.yaw, pitch: state.preview.pitch };
  canvas.classList.add("dragging");
}

function handlePointerMove(event) {
  if (!state.preview.dragging || !state.preview.last) return;
  event.preventDefault();
  state.preview.yaw = state.preview.last.yaw + (event.clientX - state.preview.last.x) * 0.012;
  state.preview.pitch = clamp(state.preview.last.pitch + (event.clientY - state.preview.last.y) * 0.01, -1.25, 1.25);
  drawPreview3d();
}

function handlePointerEnd(event) {
  if (!state.preview.dragging) return;
  event.preventDefault();
  state.preview.dragging = false;
  state.preview.last = null;
  canvas.classList.remove("dragging");
}

function handleWheel(event) {
  event.preventDefault();
  state.preview.zoom = clamp(state.preview.zoom * Math.exp(-event.deltaY * 0.0012), 0.65, 2.8);
  drawPreview3d();
}
