// WebGL 3D preview generated strictly from the fundamental cell domain.
// The single source of truth for what is painted on the model is a rasterized
// cell texture built from the same strokes/background the user sees in 2D.
import { state } from "./state.js";
import { clamp, length } from "./math.js";
import { createSurfaceDomain } from "./surfaceDomain.js";
import { createSurfaceMap } from "./surfaceMap.js";

let canvas;
let gl;
let program;
let cellTexture = null;
let cachedTextureSignature = "";
let cachedBackgroundImage = null;
let cachedTextureCanvas = null;
let fallbackCtx = null;

const DEBUG_UV_COVERAGE = false;
const STRIDE_FLOATS = 12;
const LONG_TEXTURE_SIDE = 2048;
const MIN_TEXTURE_SIDE = 512;
const LARGE_STROKE_TEXTURE_ONLY = 72;
const WARM_SURFACE = [0.988, 0.980, 0.952, 1.0];
const GRID_COLOR = [0.10, 0.10, 0.10, 0.34];
const IMMERSION_GRID_COLOR = [0.08, 0.08, 0.08, 0.28];
const INSPECTION_GRID_COLOR = [0.08, 0.08, 0.08, 0.40];
const OPEN_BOUNDARY_COLOR = [0.04, 0.04, 0.04, 0.58];
const LINKED_SEAM_COLOR = [0.08, 0.08, 0.08, 0.22];
const DEFAULT_SURFACE_OPACITY = 1.0;

// Drawing overlays are real 3D geometry. These tiny lifts separate coincident
// marks so layer order is stable where strokes overlap on the same surface
// area, without being large enough to make far-side marks jump in front.
const STROKE_BASE_LIFT = 0.0022;
const STROKE_LAYER_LIFT = 0.0032;
const STROKE_OBJECT_LIFT = 0.00022;

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
  const domain = createSurfaceDomain(state.surface);
  state.preview.zoom = 1.0;
  if (domain.type === "klein") {
    state.preview.yaw = -0.55;
    state.preview.pitch = 0.28;
    state.preview.zoom = 1.08;
  } else if (domain.type === "double-reversed") {
    state.preview.yaw = -0.68;
    state.preview.pitch = 0.38;
    state.preview.zoom = 1.05;
  } else if (domain.type === "torus") {
    state.preview.yaw = -0.74;
    state.preview.pitch = 0.45;
  } else if (domain.topology.repeatV1) {
    state.preview.yaw = -0.56;
    state.preview.pitch = 0.42;
  } else if (domain.topology.repeatV2) {
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
      gl_Position = vec4((f / uAspect) * view.x, f * view.y, ((far + near) / (near - far)) * view.z + ((2.0 * far * near) / (near - far)), -view.z);
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
    uniform bool uTwoSidedLighting;
    uniform vec4 uTexRect;
    uniform float uImageStrength;
    uniform float uOpacity;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;

    void main() {
      vec4 base = vColor;
      if (uUseTexture) {
        vec2 t = vec2(uTexRect.x + vUV.x * uTexRect.z, uTexRect.y + (1.0 - vUV.y) * uTexRect.w);
        vec4 tex = texture2D(uTexture, t);
        vec3 warm = vec3(0.988, 0.980, 0.952);
        base.rgb = mix(warm, tex.rgb, clamp(uImageStrength, 0.0, 1.0));
        base.a = 1.0;
      }
      if (uUseLighting) {
        vec3 n = normalize(vNormal);
        vec3 light = normalize(vec3(-0.35, 0.72, 0.82));
        float lit = dot(n, light);
        float sided = uTwoSidedLighting ? abs(lit) : max(lit, 0.0);
        float l = 0.92 + 0.08 * sided;
        base.rgb *= l;
      }
      base.a *= clamp(uOpacity, 0.0, 1.0);
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
    uTwoSidedLighting: gl.getUniformLocation(p, "uTwoSidedLighting"),
    uTexRect: gl.getUniformLocation(p, "uTexRect"),
    uImageStrength: gl.getUniformLocation(p, "uImageStrength"),
    uOpacity: gl.getUniformLocation(p, "uOpacity")
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

function mapSteps(map) {
  if (map.type === "plane") return { u: 2, v: 2 };
  if (map.type === "cylinder" || map.type === "mobius") return { u: 112, v: 56 };
  if (map.type === "klein") return map.reversedV1 ? { u: 220, v: 88 } : { u: 88, v: 220 };
  if (map.type === "double-reversed") return { u: 180, v: 180 };
  return { u: 144, v: 80 };
}

function buildSurfaceMesh(map) {
  const out = [];
  const steps = mapSteps(map);
  const uIntervals = axisIntervals(steps.u, map.pieceBreaks?.u);
  const vIntervals = axisIntervals(steps.v, map.pieceBreaks?.v);
  let patches = 0;
  const expected = uIntervals.length * vIntervals.length;

  for (const [u0, u1] of uIntervals) {
    for (const [v0, v1] of vIntervals) {
      if (!map.isValidUV(u0, v0) || !map.isValidUV(u1, v0) || !map.isValidUV(u1, v1) || !map.isValidUV(u0, v1)) continue;
      pushQuad(out, map, u0, v0, u1, v1, surfaceColor(u0, v0));
      patches++;
    }
  }

  if (patches < expected * 0.995) console.warn("3D surface coverage incomplete", { type: map.type, patches, expected });
  return new Float32Array(out);
}

function axisIntervals(totalSteps, breaks = null) {
  if (!breaks || breaks.length < 2) {
    return Array.from({ length: totalSteps }, (_, i) => [i / totalSteps, (i + 1) / totalSteps]);
  }

  const cleanBreaks = [...new Set(breaks.map(value => clamp(value, 0, 1)))].sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < cleanBreaks.length; i++) {
    const start = cleanBreaks[i - 1];
    const end = cleanBreaks[i];
    const span = end - start;
    if (span <= 0) continue;
    const localSteps = Math.max(1, Math.round(totalSteps * span));
    for (let j = 0; j < localSteps; j++) {
      intervals.push([
        start + span * (j / localSteps),
        start + span * ((j + 1) / localSteps)
      ]);
    }
  }
  return intervals;
}

function surfaceColor(u, v) {
  return DEBUG_UV_COVERAGE ? [u, v, 0.5, 1] : WARM_SURFACE;
}

function pushQuad(out, map, u0, v0, u1, v1, color) {
  const a = surfaceVertex(map, u0, v0, 0);
  const b = surfaceVertex(map, u1, v0, 0);
  const c = surfaceVertex(map, u1, v1, 0);
  const d = surfaceVertex(map, u0, v1, 0);
  pushTri(out, a, b, c, color);
  pushTri(out, a, c, d, color);
}

function surfaceVertex(map, u, v, lift = 0) {
  const normal = map.normal(u, v);
  const pos = add3(map.point(u, v), scale3(normal, lift));
  const uv = map.textureUV(u, v);
  return { pos, normal, uv };
}

function buildGridMesh(map, domain) {
  const out = [];
  const nonOrientable = map.type === "mobius" || map.type === "klein" || map.type === "double-reversed";
  const divisions = map.type === "plane" ? 8 : map.type === "double-reversed" ? 20 : nonOrientable ? 18 : 14;
  const width = map.type === "plane" ? 0.0048 : nonOrientable ? 0.0058 : 0.0055;
  const mainGrid = map.representation === "immersion" ? IMMERSION_GRID_COLOR : map.representation === "inspection" ? INSPECTION_GRID_COLOR : GRID_COLOR;

  for (let i = 1; i < divisions; i++) {
    const u = i / divisions;
    addLocalGridPath(out, map, t => ({ u, v: t }), width, mainGrid);
  }
  for (let j = 1; j < divisions; j++) {
    const v = j / divisions;
    addLocalGridPath(out, map, t => ({ u: t, v }), width, mainGrid);
  }

  addBoundaryAndSeamLines(out, map, domain, width);
  return new Float32Array(out);
}

function addBoundaryAndSeamLines(out, map, domain, width) {
  const linkedU = domain.topology.repeatV1;
  const linkedV = domain.topology.repeatV2;
  const seamWidth = width * 0.78;
  const boundaryWidth = width * 1.55;

  if (linkedU) addLocalGridPath(out, map, t => ({ u: 0, v: t }), seamWidth, LINKED_SEAM_COLOR);
  else {
    addLocalGridPath(out, map, t => ({ u: 0, v: t }), boundaryWidth, OPEN_BOUNDARY_COLOR);
    addLocalGridPath(out, map, t => ({ u: 1, v: t }), boundaryWidth, OPEN_BOUNDARY_COLOR);
  }

  if (linkedV) addLocalGridPath(out, map, t => ({ u: t, v: 0 }), seamWidth, LINKED_SEAM_COLOR);
  else {
    addLocalGridPath(out, map, t => ({ u: t, v: 0 }), boundaryWidth, OPEN_BOUNDARY_COLOR);
    addLocalGridPath(out, map, t => ({ u: t, v: 1 }), boundaryWidth, OPEN_BOUNDARY_COLOR);
  }
}

function addLocalGridPath(out, map, fn, halfWidth, color) {
  const samples = [];
  const count = 170;
  for (let i = 0; i <= count; i++) samples.push(fn(i / count));
  pushRibbon(out, samples, map, halfWidth, 0.0005, color);
}

function objectUvPoints(object, domain) {
  return (object.points || []).map(point => domain.worldToCell(point)).filter(Boolean);
}

function densifyUvPath(points, maxStep = 0.035) {
  if (points.length < 2) return points.map(point => ({ ...point }));
  const dense = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const distance = Math.hypot((b.u || 0) - (a.u || 0), (b.v || 0) - (a.v || 0));
    const steps = Math.max(1, Math.ceil(distance / maxStep));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      dense.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return dense;
}

function uvDeltaForWorldDelta(dx, dy) {
  const v1 = state.surface.v1;
  const v2 = state.surface.v2;
  const det = v1.x * v2.y - v1.y * v2.x;
  if (Math.abs(det) < 0.000001) return { u: 0, v: 0 };
  return {
    u: (dx * v2.y - dy * v2.x) / det,
    v: (v1.x * dy - v1.y * dx) / det
  };
}

function dotRingUvPath(center, object) {
  const radius = Math.max(0.5, (object.size || 20) / 2);
  const segments = 72;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    const delta = uvDeltaForWorldDelta(Math.cos(angle) * radius, Math.sin(angle) * radius);
    points.push({ u: center.u + delta.u, v: center.v + delta.v });
  }
  return points;
}

function dotOutlineHalfWidth(object, map) {
  const outlineWorld = Math.max(1, (object.size || 20) * 0.13);
  return clamp(outlineWorld * (map.worldToModelScale || 0.003) * 0.5, 0.0045, 0.045);
}

function addDotMesh(out, object, map, domain, color, liftOffset = 0) {
  const centers = objectUvPoints(object, domain);
  if (!centers.length || color[3] <= 0) return;
  const halfWidth = dotOutlineHalfWidth(object, map);

  // A dot can cross a glued cell border. A single ring near u=0/u=1 or
  // v=0/v=1 can otherwise be clipped by the fundamental-domain split. We draw
  // small neighboring lifted copies too, then let the domain splitter/normalizer
  // decide which pieces belong on the visible surface. This is especially
  // important for torus/cylinder/Möbius/Klein/projective-plane seams.
  const uCopies = domain.topology?.repeatV1 ? [-1, 0, 1] : [0];
  const vCopies = domain.topology?.repeatV2 ? [-1, 0, 1] : [0];

  for (const rawCenter of centers) {
    for (const du of uCopies) {
      for (const dv of vCopies) {
        const center = { u: rawCenter.u + du, v: rawCenter.v + dv };
        const ring = dotRingUvPath(center, object);
        const paths = domain.splitPolylineByGluing(ring);
        for (const path of paths) {
          if (path.length < 2) continue;
          // Lift dots a bit more than strokes so the outline is not hidden by
          // the surface or by coincident seam geometry.
          pushRibbon(out, path, map, halfWidth, 0.010 + liftOffset, color);
        }
      }
    }
  }
}

function buildStrokeMesh(map, domain, targetLayer = null, layerLift = 0) {
  const out = [];
  let objectOrdinal = 0;

  for (const object of state.objects) {
    if (!object.points || !object.points.length) continue;
    const layer = layerForObject(object);
    if (layer?.visible === false) continue;
    if (targetLayer && (object.layerId || "layer-1") !== targetLayer.id) continue;

    const color = cssColorToRgba(object.color || "#111111");
    color[3] *= layer ? (layer.opacity ?? 1) : 1;
    if (color[3] <= 0) continue;

    const objectLift = STROKE_BASE_LIFT + layerLift + objectOrdinal * STROKE_OBJECT_LIFT;
    objectOrdinal++;

    if (object.type === "dot") {
      addDotMesh(out, object, map, domain, color, objectLift);
      continue;
    }

    if (object.points.length < 2) continue;

    // Drawings are depth-resolved as real 3D overlay geometry. A tiny
    // layer/object lift prevents z-fighting when thick colored strokes occupy
    // the same surface area, while true 3D depth still wins for far-side marks.
    const uvPoints = densifyUvPath(objectUvPoints(object, domain), object.type === "line" ? 0.018 : 0.035);
    const paths = domain.splitPolylineByGluing(uvPoints);
    const halfWidth = strokeHalfWidth(object, map);
    if (halfWidth == null) continue;
    for (const path of paths) {
      if (path.length < 2) continue;
      pushRibbon(out, path, map, halfWidth, 0.0014 + objectLift, color);
    }
  }
  return new Float32Array(out);
}

function strokeHalfWidth(object, map) {
  const accurate = (object.size || 1) * (map.worldToModelScale || 0.003) * 0.5;
  return clamp(accurate, 0.003, 0.12);
}

function pushRibbon(out, uvPath, map, halfWidth, lift, color) {
  if (uvPath.length < 2) return;
  const left = [];
  const right = [];
  let previousNormal = null;
  for (let i = 0; i < uvPath.length; i++) {
    const prev = uvPath[Math.max(0, i - 1)];
    const next = uvPath[Math.min(uvPath.length - 1, i + 1)];
    const uv = uvPath[i];
    let normal = map.normal(uv.u, uv.v);
    // Klein, Möbius, and projective-plane surfaces have no global outside. Keep each individual
    // stroke/grid ribbon locally continuous so it does not suddenly jump below
    // the surface after crossing an orientation-reversing seam.
    if (previousNormal && dot3(normal, previousNormal) < 0) normal = scale3(normal, -1);
    previousNormal = normal;

    const p = add3(map.point(uv.u, uv.v), scale3(normal, lift));
    const pPrev = map.point(prev.u, prev.v);
    const pNext = map.point(next.u, next.v);
    const tangent = normalize(sub3(pNext, pPrev));
    let side = normalize(cross(normal, tangent));
    if (len3(side) < 0.001) side = [1, 0, 0];
    left.push({ pos: add3(p, scale3(side, halfWidth)), normal, uv: map.textureUV(uv.u, uv.v) });
    right.push({ pos: add3(p, scale3(side, -halfWidth)), normal, uv: map.textureUV(uv.u, uv.v) });
  }
  for (let i = 1; i < uvPath.length; i++) {
    pushTri(out, left[i - 1], right[i - 1], right[i], color);
    pushTri(out, left[i - 1], right[i], left[i], color);
  }
}

function pushTri(out, a, b, c, color) {
  pushVertex(out, a.pos, a.normal, a.uv, color);
  pushVertex(out, b.pos, b.normal, b.uv, color);
  pushVertex(out, c.pos, c.normal, c.uv, color);
}

function pushVertex(out, pos, normal, uv, color) {
  if (!finite3(pos)) return;
  out.push(pos[0], pos[1], pos[2], normal[0], normal[1], normal[2], clamp(uv.u, 0, 1), clamp(uv.v, 0, 1), color[0], color[1], color[2], color[3]);
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
  gl.uniform1i(program.uTwoSidedLighting, options.twoSidedLighting ? 1 : 0);
  gl.uniform4fv(program.uTexRect, options.texRect || [0, 0, 1, 1]);
  gl.uniform1f(program.uImageStrength, options.imageStrength ?? 0);
  gl.uniform1f(program.uOpacity, options.opacity ?? 1.0);
  if (options.texture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, options.texture);
    gl.uniform1i(program.uTexture, 0);
  }
  gl.drawArrays(gl.TRIANGLES, 0, data.length / STRIDE_FLOATS);
  gl.deleteBuffer(buffer);
}

function buildCellTextureSignature(domain) {
  const surface = state.surface;
  const image = state.background.image;
  const layerSignature = (state.layers || []).map(layer => `${layer.id}:${layer.type}:${layer.visible !== false ? 1 : 0}:${round4(layer.opacity ?? 1)}:${layer.name}`).join(",");
  const objects = state.objects.map(object => {
    const first = object.points[0] || { x: 0, y: 0 };
    const last = object.points[object.points.length - 1] || { x: 0, y: 0 };
    return `${object.id}|${object.layerId || "layer-1"}|${object.type}|${object.color}|${object.size}|${object.points.length}|${round4(first.x)}|${round4(first.y)}|${round4(last.x)}|${round4(last.y)}`;
  }).join(";");
  const links = [
    surface.edgeLinks?.v1?.active ? 1 : 0,
    surface.edgeLinks?.v1?.direction?.left ?? 1,
    surface.edgeLinks?.v1?.direction?.right ?? 1,
    surface.edgeLinks?.v2?.active ? 1 : 0,
    surface.edgeLinks?.v2?.direction?.bottom ?? 1,
    surface.edgeLinks?.v2?.direction?.top ?? 1
  ].join(",");
  return [
    domain.type,
    round4(surface.v1.x), round4(surface.v1.y), round4(surface.v2.x), round4(surface.v2.y),
    state.imageFitMode,
    round4(state.imageOpacity),
    image ? `${state.background.naturalWidth}x${state.background.naturalHeight}` : "no-image",
    layerSignature,
    links,
    objects
  ].join("|");
}

function ensureCellTexture(domain) {
  const imageLayer = layerByType("image");
  const hasImage = !!state.background.image && imageLayer?.visible !== false && (imageLayer?.opacity ?? 1) > 0;
  if (!hasImage) {
    cachedTextureSignature = "";
    cachedBackgroundImage = null;
    cachedTextureCanvas = null;
    return null;
  }

  const signature = buildCellTextureSignature(domain);
  if (cellTexture && cachedTextureSignature === signature && cachedBackgroundImage === state.background.image && cachedTextureCanvas) return cellTexture;

  cachedTextureCanvas = buildCompositeCellCanvas(domain);
  if (!cellTexture) cellTexture = gl.createTexture();
  cachedTextureSignature = signature;
  cachedBackgroundImage = state.background.image;
  gl.bindTexture(gl.TEXTURE_2D, cellTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cachedTextureCanvas);
  return cellTexture;
}

function buildCompositeCellCanvas(domain) {
  const size = compositeTextureSize();
  const cellCanvas = document.createElement("canvas");
  cellCanvas.width = size.width;
  cellCanvas.height = size.height;
  const ctx = cellCanvas.getContext("2d", { alpha: true });
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, cellCanvas.width, cellCanvas.height);

  const image = layerByType("image");
  if (image && image.visible !== false && (image.opacity ?? 1) > 0 && state.background.image) {
    ctx.save();
    ctx.globalAlpha = image.opacity ?? 1;
    drawBackgroundTexture(ctx, cellCanvas.width, cellCanvas.height, false);
    ctx.restore();
  }
  return cellCanvas;
}

function compositeTextureSize() {
  const cellWidth = Math.max(1, length(state.surface.v1));
  const cellHeight = Math.max(1, length(state.surface.v2));
  if (cellWidth >= cellHeight) {
    return {
      width: LONG_TEXTURE_SIDE,
      height: Math.max(MIN_TEXTURE_SIDE, Math.round(LONG_TEXTURE_SIDE * (cellHeight / cellWidth)))
    };
  }
  return {
    width: Math.max(MIN_TEXTURE_SIDE, Math.round(LONG_TEXTURE_SIDE * (cellWidth / cellHeight))),
    height: LONG_TEXTURE_SIDE
  };
}

function drawBackgroundTexture(ctx, width, height, applyOpacity = true) {
  const image = state.background.image;
  if (!image) return;
  const iw = state.background.naturalWidth || image.naturalWidth || 1;
  const ih = state.background.naturalHeight || image.naturalHeight || 1;
  ctx.save();
  if (applyOpacity) ctx.globalAlpha = clamp(state.imageOpacity, 0, 1);
  if (state.imageFitMode === "stretch") {
    ctx.drawImage(image, 0, 0, iw, ih, 0, 0, width, height);
    ctx.restore();
    return;
  }
  const cellAspect = width / Math.max(1, height);
  const imageAspect = iw / ih;
  if (imageAspect > cellAspect) {
    const sw = ih * cellAspect;
    const sx = (iw - sw) / 2;
    ctx.drawImage(image, sx, 0, sw, ih, 0, 0, width, height);
  } else {
    const sh = iw / cellAspect;
    const sy = (ih - sh) / 2;
    ctx.drawImage(image, 0, sy, iw, sh, 0, 0, width, height);
  }
  ctx.restore();
}

function drawObjectsToTexture(ctx, domain, width, height, layer = null) {
  const pixelsPerU = width;
  const pixelsPerV = height;
  // Conservative metric rasterization: for extreme/skewed cells, using the
  // larger pixels-per-world scale prevents large strokes from being underdrawn
  // on the 3D paint texture.
  const pixelsPerWorld = Math.max(pixelsPerU / Math.max(1, length(state.surface.v1)), pixelsPerV / Math.max(1, length(state.surface.v2)));

  for (const object of state.objects) {
    if (layer && (object.layerId || "layer-1") !== layer.id) continue;
    if (!object.points?.length) continue;
    ctx.save();
    ctx.strokeStyle = object.color || "#111111";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (object.type === "dot") {
      ctx.lineWidth = Math.max(1, (object.size || 20) * pixelsPerWorld * 0.13);
      const radius = Math.max(1, (object.size || 20) * pixelsPerWorld / 2);
      const uCopies = domain.topology?.repeatV1 ? [-1, 0, 1] : [0];
      const vCopies = domain.topology?.repeatV2 ? [-1, 0, 1] : [0];

      for (const rawUv of objectUvPoints(object, domain)) {
        const uv = domain.normalizeUV ? domain.normalizeUV(rawUv) : rawUv;
        if (!uv) continue;
        for (const du of uCopies) {
          for (const dv of vCopies) {
            const point = texturePointRaw({ u: uv.u + du, v: uv.v + dv }, width, height);
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
      continue;
    }

    if (object.points.length < 2) { ctx.restore(); continue; }
    const uvPoints = densifyUvPath(objectUvPoints(object, domain), object.type === "line" ? 0.018 : 0.035);
    const paths = domain.splitPolylineByGluing(uvPoints);
    if (!paths.length) { ctx.restore(); continue; }
    ctx.lineWidth = Math.max(1, (object.size || 1) * pixelsPerWorld);

    for (const path of paths) {
      if (path.length < 2) continue;
      ctx.beginPath();
      const first = texturePoint(path[0], width, height);
      ctx.moveTo(first.x, first.y);
      if (object.type === "pen" && path.length > 2) {
        for (let i = 1; i < path.length - 1; i++) {
          const p = texturePoint(path[i], width, height);
          const n = texturePoint(path[i + 1], width, height);
          ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
        }
        const last = texturePoint(path[path.length - 1], width, height);
        ctx.lineTo(last.x, last.y);
      } else {
        for (let i = 1; i < path.length; i++) {
          const p = texturePoint(path[i], width, height);
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

function texturePoint(uv, width, height) {
  return { x: clamp(uv.u, 0, 1) * width, y: (1 - clamp(uv.v, 0, 1)) * height };
}

function texturePointRaw(uv, width, height) {
  return { x: uv.u * width, y: (1 - uv.v) * height };
}

export function drawPreview3d() {
  if (!canvas) return;
  resizePreviewCanvas();
  if (!gl) return drawFallback();

  const domain = createSurfaceDomain(state.surface);
  const map = createSurfaceMap(domain);
  const surface = buildSurfaceMesh(map);
  const grid = buildGridMesh(map, domain);
  const drawingLayers = (state.layers || []).filter(layer => layer.type === "drawing" && layer.visible !== false && (layer.opacity ?? 1) > 0);
  const strokeMeshes = drawingLayers.map((layer, index) => buildStrokeMesh(map, domain, layer, index * STROKE_LAYER_LIFT));
  const tex = ensureCellTexture(domain);

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

  const translucentSurface = (state.preview.opacity ?? DEFAULT_SURFACE_OPACITY) < 0.999;
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1.0, 1.0);
  gl.depthMask(!translucentSurface);
  drawMesh(surface, {
    useTexture: !!tex && !DEBUG_UV_COVERAGE,
    texture: tex,
    texRect: [0, 0, 1, 1],
    imageStrength: tex ? 1.0 : 0,
    opacity: state.preview.opacity ?? DEFAULT_SURFACE_OPACITY,
    lighting: !DEBUG_UV_COVERAGE,
    twoSidedLighting: isNonOrientable(map)
  });
  gl.disable(gl.POLYGON_OFFSET_FILL);

  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(!translucentSurface);
  drawMesh(grid, { useTexture: false, lighting: false });

  // Strokes are rendered after the surface as real 3D geometry, layer by
  // layer. Depth writing is intentionally ON. This preserves normal layer
  // order when marks are on the same area, but lets true 3D depth win when
  // one mark is on the far side of a transparent model.
  gl.depthMask(true);
  for (const mesh of strokeMeshes) {
    drawMesh(mesh, { useTexture: false, lighting: false });
  }
  gl.depthMask(true);
  updateSummary(map);
}

function isNonOrientable(map) {
  return map.type === "mobius" || map.type === "klein" || map.type === "double-reversed";
}

function updateSummary(map) {
  if (!state.ui.preview3dSummary) return;
  const label = map.type === "klein"
    ? "Traditional Klein bottle"
    : map.type === "double-reversed"
      ? "Projective plane"
      : map.typeLabel || (map.type.charAt(0).toUpperCase() + map.type.slice(1));
  const l1 = Math.round(length(state.surface.v1));
  const l2 = Math.round(length(state.surface.v2));
  const representation = map.type === "klein"
    ? "clean self-intersecting immersion"
    : map.type === "double-reversed"
      ? "double-reversed self-intersecting immersion"
      : map.representation === "immersion"
        ? "immersed coordinate map"
        : map.representation === "inspection"
          ? "inspection coordinate map"
          : "full cell coordinate map";
  state.ui.preview3dSummary.textContent = `${label} · ${representation} · |v1| ${l1} · |v2| ${l2}`;
}

function drawFallback() {
  const ctx = fallbackCtx || canvas.getContext("2d");
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#6f6a60";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("3D preview needs WebGL in this browser.", 18, 32);
}

function layerByType(type) {
  return (state.layers || []).find(layer => layer.type === type);
}

function layerForObject(object) {
  return (state.layers || []).find(layer => layer.id === (object.layerId || "layer-1"));
}

function cssColorToRgba(value) {
  if (!value || value[0] !== "#") return [0.07, 0.07, 0.07, 1];
  const hex = value.slice(1);
  const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
  const num = Number.parseInt(full, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255, 1];
}

function round4(value) { return Math.round((value || 0) * 10000) / 10000; }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalize(a) { const l = Math.max(0.000001, len3(a)); return [a[0] / l, a[1] / l, a[2] / l]; }
function finite3(p) { return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]); }

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
