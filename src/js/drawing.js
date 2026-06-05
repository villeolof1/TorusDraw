// Pointer input: drawing, panning, erasing, and vector-style selection/editing.
import { state, cloneObjects } from "./state.js";
import { TAU, add, basisToWorld, clamp, length, screenToWorld, sub, visibleOffsets, worldToBaseFromCell, worldToBasis } from "./math.js";
import { hideAngleHint, showAngleHint } from "./dom.js";
import { addObject, replaceAll } from "./history.js";
import { activeDrawingLayer, visibleLayerOpacity } from "./layers.js";
import { redraw, requestRender } from "./render2d.js";
import { clearRasterCanvas, getRasterCanvas, setRasterCanvas } from "./rasterStore.js";

const SNAP = Math.PI / 12;
const activePointers = new Map();
let touchGesture = null;
let isDrawing = false, isPanning = false, startPoint = null, currentObject = null;
let panStart = null, viewStart = null, eraseBefore = null, eraseChanged = false, spaceDown = false, temporaryDotDown = false;
let selectSession = null;
let rubPreviousPoints = new Map();
let touchedRasterIds = new Set();

function pointerPoint(event) {
  const box = state.canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}
function screenRadius(px = 12) { return px / Math.max(0.2, state.view.zoom); }
function worldFromEvent(event) {
  const p = screenToWorld(pointerPoint(event), state.view, state.cssWidth, state.cssHeight);
  p.pressure = event.pointerType === "pen" ? clamp(event.pressure || 0.5, 0, 1) : 0.5;
  return withUv(p);
}
function currentStyle() { return { color: state.ui.colorInput.value, size: Number(state.ui.sizeInput.value) || 1, shapeMode: state.shapeMode || "outline" }; }
function dotStyle() { return { color: state.ui.colorInput.value, size: Math.max(1, state.dotSize || 8) }; }
function withUv(point) {
  const uv = worldToBasis(point, state.surface);
  if (uv) { point.u = uv.u; point.v = uv.v; }
  return point;
}
function ensurePointUv(point) {
  if (Number.isFinite(point.u) && Number.isFinite(point.v)) return { u: point.u, v: point.v };
  const uv = worldToBasis(point, state.surface);
  if (uv) { point.u = uv.u; point.v = uv.v; }
  return uv;
}
function pointFromUv(uv, pressure = 0.5) {
  const world = basisToWorld(uv, state.surface);
  return { x: world.x, y: world.y, u: uv.u, v: uv.v, pressure };
}

function rasterFrame(object) {
  const pts = object.points || [];
  const origin = pts[0];
  if (!origin) return null;
  if (pts[1] && pts[2]) {
    return {
      origin,
      xCorner: pts[1],
      yCorner: pts[2],
      xAxis: sub(pts[1], origin),
      yAxis: sub(pts[2], origin)
    };
  }
  // Compatibility for older two-corner raster objects.
  const b = pts[1];
  if (!b) return null;
  const x0 = Math.min(origin.x, b.x), x1 = Math.max(origin.x, b.x);
  const y0 = Math.min(origin.y, b.y), y1 = Math.max(origin.y, b.y);
  const o = { x: x0, y: y0, u: origin.u, v: origin.v, pressure: 0.5 };
  const xCorner = withUv({ x: x1, y: y0, pressure: 0.5 });
  const yCorner = withUv({ x: x0, y: y1, pressure: 0.5 });
  return { origin: o, xCorner, yCorner, xAxis: sub(xCorner, o), yAxis: sub(yCorner, o) };
}
function rasterCorners(object) {
  const f = rasterFrame(object);
  if (!f) return [];
  const fourth = withUv({ x: f.xCorner.x + f.yAxis.x, y: f.xCorner.y + f.yAxis.y, pressure: 0.5 });
  return [f.origin, f.xCorner, fourth, f.yCorner];
}
function rasterLocalFromWorld(object, point) {
  const f = rasterFrame(object);
  if (!f) return null;
  const det = f.xAxis.x * f.yAxis.y - f.xAxis.y * f.yAxis.x;
  if (Math.abs(det) < 0.000001) return null;
  const d = sub(point, f.origin);
  const u = (d.x * f.yAxis.y - d.y * f.yAxis.x) / det;
  const v = (f.xAxis.x * d.y - f.xAxis.y * d.x) / det;
  const canvas = getRasterCanvas(object, requestRender);
  const width = canvas?.width || object.rasterWidth || 1;
  const height = canvas?.height || object.rasterHeight || 1;
  return { x: u * width, y: v * height, u, v, width, height };
}
function createRasterCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
function drawFilledShapeToCanvas(ctx, object, originX, originY, scale) {
  ctx.save();
  ctx.fillStyle = object.fillColor || object.color || '#111111';
  if (object.type === 'rectangle' || object.type === 'ellipse') {
    const [a, b] = object.points || [];
    const x0 = (Math.min(a.x, b.x) - originX) * scale, x1 = (Math.max(a.x, b.x) - originX) * scale;
    const y0 = (Math.min(a.y, b.y) - originY) * scale, y1 = (Math.max(a.y, b.y) - originY) * scale;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    ctx.beginPath();
    if (object.type === 'rectangle') {
      ctx.translate(cx, cy);
      ctx.rotate(object.rotation || 0);
      ctx.rect(-(x1 - x0) / 2, -(y1 - y0) / 2, x1 - x0, y1 - y0);
    } else {
      ctx.ellipse(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, object.rotation || 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
    return;
  }
  if (object.type === 'polygon') {
    const points = object.points || [];
    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo((points[0].x - originX) * scale, (points[0].y - originY) * scale);
      for (const point of points.slice(1)) ctx.lineTo((point.x - originX) * scale, (point.y - originY) * scale);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
function convertFilledShapeToRaster(object) {
  const samples = sampleObjectPath(object);
  if (!samples.length) return object;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of samples) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const padWorld = Math.max(2, object.size || 1, state.eraserSize || 20);
  minX -= padWorld; minY -= padWorld; maxX += padWorld; maxY += padWorld;
  const scale = Math.min(8, Math.max(2, object.rasterScale || 4));
  const width = Math.max(8, Math.ceil((maxX - minX) * scale));
  const height = Math.max(8, Math.ceil((maxY - minY) * scale));
  const canvas = createRasterCanvas(width, height);
  const ctx = canvas.getContext('2d');
  drawFilledShapeToCanvas(ctx, object, minX, minY, scale);
  const origin = withUv({ x: minX, y: minY, pressure: 0.5 });
  const xCorner = withUv({ x: maxX, y: minY, pressure: 0.5 });
  const yCorner = withUv({ x: minX, y: maxY, pressure: 0.5 });
  const imageDataUrl = canvas.toDataURL('image/png');
  canvas.__sourceDataUrl = imageDataUrl;
  const raster = {
    id: object.id,
    type: 'raster',
    layerId: object.layerId,
    color: object.color,
    size: object.size,
    rotation: 0,
    rasterWidth: width,
    rasterHeight: height,
    imageDataUrl,
    points: [origin, xCorner, yCorner]
  };
  setRasterCanvas(raster.id, canvas, imageDataUrl);
  return raster;
}
function eraseRasterObject(object, point, radius, previousPoint = null) {
  let canvas = getRasterCanvas(object, requestRender);
  if (!canvas) return object;
  const ctx = canvas.getContext('2d');
  const local = rasterLocalFromWorld(object, point);
  const prev = previousPoint ? rasterLocalFromWorld(object, previousPoint) : null;
  if (!local) return object;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  const f = rasterFrame(object);
  const sx = canvas.width / Math.max(0.0001, length(f.xAxis));
  const sy = canvas.height / Math.max(0.0001, length(f.yAxis));
  const rr = Math.max(1, radius * Math.max(sx, sy));
  if (prev) {
    ctx.beginPath();
    ctx.lineWidth = rr * 2;
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(local.x, local.y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(local.x, local.y, rr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  object.imageDataUrl = canvas.toDataURL('image/png');
  canvas.__sourceDataUrl = object.imageDataUrl;
  object.rasterWidth = canvas.width;
  object.rasterHeight = canvas.height;
  setRasterCanvas(object.id, canvas, object.imageDataUrl);
  return object;
}


function pointOnRasterFrame(frame, u, v) {
  return withUv({
    x: frame.origin.x + frame.xAxis.x * u + frame.yAxis.x * v,
    y: frame.origin.y + frame.xAxis.y * u + frame.yAxis.y * v,
    pressure: 0.5
  });
}

function analyzeAlphaComponents(canvas) {
  if (!canvas || !canvas.width || !canvas.height) return { components: [], visiblePixelCount: 0, minPixels: 4 };
  const width = canvas.width, height = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const visited = new Uint8Array(width * height);
  const components = [];
  const alphaThreshold = 8;
  const minPixels = Math.max(4, Math.floor(width * height * 0.00002));
  let visiblePixelCount = 0;
  for (let i = 0; i < width * height; i++) if (data[i * 4 + 3] > alphaThreshold) visiblePixelCount++;
  if (!visiblePixelCount) return { components, visiblePixelCount, minPixels };
  const stack = [];
  const isSolid = index => data[index * 4 + 3] > alphaThreshold;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start] || !isSolid(start)) continue;
      let minX = x, maxX = x, minY = y, maxY = y;
      const pixels = [];
      visited[start] = 1;
      stack.length = 0;
      stack.push(start);
      while (stack.length) {
        const idx = stack.pop();
        pixels.push(idx);
        const px = idx % width;
        const py = Math.floor(idx / width);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = px + dx, ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (visited[ni] || !isSolid(ni)) continue;
            visited[ni] = 1;
            stack.push(ni);
          }
        }
      }
      components.push({ pixels, minX, minY, maxX, maxY, pixelCount: pixels.length });
    }
  }
  return { components, visiblePixelCount, minPixels };
}


function cropRasterComponent(parent, component, nextId) {
  const canvas = getRasterCanvas(parent, requestRender);
  const frame = rasterFrame(parent);
  if (!canvas || !frame || !component?.pixels?.length) return null;
  const pad = 3;
  const sx0 = Math.max(0, component.minX - pad);
  const sy0 = Math.max(0, component.minY - pad);
  const sx1 = Math.min(canvas.width, component.maxX + pad + 1);
  const sy1 = Math.min(canvas.height, component.maxY + pad + 1);
  const outW = Math.max(1, sx1 - sx0), outH = Math.max(1, sy1 - sy0);
  if (!outW || !outH) return null;
  const srcData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const outCanvas = createRasterCanvas(outW, outH);
  const outCtx = outCanvas.getContext('2d');
  const outData = outCtx.createImageData(outW, outH);
  const inComponent = new Uint8Array(canvas.width * canvas.height);
  for (const idx of component.pixels) inComponent[idx] = 1;
  let copied = 0;
  for (let y = sy0; y < sy1; y++) {
    for (let x = sx0; x < sx1; x++) {
      const srcIdx = y * canvas.width + x;
      if (!inComponent[srcIdx]) continue;
      const dstIdx = (y - sy0) * outW + (x - sx0);
      outData.data[dstIdx * 4] = srcData.data[srcIdx * 4];
      outData.data[dstIdx * 4 + 1] = srcData.data[srcIdx * 4 + 1];
      outData.data[dstIdx * 4 + 2] = srcData.data[srcIdx * 4 + 2];
      outData.data[dstIdx * 4 + 3] = srcData.data[srcIdx * 4 + 3];
      if (srcData.data[srcIdx * 4 + 3] > 8) copied++;
    }
  }
  if (!copied) return null;
  outCtx.putImageData(outData, 0, 0);
  const u0 = sx0 / Math.max(1, canvas.width);
  const v0 = sy0 / Math.max(1, canvas.height);
  const u1 = sx1 / Math.max(1, canvas.width);
  const v1 = sy1 / Math.max(1, canvas.height);
  const points = [pointOnRasterFrame(frame, u0, v0), pointOnRasterFrame(frame, u1, v0), pointOnRasterFrame(frame, u0, v1)];
  if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.u) || !Number.isFinite(point.v))) return null;
  const imageDataUrl = outCanvas.toDataURL('image/png');
  if (!imageDataUrl) return null;
  const object = {
    ...parent,
    id: nextId,
    rasterWidth: outW,
    rasterHeight: outH,
    imageDataUrl,
    points
  };
  outCanvas.__sourceDataUrl = object.imageDataUrl;
  setRasterCanvas(object.id, outCanvas, object.imageDataUrl);
  return object;
}


function splitRasterObjectSafely(object) {
  if (object?.type !== 'raster') return { objects: [object], didSplit: false };
  const canvas = getRasterCanvas(object, requestRender);
  if (!canvas) return { objects: [object], didSplit: false };
  let analysis;
  try {
    analysis = analyzeAlphaComponents(canvas);
  } catch {
    return { objects: [object], didSplit: false };
  }
  const { components, visiblePixelCount, minPixels } = analysis;
  if (visiblePixelCount === 0) {
    clearRasterCanvas(object.id);
    return { objects: [], didSplit: true, fullyErased: true };
  }
  const valid = components.filter(component => component.pixelCount >= minPixels);
  if (!valid.length) return { objects: [object], didSplit: false };
  if (valid.length === 1) return { objects: [object], didSplit: false };
  const pieces = [];
  for (const component of valid.sort((a, b) => b.pixelCount - a.pixelCount)) {
    const piece = cropRasterComponent(object, component, state.nextObjectId++);
    if (!piece) {
      for (const created of pieces) clearRasterCanvas(created.id);
      return { objects: [object], didSplit: false };
    }
    pieces.push(piece);
  }
  if (!pieces.length) return { objects: [object], didSplit: false };
  clearRasterCanvas(object.id);
  return { objects: pieces, didSplit: true };
}

function splitRasterObjectsAfterRub() {
  if (!touchedRasterIds.size) return false;
  let changed = false;
  const next = [];
  const selected = [];
  for (const object of state.objects) {
    if (object.type !== 'raster' || !touchedRasterIds.has(object.id)) { next.push(object); continue; }
    const split = splitRasterObjectSafely(object);
    if (!split.objects.length && !split.fullyErased) {
      next.push(object);
      continue;
    }
    if (split.didSplit) changed = true;
    next.push(...split.objects);
    if (split.objects.length > 1) selected.push(...split.objects.map(part => part.id));
  }
  if (changed) {
    state.objects = next;
    if (selected.length) setSelection(selected, state.selectionOffset || { i: 0, j: 0 });
  }
  return changed;
}


function currentSelectionIds() {
  return (state.selectedObjectIds?.length ? state.selectedObjectIds : (state.selectedObjectId != null ? [state.selectedObjectId] : []))
    .filter(id => state.objects.some(object => object.id === id));
}
function syncPrimarySelection() {
  state.selectedObjectIds = currentSelectionIds();
  state.selectedObjectId = state.selectedObjectIds[0] ?? null;
  if (state.selectedObjectIds.length !== 1) { state.selectedNodeIndex = null; state.selectedHandleKind = null; }
}
function setSelection(ids, offset = state.selectionOffset || { i: 0, j: 0 }) {
  state.selectedObjectIds = [...new Set(ids.filter(id => state.objects.some(object => object.id === id)))];
  state.selectedObjectId = state.selectedObjectIds[0] ?? null;
  state.selectionOffset = { ...offset };
  state.selectedHandleKind = null;
  state.selectionGroupRotation = 0;
  if (state.selectedObjectIds.length > 1) {
    const b = selectionBounds(state.objects.filter(object => state.selectedObjectIds.includes(object.id)));
    state.selectionGroupFrame = b ? { cx: b.cx, cy: b.cy, width: b.width, height: b.height, rotation: 0 } : null;
  } else {
    state.selectionGroupFrame = null;
  }
  if (state.selectedObjectIds.length !== 1) state.selectedNodeIndex = null;
  syncSelectionActions();
}
function selectedObjects() {
  const ids = new Set(currentSelectionIds());
  return state.objects.filter(object => ids.has(object.id));
}
function primarySelectedObject() { return state.objects.find(object => object.id === state.selectedObjectId) || null; }

function stampDot(event) {
  const object = { id: state.nextObjectId++, type: "dot", layerId: activeDrawingLayer().id, points: [worldFromEvent(event)], ...dotStyle() };
  addObject(object);
}

export function chooseTool(tool) {
  saveCurrentSize();
  state.tool = tool;
  state.ui.penButton.classList.toggle("active", tool === "pen");
  state.ui.lineButton.classList.toggle("active", tool === "line");
  state.ui.ellipseButton.classList.toggle("active", tool === "ellipse");
  state.ui.rectangleButton.classList.toggle("active", tool === "rectangle");
  state.ui.dotButton.classList.toggle("active", tool === "dot");
  if (state.ui.selectButton) state.ui.selectButton.classList.toggle("active", tool === "select");
  state.ui.eraseButton.classList.toggle("active", tool === "erase");
  state.ui.homButton.classList.toggle("active", tool === "hom");
  state.ui.panButton.classList.toggle("active", tool === "pan");
  setEraserOptionsVisible(tool === "erase");
  syncShapeControls();
  syncSelectionActions();
  state.canvas.classList.toggle("panning", tool === "pan" || spaceDown);
  state.canvas.classList.toggle("homing", tool === "hom");
  state.ui.sizeInput.value = tool === "erase" ? state.eraserSize : tool === "dot" ? state.dotSize : state.penSize;
  if (tool !== "hom") {
    state.homHoverId = null;
    state.homSelectedId = null;
  }
  hideAngleHint();
  requestRender();
}

function setEraserOptionsVisible(visible) {
  const options = state.ui.eraserOptions;
  if (visible) {
    options.hidden = false;
    requestAnimationFrame(() => options.classList.add("visible"));
    return;
  }
  options.classList.remove("visible");
  window.setTimeout(() => { if (state.tool !== "erase") options.hidden = true; }, 210);
}

export function saveCurrentSize() {
  const value = Math.max(1, Number(state.ui.sizeInput.value) || 1);
  if (state.tool === "erase") state.eraserSize = value;
  if (state.tool === "dot") state.dotSize = value;
  if (["pen", "line", "ellipse", "rectangle", "select"].includes(state.tool)) state.penSize = value;
}
export function setEraserMode(mode) {
  state.eraserMode = mode === "rub" ? "rub" : "object";
  state.ui.eraseObjectButton.classList.toggle("active", state.eraserMode === "object");
  state.ui.eraseRubButton.classList.toggle("active", state.eraserMode === "rub");
}
function modifierActive(event, name) {
  // Constrain and Snap are deliberately separate:
  // - Constrain = square/circle/proportional resize (Shift-like constraint)
  // - Snap = angular snapping / mirrored curve handles
  // Snap must never preserve resize proportions.
  if (name === "constrain") return event.shiftKey || !!state.touchModifiers.constrain;
  if (name === "center") return event.altKey || !!state.touchModifiers.center;
  if (name === "snap") return event.shiftKey || !!state.touchModifiers.snap;
  return false;
}

function lineFromModifiers(center, pointer, event) {
  let delta = sub(pointer, center), angleDegrees = null;
  if (modifierActive(event, "snap")) {
    const len = length(delta);
    const snapped = Math.round(Math.atan2(delta.y, delta.x) / SNAP) * SNAP;
    delta = { x: Math.cos(snapped) * len, y: Math.sin(snapped) * len };
    angleDegrees = ((Math.round(snapped * 180 / Math.PI) % 360) + 360) % 360;
  }
  const endpoints = modifierActive(event, "center") ? [sub(center, delta), add(center, delta)] : [center, add(center, delta)];
  return { points: endpoints.map(point => withUv({ ...point, pressure: 0.5 })), angleDegrees };
}
function shapeBoxFromModifiers(anchor, pointer, event) {
  let dx = pointer.x - anchor.x, dy = pointer.y - anchor.y;
  if (modifierActive(event, "constrain")) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  const a = modifierActive(event, "center") ? { x: anchor.x - dx, y: anchor.y - dy } : anchor;
  const b = modifierActive(event, "center") ? { x: anchor.x + dx, y: anchor.y + dy } : { x: anchor.x + dx, y: anchor.y + dy };
  return { points: [withUv({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), pressure: 0.5 }), withUv({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), pressure: 0.5 })] };
}

function rotateAround(point, center, angle) {
  if (!angle) return { ...point };
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = point.x - center.x, dy = point.y - center.y;
  return { ...point, x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}
function inverseRotateAround(point, center, angle) { return rotateAround(point, center, -angle); }
function signedScaleValue(value, minAbs = 0.015) { return Math.abs(value) < minAbs ? minAbs * (value < 0 ? -1 : 1) : value; }

function cubicSample(a, c1, c2, b, steps = 20) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    points.push({
      x: mt ** 3 * a.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * b.x,
      y: mt ** 3 * a.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * b.y,
      pressure: 0.5
    });
  }
  return points;
}
function nodeInHandle(node) { return node?.inHandle ? { x: node.x + node.inHandle.dx, y: node.y + node.inHandle.dy } : null; }
function nodeOutHandle(node) { return node?.outHandle ? { x: node.x + node.outHandle.dx, y: node.y + node.outHandle.dy } : null; }
function sampleLinePath(object, steps = 18) {
  if (!object.points?.length) return [];
  const out = [{ ...object.points[0] }];
  for (let i = 1; i < object.points.length; i++) {
    const a = object.points[i - 1], b = object.points[i];
    const c1 = nodeOutHandle(a), c2 = nodeInHandle(b);
    if (c1 || c2) {
      const samples = cubicSample(a, c1 || a, c2 || b, b, steps);
      out.push(...samples.slice(1).map(withUv));
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

function sampleShapePath(object, segments = 128) {
  if (!object.points?.length) return [];
  const [a, b] = object.points;
  if (!a || !b) return [];
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const angle = object.rotation || 0;
  if (object.type === "rectangle") {
    return [
      { x: x0, y: y0, pressure: 0.5 }, { x: x1, y: y0, pressure: 0.5 },
      { x: x1, y: y1, pressure: 0.5 }, { x: x0, y: y1, pressure: 0.5 }, { x: x0, y: y0, pressure: 0.5 }
    ].map(point => withUv(rotateAround(point, center, angle)));
  }
  if (object.type === "ellipse") {
    const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    const samples = [];
    for (let i = 0; i <= segments; i++) {
      const t = TAU * i / segments;
      samples.push(withUv(rotateAround({ x: center.x + Math.cos(t) * rx, y: center.y + Math.sin(t) * ry, pressure: 0.5 }, center, angle)));
    }
    return samples;
  }
  return [];
}

function sampleObjectPath(object) {
  if (!object?.points?.length) return [];
  if (object.type === "dot") {
    const center = object.points[0], dotRadius = Math.max(0.5, (object.size || 20) / 2), samples = [], count = 72;
    for (let i = 0; i <= count; i++) {
      const angle = TAU * i / count;
      samples.push(withUv({ x: center.x + Math.cos(angle) * dotRadius, y: center.y + Math.sin(angle) * dotRadius, pressure: 0.5 }));
    }
    return samples;
  }
  if (object.type === "rectangle" || object.type === "ellipse") return sampleShapePath(object, object.type === "ellipse" ? 144 : 4);
  if (object.type === "raster") return rasterCorners(object);
  if (object.type === "line") return sampleLinePath(object, 20);
  if (object.type === "polygon") return [...object.points.map(point => ({ ...point })), { ...object.points[0] }];
  return object.points.map(point => ({ ...point }));
}


function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) && (point.x < (b.x - a.x) * (point.y - a.y) / Math.max(0.000001, b.y - a.y) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function rectangleCornerPoints(object) {
  const box = shapeBoxInfo(object);
  if (!box) return [];
  return ["nw", "ne", "se", "sw"].map(name => withUv({ ...box.world[name], pressure: 0.5 }));
}

function convertRectangleToPolygon(object) {
  if (!object || object.type !== "rectangle") return object;
  object.type = "polygon";
  object.points = rectangleCornerPoints(object);
  delete object.rotation;
  return object;
}


function distanceToSegment(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a), denom = ab.x * ab.x + ab.y * ab.y;
  const t = denom ? clamp((ap.x * ab.x + ap.y * ab.y) / denom, 0, 1) : 0;
  return length(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
}
function nearestPointOnSegment(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a), denom = ab.x * ab.x + ab.y * ab.y;
  const t = denom ? clamp((ap.x * ab.x + ap.y * ab.y) / denom, 0, 1) : 0;
  return { point: { x: a.x + ab.x * t, y: a.y + ab.y * t }, t };
}
function hitObject(object, localPoint, radius) {
  if (object.type === "dot") return length(sub(localPoint, object.points[0])) <= radius + Math.max(0.5, (object.size || 20) / 2);
  const threshold = radius + (object.size || 1) / 2;
  if (object.type === "raster") {
    const local = rasterLocalFromWorld(object, localPoint);
    if (!local) return false;
    const padX = radius / Math.max(0.0001, length(rasterFrame(object)?.xAxis || { x: 1, y: 0 }));
    const padY = radius / Math.max(0.0001, length(rasterFrame(object)?.yAxis || { x: 0, y: 1 }));
    return local.u >= -padX && local.u <= 1 + padX && local.v >= -padY && local.v <= 1 + padY;
  }
  if (object.type === "rectangle" || object.type === "ellipse") {
    const [a, b] = object.points || [];
    if (!a || !b) return false;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    const unrotated = inverseRotateAround(localPoint, center, object.rotation || 0);
    const mode = object.shapeMode || "outline";
    const insideBox = unrotated.x >= x0 - radius && unrotated.x <= x1 + radius && unrotated.y >= y0 - radius && unrotated.y <= y1 + radius;
    if (mode === "fill" && insideBox) {
      if (pointInsideEraseHole(localPoint, object)) return false;
      if (object.type === "rectangle") return true;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const rx = Math.max(0.0001, (x1 - x0) / 2 + radius), ry = Math.max(0.0001, (y1 - y0) / 2 + radius);
      return ((unrotated.x - cx) ** 2) / (rx ** 2) + ((unrotated.y - cy) ** 2) / (ry ** 2) <= 1;
    }
    const outline = sampleShapePath(object, object.type === "ellipse" ? 144 : 4);
    for (let i = 1; i < outline.length; i++) if (distanceToSegment(localPoint, outline[i - 1], outline[i]) <= threshold) return true;
    if (state.tool === "select" && insideBox) return true;
    return false;
  }
  if (object.type === "polygon") {
    const pts = object.points || [];
    if (pts.length >= 3 && (object.shapeMode || "outline") === "fill" && pointInPolygon(localPoint, pts)) {
      if (pointInsideEraseHole(localPoint, object)) return false;
      return true;
    }
    const samples = [...pts, pts[0]].filter(Boolean);
    for (let i = 1; i < samples.length; i++) if (distanceToSegment(localPoint, samples[i - 1], samples[i]) <= threshold) return true;
    if (state.tool === "select" && pts.length >= 3 && pointInPolygon(localPoint, pts)) return true;
    return false;
  }
  const samples = object.type === "line" ? sampleLinePath(object, 26) : object.points;
  for (let i = 1; i < samples.length; i++) if (distanceToSegment(localPoint, samples[i - 1], samples[i]) <= threshold) return true;
  return false;
}
function localHitPoint(object, worldPoint, radius) {
  for (const offset of visibleOffsets(state)) {
    const local = worldToBaseFromCell(worldPoint, state.surface, offset);
    if (local && hitObject(object, local, radius)) return local;
  }
  return null;
}
function objectHitAt(worldPoint, radius = 18 / Math.max(0.2, state.view.zoom)) {
  for (let objectIndex = state.objects.length - 1; objectIndex >= 0; objectIndex--) {
    const object = state.objects[objectIndex];
    if (visibleLayerOpacity(object.layerId || "layer-1") <= 0) continue;
    for (const offset of visibleOffsets(state)) {
      const local = worldToBaseFromCell(worldPoint, state.surface, offset);
      if (local && hitObject(object, local, radius)) return { object, offset, local };
    }
  }
  return null;
}
function objectBounds(object) {
  const samples = sampleObjectPath(object);
  if (!samples.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of samples) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY, width: Math.max(0.0001, maxX - minX), height: Math.max(0.0001, maxY - minY), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
function selectionBounds(objects = selectedObjects()) {
  if (!objects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const object of objects) {
    const bounds = objectBounds(object);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.minX); minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX); maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: Math.max(0.0001, maxX - minX), height: Math.max(0.0001, maxY - minY), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function shapeBoxInfo(object) {
  if (!object || (object.type !== "rectangle" && object.type !== "ellipse") || object.points.length < 2) return null;
  const [a, b] = object.points;
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const width = Math.max(0.0001, x1 - x0), height = Math.max(0.0001, y1 - y0);
  const angle = object.rotation || 0;
  const local = {
    nw: { x: -width / 2, y: -height / 2 }, n: { x: 0, y: -height / 2 }, ne: { x: width / 2, y: -height / 2 },
    e: { x: width / 2, y: 0 }, se: { x: width / 2, y: height / 2 }, s: { x: 0, y: height / 2 },
    sw: { x: -width / 2, y: height / 2 }, w: { x: -width / 2, y: 0 }
  };
  const world = {};
  for (const [name, point] of Object.entries(local)) world[name] = rotateAround({ x: center.x + point.x, y: center.y + point.y }, center, angle);
  world.rotate = rotateAround({ x: center.x, y: center.y - height / 2 - screenRadius(34) }, center, angle);
  return { center, width, height, angle, local, world, x0, x1, y0, y1 };
}

function setShapeFromCenterSize(object, center, width, height, rotation) {
  const hw = Math.max(0.5, width) / 2;
  const hh = Math.max(0.5, height) / 2;
  object.points = [withUv({ x: center.x - hw, y: center.y - hh, pressure: 0.5 }), withUv({ x: center.x + hw, y: center.y + hh, pressure: 0.5 })];
  object.rotation = rotation || 0;
}

function genericBoxInfo(object) {
  if (!object || object.type === "dot" || !["pen", "line", "polygon", "raster"].includes(object.type)) return null;
  const samples = sampleObjectPath(object);
  if (!samples.length) return null;
  let rawMinX = Infinity, rawMinY = Infinity, rawMaxX = -Infinity, rawMaxY = -Infinity;
  for (const point of samples) {
    rawMinX = Math.min(rawMinX, point.x); rawMinY = Math.min(rawMinY, point.y);
    rawMaxX = Math.max(rawMaxX, point.x); rawMaxY = Math.max(rawMaxY, point.y);
  }
  const center = { x: (rawMinX + rawMaxX) / 2, y: (rawMinY + rawMaxY) / 2 };
  const angle = object.selectionRotation || 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of samples) {
    const local = inverseRotateAround(point, center, angle);
    minX = Math.min(minX, local.x); minY = Math.min(minY, local.y);
    maxX = Math.max(maxX, local.x); maxY = Math.max(maxY, local.y);
  }
  const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY);
  const localCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const worldCenter = rotateAround(localCenter, center, angle);
  const local = {
    nw: { x: minX, y: minY }, n: { x: localCenter.x, y: minY }, ne: { x: maxX, y: minY },
    e: { x: maxX, y: localCenter.y }, se: { x: maxX, y: maxY }, s: { x: localCenter.x, y: maxY },
    sw: { x: minX, y: maxY }, w: { x: minX, y: localCenter.y }
  };
  const world = {};
  for (const [name, point] of Object.entries(local)) world[name] = rotateAround(point, center, angle);
  world.rotate = rotateAround({ x: localCenter.x, y: minY - screenRadius(34) }, center, angle);
  return { center, localCenter, width, height, angle, local, world, minX, minY, maxX, maxY };
}

function dotRadius(object) { return Math.max(0.5, (object?.size || 20) / 2); }
function applyVectorTransform(handle, fn) {
  if (!handle) return null;
  const next = fn({ x: handle.dx, y: handle.dy });
  return { dx: next.x, dy: next.y };
}
function transformObjectPoints(object, pointFn, vectorFn = point => point) {
  object.points = object.points.map(point => {
    const next = withUv({ ...point, ...pointFn(point) });
    if (point.inHandle) next.inHandle = applyVectorTransform(point.inHandle, vectorFn);
    if (point.outHandle) next.outHandle = applyVectorTransform(point.outHandle, vectorFn);
    return next;
  });
}
function groupTransformFromStart(fnPoint, fnVector = fnPoint) {
  const ids = new Set(currentSelectionIds());
  const starts = selectSession?.startObjects || [];
  for (const object of state.objects) {
    if (!ids.has(object.id)) continue;
    const start = starts.find(item => item.id === object.id);
    if (!start) continue;
    if (object.type === "rectangle" || object.type === "ellipse" || object.type === "raster") {
      object.points = start.points.map(point => withUv({ ...point, ...fnPoint(point) }));
    } else {
      object.points = start.points.map(point => {
        const next = withUv({ ...point, ...fnPoint(point) });
        if (point.inHandle) next.inHandle = applyVectorTransform(point.inHandle, fnVector);
        if (point.outHandle) next.outHandle = applyVectorTransform(point.outHandle, fnVector);
        return next;
      });
    }
  }
}
function selectedGroupIds() { return [...new Set(selectedObjects().map(object => object.groupId).filter(Boolean))]; }
function idsForObjectHit(hit) {
  if (!hit?.object) return [];
  if (hit.object.groupId) return state.objects.filter(object => object.groupId === hit.object.groupId).map(object => object.id);
  return [hit.object.id];
}
function toggleSelectionIds(ids, offset) {
  const set = new Set(currentSelectionIds());
  const allPresent = ids.every(id => set.has(id));
  if (allPresent) ids.forEach(id => set.delete(id)); else ids.forEach(id => set.add(id));
  setSelection([...set], offset || state.selectionOffset);
}

function nearestPathSegment(object, localPoint) {
  const points = object.points || [];
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const samplePoints = (a.outHandle || b.inHandle) ? cubicSample(a, nodeOutHandle(a) || a, nodeInHandle(b) || b, b, 24) : [a, b];
    for (let j = 1; j < samplePoints.length; j++) {
      const near = nearestPointOnSegment(localPoint, samplePoints[j - 1], samplePoints[j]);
      const d = length(sub(localPoint, near.point));
      if (!best || d < best.distance) best = { index: i, point: near.point, distance: d };
    }
  }
  return best;
}
function insertPointIntoSelectedPath(localPoint) {
  let object = primarySelectedObject();
  if (!object || (object.type !== "line" && object.type !== "polygon" && object.type !== "rectangle")) return false;
  const before = cloneObjects(state.objects);
  if (object.type === "rectangle") object = convertRectangleToPolygon(object);
  const nearest = nearestPathSegment(object, localPoint);
  if (!nearest) return false;
  const point = withUv({ x: nearest.point.x, y: nearest.point.y, pressure: 0.5 });
  object.points.splice(nearest.index, 0, point);
  state.selectedNodeIndex = nearest.index;
  state.pathInsertMode = false;
  replaceAll(before, state.objects);
  syncSelectionActions();
  requestRender();
  return true;
}
function toggleSelectedPathPointMode() {
  const object = primarySelectedObject();
  const index = state.selectedNodeIndex;
  if (state.selectMode !== "points" || !object || object.type !== "line" || !Number.isInteger(index) || !object.points[index]) return false;
  const before = cloneObjects(state.objects);
  const node = object.points[index];
  if (node.inHandle || node.outHandle) {
    delete node.inHandle; delete node.outHandle;
  } else {
    const prev = object.points[index - 1] || node, next = object.points[index + 1] || node;
    const dx = (next.x - prev.x) / 6, dy = (next.y - prev.y) / 6;
    node.inHandle = { dx: -dx, dy: -dy };
    node.outHandle = { dx, dy };
  }
  replaceAll(before, state.objects);
  syncSelectionActions();
  requestRender();
  return true;
}
function deleteSelectedPathPoint() {
  if (state.selectMode !== "points") return false;
  let object = primarySelectedObject();
  const index = state.selectedNodeIndex;
  if (!object || !Number.isInteger(index)) return false;

  if (object.type === "rectangle") object = convertRectangleToPolygon(object);
  if (object.type !== "line" && object.type !== "polygon") return false;
  if (!object.points[index]) return false;
  const minPoints = object.type === "polygon" ? 3 : 2;
  if (object.points.length <= minPoints) return false;

  const before = cloneObjects(state.objects);
  object.points.splice(index, 1);
  state.selectedNodeIndex = Math.max(0, Math.min(index, object.points.length - 1));
  replaceAll(before, state.objects);
  syncSelectionActions();
  requestRender();
  return true;
}
export function addPathPointMode() {
  const object = primarySelectedObject();
  if (!object || state.selectMode !== "points" || !["line", "polygon", "rectangle"].includes(object.type)) return;
  state.pathInsertMode = !state.pathInsertMode;
  syncSelectionActions();
  requestRender();
}
export function groupSelection() {
  const ids = currentSelectionIds();
  if (ids.length < 2) return false;
  const before = cloneObjects(state.objects);
  const groupId = `group-${state.nextGroupId++}`;
  for (const object of state.objects) if (ids.includes(object.id)) object.groupId = groupId;
  replaceAll(before, state.objects);
  syncSelectionActions();
  requestRender();
  return true;
}
export function ungroupSelection() {
  const ids = currentSelectionIds();
  if (!ids.length) return false;
  const before = cloneObjects(state.objects);
  for (const object of state.objects) if (ids.includes(object.id)) delete object.groupId;
  replaceAll(before, state.objects);
  syncSelectionActions();
  requestRender();
  return true;
}

function selectionHandleAt(worldPoint) {
  const objects = selectedObjects();
  if (!objects.length) return null;
  const local = worldToBaseFromCell(worldPoint, state.surface, state.selectionOffset || { i: 0, j: 0 });
  if (!local) return null;
  const hitRadius = screenRadius(matchMedia("(pointer: coarse)").matches ? 32 : 22);
  const pointsMode = state.selectMode === "points";

  if (objects.length === 1) {
    const object = primarySelectedObject();

    if (pointsMode) {
      if (object.type === "line") {
        for (let i = 0; i < object.points.length; i++) {
          const hIn = nodeInHandle(object.points[i]);
          const hOut = nodeOutHandle(object.points[i]);
          if (hIn && length(sub(local, hIn)) <= hitRadius) return { type: "inHandle", index: i };
          if (hOut && length(sub(local, hOut)) <= hitRadius) return { type: "outHandle", index: i };
          if (length(sub(local, object.points[i])) <= hitRadius) return { type: "node", index: i };
        }
        return null;
      }
      if (object.type === "polygon") {
        for (let i = 0; i < object.points.length; i++) if (length(sub(local, object.points[i])) <= hitRadius) return { type: "node", index: i };
        return null;
      }
      if (object.type === "rectangle") {
        const corners = rectangleCornerPoints(object);
        for (let i = 0; i < corners.length; i++) if (length(sub(local, corners[i])) <= hitRadius) return { type: "shapeNode", index: i };
        return null;
      }
      return null;
    }

    if (object.type === "line") {
      const info = genericBoxInfo(object);
      if (info && length(sub(local, info.world.rotate)) <= hitRadius) return { type: "rotate", point: info.world.rotate, orientedGeneric: true };
      return null;
    }

    if (object.type === "pen" || object.type === "polygon" || object.type === "raster") {
      const info = genericBoxInfo(object);
      if (info) {
        for (const name of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
          if (length(sub(local, info.world[name])) <= hitRadius) return { type: "bbox", edge: name, orientedGeneric: true };
        }
        if (length(sub(local, info.world.rotate)) <= hitRadius) return { type: "rotate", point: info.world.rotate, orientedGeneric: true };
      }
    }

    if (object.type === "dot") {
      const center = object.points[0];
      const resizePoint = { x: center.x + dotRadius(object), y: center.y };
      if (length(sub(local, resizePoint)) <= hitRadius) return { type: "dotResize" };
      return null;
    }

  if (object.type === "rectangle" || object.type === "ellipse") {
      const box = shapeBoxInfo(object);
      if (box) {
        for (const name of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
          if (length(sub(local, box.world[name])) <= hitRadius) return { type: "bbox", edge: name, oriented: true };
        }
        if (length(sub(local, box.world.rotate)) <= hitRadius) return { type: "rotate", point: box.world.rotate, oriented: true };
      }
    }
  }

  if (pointsMode) return null;

  const bounds = selectionBounds(objects);
  if (!bounds) return null;
  const frame = state.selectionGroupFrame && objects.length > 1 ? state.selectionGroupFrame : null;
  const cx = frame ? frame.cx : bounds.cx;
  const cy = frame ? frame.cy : bounds.cy;
  const x0 = frame ? frame.cx - frame.width / 2 : bounds.minX;
  const x1 = frame ? frame.cx + frame.width / 2 : bounds.maxX;
  const y0 = frame ? frame.cy - frame.height / 2 : bounds.minY;
  const y1 = frame ? frame.cy + frame.height / 2 : bounds.maxY;
  const groupAngle = frame ? (frame.rotation || 0) : (state.selectionGroupRotation || 0);
  const groupCenter = { x: cx, y: cy };
  const handles = [
    ["nw", rotateAround({ x: x0, y: y0 }, groupCenter, groupAngle)], ["n", rotateAround({ x: cx, y: y0 }, groupCenter, groupAngle)], ["ne", rotateAround({ x: x1, y: y0 }, groupCenter, groupAngle)],
    ["e", rotateAround({ x: x1, y: cy }, groupCenter, groupAngle)], ["se", rotateAround({ x: x1, y: y1 }, groupCenter, groupAngle)], ["s", rotateAround({ x: cx, y: y1 }, groupCenter, groupAngle)],
    ["sw", rotateAround({ x: x0, y: y1 }, groupCenter, groupAngle)], ["w", rotateAround({ x: x0, y: cy }, groupCenter, groupAngle)]
  ];
  for (const [name, point] of handles) if (length(sub(local, point)) <= hitRadius) return { type: "bbox", edge: name };
  const rotate = rotateAround({ x: cx, y: y0 - screenRadius(34) }, groupCenter, groupAngle);
  if (objects.some(object => object.type !== "dot") && length(sub(local, rotate)) <= hitRadius) return { type: "rotate", point: rotate };
  return null;
}

function beginSelectionSession(worldPoint, kind, extra = {}) {
  const uv = worldToBasis(worldPoint, state.surface) || { u: 0, v: 0 };
  const offset = state.selectionOffset || { i: 0, j: 0 };
  const startObjects = cloneObjects(selectedObjects());
  selectSession = {
    kind,
    handle: extra.handle || null,
    startUv: uv,
    startPoint: worldPoint,
    startLocalPoint: worldToBaseFromCell(worldPoint, state.surface, offset) || worldPoint,
    startObjects,
    startShapeInfos: new Map(startObjects.filter(o => o.type === "rectangle" || o.type === "ellipse").map(o => [o.id, shapeBoxInfo(o)])),
    before: cloneObjects(state.objects),
    startBounds: selectionBounds(selectedObjects()),
    startGroupRotation: state.selectionGroupRotation || 0,
    startGroupFrame: state.selectionGroupFrame ? { ...state.selectionGroupFrame } : null,
    startSelectionIds: [...currentSelectionIds()],
    startSelectionOffset: { ...offset },
    additive: !!extra.additive,
    marqueeStart: extra.marqueeStart || null,
    moved: false
  };
}

function moveSelectedByUvDelta(du, dv) {
  if (!selectSession) return;
  const ids = new Set(selectSession.startSelectionIds);
  if (ids.size > 1 && selectSession.startGroupFrame) {
    const dx = state.surface.v1.x * du + state.surface.v2.x * dv;
    const dy = state.surface.v1.y * du + state.surface.v2.y * dv;
    state.selectionGroupFrame = { ...selectSession.startGroupFrame, cx: selectSession.startGroupFrame.cx + dx, cy: selectSession.startGroupFrame.cy + dy };
  }
  for (const object of state.objects) {
    if (!ids.has(object.id)) continue;
    const start = selectSession.startObjects.find(item => item.id === object.id);
    if (!start) continue;
    object.points = start.points.map(point => {
      const uv = ensurePointUv(point) || { u: 0, v: 0 };
      return pointFromUv({ u: uv.u + du, v: uv.v + dv }, point.pressure ?? 0.5);
    }).map((point, index) => ({ ...point, inHandle: start.points[index].inHandle ? { ...start.points[index].inHandle } : undefined, outHandle: start.points[index].outHandle ? { ...start.points[index].outHandle } : undefined }));
  }
}
function resizeSelectionFromHandle(worldPoint, event) {
  const handle = selectSession?.handle;
  if (!selectSession?.startBounds || !handle) return false;
  const local = worldToBaseFromCell(worldPoint, state.surface, state.selectionOffset || { i: 0, j: 0 });
  if (!local) return false;

  if (handle.type === "dotResize") {
    const object = primarySelectedObject();
    const start = selectSession.startObjects.find(item => item.id === object?.id);
    if (!object || !start) return false;
    object.points = start.points.map(point => structuredClone(point));
    object.size = Math.max(2, length(sub(local, start.points[0])) * 2);
    if (state.ui.sizeInput && document.activeElement !== state.ui.sizeInput) state.ui.sizeInput.value = Math.round(object.size);
    return true;
  }

  if (handle.type !== "bbox") return false;

  const edge = handle.edge;
  const isCorner = ["nw", "ne", "se", "sw"].includes(edge);
  const keepAspect = modifierActive(event, "constrain") && isCorner;
  const fromCenter = modifierActive(event, "center");
  const opposite = { w: "e", e: "w", n: "s", s: "n", nw: "se", ne: "sw", se: "nw", sw: "ne" };

  function scaleForHandle(pointerLocal, localMap) {
    const anchor = fromCenter ? localMap.center : localMap[opposite[edge]];
    const handleStart = localMap[edge];
    if (!anchor || !handleStart) return null;
    const startVector = { x: handleStart.x - anchor.x, y: handleStart.y - anchor.y };
    const currentVector = { x: pointerLocal.x - anchor.x, y: pointerLocal.y - anchor.y };
    let sx = (edge.includes("w") || edge.includes("e")) ? signedScaleValue(currentVector.x / (Math.abs(startVector.x) < 0.0001 ? (startVector.x < 0 ? -0.0001 : 0.0001) : startVector.x)) : 1;
    let sy = (edge.includes("n") || edge.includes("s")) ? signedScaleValue(currentVector.y / (Math.abs(startVector.y) < 0.0001 ? (startVector.y < 0 ? -0.0001 : 0.0001) : startVector.y)) : 1;
    if (keepAspect) {
      const uniform = Math.max(Math.abs(sx), Math.abs(sy));
      sx = uniform * (sx < 0 ? -1 : 1);
      sy = uniform * (sy < 0 ? -1 : 1);
    }
    return { anchor, sx, sy };
  }

  function transformVectorInFrame(vector, sx, sy, angle) {
    const c = Math.cos(-angle), s = Math.sin(-angle);
    const lx = vector.x * c - vector.y * s;
    const ly = vector.x * s + vector.y * c;
    const c2 = Math.cos(angle), s2 = Math.sin(angle);
    const x = lx * sx, y = ly * sy;
    return { x: x * c2 - y * s2, y: x * s2 + y * c2 };
  }

  const single = selectedObjects();
  if (single.length === 1 && (single[0].type === "rectangle" || single[0].type === "ellipse") && handle.oriented) {
    const object = single[0];
    const start = selectSession.startObjects.find(item => item.id === object.id);
    const info = selectSession.startShapeInfos.get(object.id);
    if (!start || !info) return false;
    const left = info.center.x - info.width / 2, right = info.center.x + info.width / 2;
    const top = info.center.y - info.height / 2, bottom = info.center.y + info.height / 2;
    const localMap = {
      nw: { x: left, y: top }, n: { x: info.center.x, y: top }, ne: { x: right, y: top },
      e: { x: right, y: info.center.y }, se: { x: right, y: bottom }, s: { x: info.center.x, y: bottom },
      sw: { x: left, y: bottom }, w: { x: left, y: info.center.y }, center: { ...info.center }
    };
    const pointerLocal = inverseRotateAround(local, info.center, info.angle);
    const resize = scaleForHandle(pointerLocal, localMap);
    if (!resize) return false;
    const transformed = start.points.map(point => ({ x: resize.anchor.x + (point.x - resize.anchor.x) * resize.sx, y: resize.anchor.y + (point.y - resize.anchor.y) * resize.sy }));
    const minX = Math.min(...transformed.map(p => p.x)), maxX = Math.max(...transformed.map(p => p.x));
    const minY = Math.min(...transformed.map(p => p.y)), maxY = Math.max(...transformed.map(p => p.y));
    const localCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const worldCenter = rotateAround(localCenter, info.center, info.angle);
    setShapeFromCenterSize(object, worldCenter, Math.max(1, maxX - minX), Math.max(1, maxY - minY), info.angle);
    return true;
  }

  if (single.length === 1 && (single[0].type === "pen" || single[0].type === "polygon" || single[0].type === "raster") && handle.orientedGeneric) {
    const object = single[0];
    const start = selectSession.startObjects.find(item => item.id === object.id);
    const info = genericBoxInfo(start);
    if (!start || !info) return false;
    const pointerLocal = inverseRotateAround(local, info.center, info.angle);
    const resize = scaleForHandle(pointerLocal, { ...info.local, center: info.localCenter });
    if (!resize) return false;
    object.points = start.points.map(point => {
      const lp = inverseRotateAround(point, info.center, info.angle);
      const scaledLocal = { x: resize.anchor.x + (lp.x - resize.anchor.x) * resize.sx, y: resize.anchor.y + (lp.y - resize.anchor.y) * resize.sy };
      const scaledWorld = rotateAround(scaledLocal, info.center, info.angle);
      const next = withUv({ ...point, x: scaledWorld.x, y: scaledWorld.y });
      if (point.inHandle) {
        const v = transformVectorInFrame(point.inHandle, resize.sx, resize.sy, info.angle);
        next.inHandle = { dx: v.x, dy: v.y };
      }
      if (point.outHandle) {
        const v = transformVectorInFrame(point.outHandle, resize.sx, resize.sy, info.angle);
        next.outHandle = { dx: v.x, dy: v.y };
      }
      return next;
    });
    object.selectionRotation = start.selectionRotation || 0;
    return true;
  }

  const fallback = selectSession.startBounds;
  const startFrame = selectSession.startGroupFrame || { cx: fallback.cx, cy: fallback.cy, width: fallback.width, height: fallback.height, rotation: selectSession.startGroupRotation || 0 };
  const cx = startFrame.cx, cy = startFrame.cy;
  const minX = cx - startFrame.width / 2, maxX = cx + startFrame.width / 2;
  const minY = cy - startFrame.height / 2, maxY = cy + startFrame.height / 2;
  const groupAngle = startFrame.rotation || 0;
  const groupCenter = { x: cx, y: cy };
  const localMap = {
    nw: { x: minX, y: minY }, n: { x: cx, y: minY }, ne: { x: maxX, y: minY },
    e: { x: maxX, y: cy }, se: { x: maxX, y: maxY }, s: { x: cx, y: maxY },
    sw: { x: minX, y: maxY }, w: { x: minX, y: cy }, center: { x: cx, y: cy }
  };
  const pointerLocal = inverseRotateAround(local, groupCenter, groupAngle);
  const resize = scaleForHandle(pointerLocal, localMap);
  if (!resize) return false;
  groupTransformFromStart(point => {
    const lp = inverseRotateAround(point, groupCenter, groupAngle);
    const scaledLocal = { x: resize.anchor.x + (lp.x - resize.anchor.x) * resize.sx, y: resize.anchor.y + (lp.y - resize.anchor.y) * resize.sy };
    return rotateAround(scaledLocal, groupCenter, groupAngle);
  }, vector => transformVectorInFrame(vector, resize.sx, resize.sy, groupAngle));

  if (currentSelectionIds().length > 1) {
    const centerLocal = { x: cx, y: cy };
    const newCenterLocal = {
      x: resize.anchor.x + (centerLocal.x - resize.anchor.x) * resize.sx,
      y: resize.anchor.y + (centerLocal.y - resize.anchor.y) * resize.sy
    };
    const newCenter = rotateAround(newCenterLocal, groupCenter, groupAngle);
    state.selectionGroupRotation = groupAngle;
    state.selectionGroupFrame = {
      cx: newCenter.x,
      cy: newCenter.y,
      width: Math.max(0.0001, Math.abs(startFrame.width * resize.sx)),
      height: Math.max(0.0001, Math.abs(startFrame.height * resize.sy)),
      rotation: groupAngle
    };
  }
  return true;
}

function rotateSelectionTo(worldPoint, event) {
  if (!selectSession?.startBounds || selectSession.handle?.type !== "rotate") return false;
  const local = worldToBaseFromCell(worldPoint, state.surface, state.selectionOffset || { i: 0, j: 0 });
  if (!local) return false;
  const center = { x: selectSession.startBounds.cx, y: selectSession.startBounds.cy };
  const start = selectSession.startLocalPoint || selectSession.startPoint;
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let angle = Math.atan2(local.y - center.y, local.x - center.x) - startAngle;
  if (modifierActive(event, "snap")) angle = Math.round(angle / SNAP) * SNAP;

  const ids = new Set(selectSession.startSelectionIds);
  if (ids.size > 1) {
    const startFrame = selectSession.startGroupFrame || (selectSession.startBounds ? { cx: selectSession.startBounds.cx, cy: selectSession.startBounds.cy, width: selectSession.startBounds.width, height: selectSession.startBounds.height, rotation: selectSession.startGroupRotation || 0 } : null);
    state.selectionGroupRotation = (startFrame?.rotation || selectSession.startGroupRotation || 0) + angle;
    if (startFrame) state.selectionGroupFrame = { ...startFrame, cx: center.x, cy: center.y, rotation: state.selectionGroupRotation };
  }
  for (const object of state.objects) {
    if (!ids.has(object.id)) continue;
    const startObject = selectSession.startObjects.find(item => item.id === object.id);
    if (!startObject) continue;
    if (object.type === "dot") continue;
  if (object.type === "rectangle" || object.type === "ellipse") {
      const info = selectSession.startShapeInfos.get(object.id) || shapeBoxInfo(startObject);
      if (!info) continue;
      const newCenter = rotateAround(info.center, center, angle);
      setShapeFromCenterSize(object, newCenter, info.width, info.height, (info.angle || 0) + angle);
      continue;
    }
    object.points = startObject.points.map(point => {
      const rotated = withUv(rotateAround(point, center, angle));
      if (point.inHandle) rotated.inHandle = { dx: point.inHandle.dx * Math.cos(angle) - point.inHandle.dy * Math.sin(angle), dy: point.inHandle.dx * Math.sin(angle) + point.inHandle.dy * Math.cos(angle) };
      if (point.outHandle) rotated.outHandle = { dx: point.outHandle.dx * Math.cos(angle) - point.outHandle.dy * Math.sin(angle), dy: point.outHandle.dx * Math.sin(angle) + point.outHandle.dy * Math.cos(angle) };
      return rotated;
    });
    object.selectionRotation = (startObject.selectionRotation || 0) + angle;
  }
  return true;
}

function dragNodeOrHandle(worldPoint, event) {
  let object = primarySelectedObject();
  const handle = selectSession?.handle;
  if (!object || !handle) return false;
  const local = worldToBaseFromCell(worldPoint, state.surface, state.selectionOffset || { i: 0, j: 0 });
  if (!local) return false;
  const start = selectSession.startObjects.find(item => item.id === object.id);
  if (!start) return false;

  if (handle.type === "shapeNode") {
    const beforeId = object.id;
    object = convertRectangleToPolygon(object);
    object.points = rectangleCornerPoints(start);
    object.points[handle.index] = withUv({ ...object.points[handle.index], x: local.x, y: local.y, pressure: 0.5 });
    state.selectedNodeIndex = handle.index;
    state.selectedHandleKind = "node";
    return true;
  }

  object.points = start.points.map(point => structuredClone(point));
  if (handle.type === "node") {
    object.points[handle.index] = withUv({ ...object.points[handle.index], x: local.x, y: local.y, pressure: 0.5 });
    state.selectedNodeIndex = handle.index;
    state.selectedHandleKind = "node";
    return true;
  }
  if (handle.type === "inHandle" || handle.type === "outHandle") {
    const node = object.points[handle.index];
    const key = handle.type;
    node[key] = { dx: local.x - node.x, dy: local.y - node.y };
    const otherKey = key === "inHandle" ? "outHandle" : "inHandle";
    // Handles are independent by default. Hold Shift/Snap to mirror.
    if (modifierActive(event, "snap") && node[otherKey]) node[otherKey] = { dx: -node[key].dx, dy: -node[key].dy };
    state.selectedNodeIndex = handle.index;
    state.selectedHandleKind = handle.type;
    return true;
  }
  return false;
}
function updateMarquee(worldPoint) {
  if (!selectSession?.marqueeStart) return;
  const a = selectSession.marqueeStart, b = worldPoint;
  state.selectionBox = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}
function commitMarqueeSelection() {
  const box = state.selectionBox;
  if (!box) return;
  const ids = [];
  for (const object of state.objects) {
    const bounds = objectBounds(object);
    if (!bounds) continue;
    if (bounds.maxX >= box.minX && bounds.minX <= box.maxX && bounds.maxY >= box.minY && bounds.minY <= box.maxY) ids.push(object.id);
  }
  if (selectSession?.additive) {
    const set = new Set(selectSession.startSelectionIds);
    ids.forEach(id => set.add(id));
    setSelection([...set], state.selectionOffset);
  } else {
    setSelection(ids, state.selectionOffset);
  }
  state.selectionBox = null;
}

function updateHomHover(worldPoint) {
  const hit = objectHitAt(worldPoint);
  state.homHoverId = hit ? hit.object.id : null;
  state.homHoverOffset = hit ? { ...hit.offset } : { i: 0, j: 0 };
  requestRender();
}


function densifyPathForRub(points, maxStep = 5, closed = false) {
  const source = points.filter(Boolean);
  if (source.length < 2) return source.map(point => ({ ...point }));
  const path = closed ? [...source, source[0]] : source;
  const out = [{ ...path[0] }];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = Math.max(0.0001, length(sub(b, a)));
    const steps = Math.max(1, Math.ceil(d / Math.max(1, maxStep)));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      out.push(withUv({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        pressure: 0.5
      }));
    }
  }
  return out;
}

function rubSamplesForObject(object, radius) {
  const maxStep = Math.max(2, Math.min(8, radius * 0.45));
  if (object.type === "rectangle") return densifyPathForRub(sampleShapePath(object, 4), maxStep, false);
  if (object.type === "polygon") return densifyPathForRub(object.points || [], maxStep, true);
  if (object.type === "ellipse") return densifyPathForRub(sampleShapePath(object, 160), maxStep, false);
  if (object.type === "line") return densifyPathForRub(sampleLinePath(object, 24), maxStep, false);
  if (object.type === "pen") return densifyPathForRub(object.points || [], maxStep, false);
  if (object.type === "dot") return densifyPathForRub(sampleObjectPath(object), maxStep, false);
  return densifyPathForRub(sampleObjectPath(object), maxStep, false);
}

function pointInsideEraseHole(point, object) {
  if (!object.eraseHoles?.length) return false;
  return object.eraseHoles.some(hole => length(sub(point, hole)) <= Math.max(0.5, hole.radius || 1));
}

function isFilledVectorObject(object) {
  return (object.type === "rectangle" || object.type === "ellipse" || object.type === "polygon") && (object.shapeMode || "outline") === "fill";
}

function splitByRubEraser(object, point, radius) {
  if (isFilledVectorObject(object)) object = convertFilledShapeToRaster(object);
  if (object.type === "raster") {
    touchedRasterIds.add(object.id);
    const previousPoint = rubPreviousPoints.get(object.id) || null;
    const erased = eraseRasterObject(object, point, radius, previousPoint);
    rubPreviousPoints.set(object.id, { x: point.x, y: point.y });
    return [erased];
  }

  const outlineSize = object.type === "dot" ? Math.max(1, (object.size || 20) * 0.13) : (object.size || 1);
  const threshold = radius + outlineSize * 0.75;
  const closed = object.type === "dot" || object.type === "rectangle" || object.type === "ellipse" || object.type === "polygon";
  const samples = rubSamplesForObject(object, radius);
  const chunks = [];
  let chunk = [], changed = false;
  for (const sample of samples) {
    if (length(sub(sample, point)) <= threshold) {
      changed = true;
      if (chunk.length >= 2) chunks.push(chunk);
      chunk = [];
    } else chunk.push({ ...sample });
  }
  if (chunk.length >= 2) chunks.push(chunk);
  if (!changed) return [object];

  // Closed outlines are sampled with a seam. If the erased stroke does not
  // touch that seam, the two surviving end chunks are actually one continuous
  // arc and should be merged so a rectangle/ellipse doesn't appear to break at
  // a random corner.
  if (closed && chunks.length > 1) {
    const firstRemoved = length(sub(samples[0], point)) <= threshold;
    const lastRemoved = length(sub(samples.at(-1), point)) <= threshold;
    if (!firstRemoved && !lastRemoved) {
      const first = chunks.shift();
      const last = chunks.pop();
      chunks.unshift([...last, ...first]);
    }
  }

  return chunks.map(points => ({
    ...object,
    id: state.nextObjectId++,
    type: "pen",
    shapeMode: "outline",
    eraseHoles: undefined,
    size: outlineSize,
    points
  }));
}
function applyEraser(worldPoint) {
  const radius = Math.max(1, Number(state.ui.sizeInput.value) || state.eraserSize) / 2;
  const next = [];
  for (const object of state.objects) {
    if (visibleLayerOpacity(object.layerId || "layer-1") <= 0) { next.push(object); continue; }
    const local = localHitPoint(object, worldPoint, radius);
    if (!local) { next.push(object); continue; }
    eraseChanged = true;
    if (state.eraserMode === "object") {
      clearRasterCanvas(object.id);
      continue;
    }
    next.push(...splitByRubEraser(object, local, radius));
  }
  if (eraseChanged) { state.objects = next; requestRender(); }
}

export function deleteSelection() {
  if (state.selectMode === "points" && deleteSelectedPathPoint()) return;
  const ids = new Set(currentSelectionIds());
  if (!ids.size) return;
  const before = cloneObjects(state.objects);
  state.objects = state.objects.filter(item => !ids.has(item.id));
  setSelection([]);
  replaceAll(before, state.objects);
  syncSelectionActions();
}
export function duplicateSelection() {
  const selected = selectedObjects();
  if (!selected.length) return;
  const before = cloneObjects(state.objects);
  const delta = { u: 0.04, v: 0.04 };
  const copies = selected.map(object => {
    const copy = structuredClone(object);
    copy.id = state.nextObjectId++;
    copy.points = copy.points.map(point => {
      const uv = ensurePointUv(point) || { u: 0, v: 0 };
      return pointFromUv({ u: uv.u + delta.u, v: uv.v + delta.v }, point.pressure ?? 0.5);
    }).map((point, index) => ({ ...point, inHandle: object.points[index].inHandle ? structuredClone(object.points[index].inHandle) : undefined, outHandle: object.points[index].outHandle ? structuredClone(object.points[index].outHandle) : undefined }));
    return copy;
  });
  state.objects.push(...copies);
  setSelection(copies.map(item => item.id), state.selectionOffset);
  replaceAll(before, state.objects);
  syncSelectionActions();
}

function parseCssHexColor(color) {
  if (typeof color !== "string") return null;
  const value = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) {
    const [r, g, b] = short[1].split("").map(ch => parseInt(ch + ch, 16));
    return { r, g, b };
  }
  const full = /^#([0-9a-f]{6})$/i.exec(value);
  if (full) {
    const n = parseInt(full[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  return null;
}

function recolorRasterObject(object, color) {
  if (!object || object.type !== "raster") return false;
  const rgb = parseCssHexColor(color);
  if (!rgb) { object.color = color; object.fillColor = color; return false; }
  const canvas = getRasterCanvas(object, () => {
    const live = state.objects.find(item => item.id === object.id);
    if (!live?.pendingRasterColor) return;
    if (recolorRasterObject(live, live.pendingRasterColor)) {
      delete live.pendingRasterColor;
      requestRender();
    }
  });
  if (!canvas) {
    object.color = color;
    object.fillColor = color;
    object.tintColor = color;
    object.pendingRasterColor = color;
    return false;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  let changed = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 0) continue;
    data[i] = rgb.r;
    data[i + 1] = rgb.g;
    data[i + 2] = rgb.b;
    changed = true;
  }
  object.color = color;
  object.fillColor = color;
  object.tintColor = color;
  if (!changed) return true;
  ctx.putImageData(image, 0, 0);
  object.imageDataUrl = canvas.toDataURL("image/png");
  canvas.__sourceDataUrl = object.imageDataUrl;
  object.rasterWidth = canvas.width;
  object.rasterHeight = canvas.height;
  setRasterCanvas(object.id, canvas, object.imageDataUrl);
  delete object.pendingRasterColor;
  return true;
}

export function applySelectedColor(color) {
  const objects = selectedObjects();
  if (!objects.length) return false;
  for (const object of objects) {
    if (object.type === "raster") {
      recolorRasterObject(object, color);
      continue;
    }
    object.color = color;
    if ((object.shapeMode || "outline") === "fill") object.fillColor = color;
  }
  requestRender();
  return true;
}
export function applySelectedSize(size) {
  const objects = selectedObjects();
  if (!objects.length) return false;
  for (const object of objects) {
    if (object.type === "dot") continue; // Dots are resized only by their radius handle.
    object.size = Math.max(1, Number(size) || 1);
  }
  requestRender();
  return true;
}
export function applySelectionDimensions(width, height) {
  const bounds = selectionBounds();
  if (!bounds) return false;
  const targetW = Math.max(1, Number(width) || bounds.width), targetH = Math.max(1, Number(height) || bounds.height);
  const before = cloneObjects(state.objects);
  const sx = targetW / Math.max(0.0001, bounds.width), sy = targetH / Math.max(0.0001, bounds.height);
  const center = { x: bounds.cx, y: bounds.cy };
  selectSession = { startObjects: cloneObjects(selectedObjects()), startSelectionIds: [...currentSelectionIds()] };
  groupTransformFromStart(point => ({ x: center.x + (point.x - center.x) * sx, y: center.y + (point.y - center.y) * sy }), vector => ({ x: vector.x * sx, y: vector.y * sy }));
  replaceAll(before, state.objects);
  syncSelectionActions();
  requestRender();
  selectSession = null;
  return true;
}
export function flipSelection(axis) {
  const bounds = selectionBounds();
  if (!bounds) return false;
  const before = cloneObjects(state.objects);
  selectSession = { startObjects: cloneObjects(selectedObjects()), startSelectionIds: [...currentSelectionIds()] };
  const center = { x: bounds.cx, y: bounds.cy };
  groupTransformFromStart(point => ({ x: axis === "h" ? center.x - (point.x - center.x) : point.x, y: axis === "v" ? center.y - (point.y - center.y) : point.y }), vector => ({ x: axis === "h" ? -vector.x : vector.x, y: axis === "v" ? -vector.y : vector.y }));
  for (const object of selectedObjects()) {
    if (object.type !== "rectangle" && object.type !== "ellipse") continue;
    const start = selectSession.startObjects.find(item => item.id === object.id);
    object.rotation = axis === "v" ? -(start?.rotation || 0) : Math.PI - (start?.rotation || 0);
  }
  replaceAll(before, state.objects);
  syncSelectionActions();
  requestRender();
  selectSession = null;
  return true;
}

export function setSelectMode(mode) {
  state.selectMode = mode === "points" ? "points" : "transform";
  state.selectedHandleKind = null;
  state.pathInsertMode = false;
  syncShapeControls();
  syncSelectionActions();
  requestRender();
}

export function setShapeMode(mode) { state.shapeMode = mode === "fill" ? "fill" : "outline"; syncShapeControls(); }
export function toggleTouchModifier(name) { if (state.touchModifiers && name in state.touchModifiers) { state.touchModifiers[name] = !state.touchModifiers[name]; syncTouchModifierUi(); } }
export function syncShapeControls() {
  const showShape = state.tool === "rectangle" || state.tool === "ellipse";
  const controls = state.ui.shapeModeControls;
  if (controls) {
    if (showShape) { controls.hidden = false; requestAnimationFrame(() => controls.classList.add("visible")); }
    else { controls.classList.remove("visible"); window.setTimeout(() => { if (state.tool !== "rectangle" && state.tool !== "ellipse") controls.hidden = true; }, 210); }
  }
  const selectControls = state.ui.selectModeControls;
  if (selectControls) {
    if (state.tool === "select") { selectControls.hidden = false; requestAnimationFrame(() => selectControls.classList.add("visible")); }
    else { selectControls.classList.remove("visible"); window.setTimeout(() => { if (state.tool !== "select") selectControls.hidden = true; }, 210); }
  }
  if (state.ui.shapeOutlineButton) state.ui.shapeOutlineButton.classList.toggle("active", state.shapeMode === "outline");
  if (state.ui.shapeFillButton) state.ui.shapeFillButton.classList.toggle("active", state.shapeMode === "fill");
  if (state.ui.selectTransformButton) state.ui.selectTransformButton.classList.toggle("active", state.selectMode !== "points");
  if (state.ui.selectPointsButton) state.ui.selectPointsButton.classList.toggle("active", state.selectMode === "points");
  syncTouchModifierUi();
}
function syncTouchModifierUi() {
  const compact = window.matchMedia("(max-width: 760px)").matches;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const relevantTool = state.tool === "line" || state.tool === "rectangle" || state.tool === "ellipse" || state.tool === "select";
  const relevant = compact && touch && relevantTool;
  if (state.ui.mobileModifierBar) {
    state.ui.mobileModifierBar.classList.toggle("visible", relevant);
    state.ui.mobileModifierBar.hidden = !relevant;
  }
  document.body.classList.toggle("mobile-modifiers-visible", !!relevant);
  if (state.ui.touchConstrainButton) state.ui.touchConstrainButton.classList.toggle("active", !!state.touchModifiers.constrain);
  if (state.ui.touchCenterButton) state.ui.touchCenterButton.classList.toggle("active", !!state.touchModifiers.center);
  if (state.ui.touchSnapButton) state.ui.touchSnapButton.classList.toggle("active", !!state.touchModifiers.snap);
}

function syncSelectionActions() {
  syncPrimarySelection();
  const objects = selectedObjects();
  const hasSelection = !!objects.length;
  const selectionUiActive = hasSelection && state.tool === "select";
  if (state.ui.selectionActions) state.ui.selectionActions.hidden = !selectionUiActive;
  if (!selectionUiActive) return;
  const bounds = selectionBounds(objects);
  if (bounds && state.ui.selectionWidthInput && document.activeElement !== state.ui.selectionWidthInput) state.ui.selectionWidthInput.value = Math.round(bounds.width);
  if (bounds && state.ui.selectionHeightInput && document.activeElement !== state.ui.selectionHeightInput) state.ui.selectionHeightInput.value = Math.round(bounds.height);
  if (state.ui.colorInput && objects[0]?.color) state.ui.colorInput.value = objects[0].color;
  const canReflectSelectedSize = objects.length === 1
    && ["pen", "line", "rectangle", "ellipse", "polygon"].includes(objects[0].type)
    && objects[0].type !== "raster"
    && objects[0].type !== "dot";
  if (state.ui.sizeInput && canReflectSelectedSize && Number.isFinite(objects[0]?.size) && document.activeElement !== state.ui.sizeInput) {
    state.ui.sizeInput.value = objects[0].size;
  }
  const dotOnly = objects.length === 1 && objects[0].type === "dot";
  for (const el of [state.ui.selectionWidthInput?.closest?.("label"), state.ui.selectionHeightInput?.closest?.("label"), state.ui.applySelectionSizeButton].filter(Boolean)) el.hidden = dotOnly || state.selectMode === "points";
  const singleEditablePath = objects.length === 1 && (objects[0].type === "line" || objects[0].type === "polygon" || objects[0].type === "rectangle");
  const pointToolsVisible = state.selectMode === "points" && singleEditablePath;
  if (state.ui.addPathPointButton) {
    state.ui.addPathPointButton.hidden = !pointToolsVisible;
    state.ui.addPathPointButton.classList.toggle("active", !!state.pathInsertMode);
  }
  if (state.ui.togglePathPointModeButton) state.ui.togglePathPointModeButton.hidden = !(state.selectMode === "points" && objects.length === 1 && objects[0].type === "line");
  if (state.ui.deletePathPointButton) state.ui.deletePathPointButton.hidden = !pointToolsVisible;
  if (state.ui.groupSelectionButton) state.ui.groupSelectionButton.hidden = objects.length < 2 || state.selectMode === "points";
  if (state.ui.ungroupSelectionButton) state.ui.ungroupSelectionButton.hidden = selectedGroupIds().length === 0 || state.selectMode === "points";
  if (objects.length === 1 && objects[0].type === "line" && Number.isInteger(state.selectedNodeIndex) && objects[0].points[state.selectedNodeIndex]) {
    const node = objects[0].points[state.selectedNodeIndex];
    if (state.ui.togglePathPointModeButton) state.ui.togglePathPointModeButton.textContent = node.inHandle || node.outHandle ? "Corner" : "Curve";
  } else if (state.ui.togglePathPointModeButton) state.ui.togglePathPointModeButton.textContent = "Curve";
}

export function startPointer(event) {
  state.ui.sizeInput.blur();
  try { state.canvas.setPointerCapture(event.pointerId); } catch {}
  activePointers.set(event.pointerId, pointerPoint(event));
  if (activePointers.size >= 2) {
    event.preventDefault();
    const pts = [...activePointers.values()];
    const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    touchGesture = { center, distance: Math.max(1, length(sub(pts[1], pts[0]))), view: { ...state.view } };
    isDrawing = false; isPanning = false; currentObject = null; state.previewObject = null; selectSession = null; state.selectionBox = null;
    return;
  }
  event.preventDefault();
  const screen = pointerPoint(event), world = screenToWorld(screen, state.view, state.cssWidth, state.cssHeight);
  if (state.tool === "select") {
    const handle = selectionHandleAt(world);
    if (handle) {
      state.selectedHandleKind = handle.type === "shapeNode" ? "node" : handle.type;
      if (Number.isInteger(handle.index)) state.selectedNodeIndex = handle.index;
      const kind = handle.type === "rotate" ? "rotate" : (handle.type === "bbox" || handle.type === "dotResize" ? "resize" : "node");
      beginSelectionSession(world, kind, { handle });
      syncSelectionActions();
      requestRender();
      return;
    }

    const currentPrimary = primarySelectedObject();
    if (state.selectMode === "points" && state.pathInsertMode && ["line", "polygon", "rectangle"].includes(currentPrimary?.type)) {
      const local = worldToBaseFromCell(world, state.surface, state.selectionOffset || { i: 0, j: 0 });
      if (local && insertPointIntoSelectedPath(local)) return;
    }

    const hit = objectHitAt(world);
    if (state.selectMode === "points" && event.shiftKey && ["line", "polygon", "rectangle"].includes(currentPrimary?.type) && hit?.object?.id === currentPrimary.id) {
      const local = worldToBaseFromCell(world, state.surface, hit.offset);
      if (local && insertPointIntoSelectedPath(local)) return;
    }

    if (hit) {
      state.selectedHandleKind = null;
      const ids = idsForObjectHit(hit);
      const alreadySelected = ids.every(id => currentSelectionIds().includes(id));
      if (event.shiftKey && state.selectMode !== "points") {
        toggleSelectionIds(ids, hit.offset);
      } else if (!alreadySelected) {
        setSelection(ids, hit.offset);
      }
      if (state.selectMode !== "points" && !event.shiftKey) beginSelectionSession(world, "move");
      requestRender();
      return;
    }

    if (!event.shiftKey) { state.selectedHandleKind = null; setSelection([]); }
    if (state.selectMode !== "points") {
      beginSelectionSession(world, "marquee", { marqueeStart: world, additive: event.shiftKey });
      state.selectionBox = { minX: world.x, minY: world.y, maxX: world.x, maxY: world.y };
    }
    requestRender();
    return;
  }
  if (state.tool === "hom") {
    const hit = objectHitAt(world);
    state.homSelectedId = hit ? hit.object.id : null;
    state.homSelectedOffset = hit ? { ...hit.offset } : { i: 0, j: 0 };
    state.homHoverId = hit ? hit.object.id : null;
    state.homHoverOffset = hit ? { ...hit.offset } : { i: 0, j: 0 };
    requestRender();
    return;
  }
  if (state.tool === "pan" || spaceDown) { isPanning = true; panStart = screen; viewStart = { ...state.view }; state.canvas.classList.add("active-pan"); return; }
  if (temporaryDotDown || state.tool === "dot") { saveCurrentSize(); stampDot(event); isDrawing = false; currentObject = null; startPoint = null; return; }
  isDrawing = true;
  if (state.tool === "erase") { eraseBefore = cloneObjects(state.objects); eraseChanged = false; rubPreviousPoints = new Map(); touchedRasterIds = new Set(); applyEraser(world); return; }
  startPoint = worldFromEvent(event);
  currentObject = { id: state.nextObjectId++, type: state.tool, layerId: activeDrawingLayer().id, points: [startPoint], ...currentStyle() };
}

export function movePointer(event) {
  const screen = pointerPoint(event);
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, screen);
  if (touchGesture && activePointers.size >= 2) {
    event.preventDefault();
    const pts = [...activePointers.values()];
    const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const distance = Math.max(1, length(sub(pts[1], pts[0])));
    const zoom = clamp(touchGesture.view.zoom * (distance / touchGesture.distance), 0.16, 7.5);
    const worldAtStart = screenToWorld(touchGesture.center, touchGesture.view, state.cssWidth, state.cssHeight);
    state.view.zoom = zoom;
    state.view.x = worldAtStart.x - (center.x - state.cssWidth / 2) / zoom;
    state.view.y = worldAtStart.y - (center.y - state.cssHeight / 2) / zoom;
    requestRender();
    return;
  }
  const world = screenToWorld(screen, state.view, state.cssWidth, state.cssHeight);
  if (selectSession) {
    event.preventDefault();
    selectSession.moved = true;
    if (selectSession.kind === "move") {
      const uv = worldToBasis(world, state.surface); if (uv && selectSession.startUv) moveSelectedByUvDelta(uv.u - selectSession.startUv.u, uv.v - selectSession.startUv.v);
    } else if (selectSession.kind === "resize") resizeSelectionFromHandle(world, event);
    else if (selectSession.kind === "rotate") rotateSelectionTo(world, event);
    else if (selectSession.kind === "node") dragNodeOrHandle(world, event);
    else if (selectSession.kind === "marquee") updateMarquee(world);
    syncSelectionActions();
    requestRender();
    return;
  }
  if (state.tool === "hom") { updateHomHover(world); return; }
  if (isPanning) { event.preventDefault(); state.view.x = viewStart.x - (screen.x - panStart.x) / state.view.zoom; state.view.y = viewStart.y - (screen.y - panStart.y) / state.view.zoom; requestRender(); return; }
  if (!isDrawing) return;
  event.preventDefault();
  if (state.tool === "erase") { applyEraser(world); return; }
  const point = worldFromEvent(event);
  if (state.tool === "pen") { currentObject.points.push(point); state.previewObject = currentObject; hideAngleHint(); redraw(currentObject); }
  if (state.tool === "line") {
    const data = lineFromModifiers(startPoint, point, event);
    state.previewObject = { ...currentObject, points: data.points };
    showAngleHint(screen, data.angleDegrees); redraw(state.previewObject);
  }
  if (state.tool === "ellipse" || state.tool === "rectangle") {
    const data = shapeBoxFromModifiers(startPoint, point, event);
    state.previewObject = { ...currentObject, points: data.points };
    hideAngleHint(); redraw(state.previewObject);
  }
}

export function stopPointer(event) {
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) touchGesture = null;
  if (selectSession) {
    if (selectSession.kind === "marquee") commitMarqueeSelection();
    else if (selectSession.before && JSON.stringify(selectSession.before) !== JSON.stringify(state.objects)) replaceAll(selectSession.before, state.objects);
    selectSession = null;
    state.selectionBox = null;
    syncSelectionActions();
    requestRender();
    return;
  }
  if (isPanning) { isPanning = false; state.canvas.classList.remove("active-pan"); return; }
  if (!isDrawing) return;
  event.preventDefault(); isDrawing = false;
  if (state.tool === "erase") {
    if (eraseChanged) splitRasterObjectsAfterRub();
    if (eraseChanged) replaceAll(eraseBefore, state.objects);
    eraseBefore = null; eraseChanged = false; rubPreviousPoints = new Map(); touchedRasterIds = new Set(); return;
  }
  if (state.tool === "line") currentObject.points = lineFromModifiers(startPoint, worldFromEvent(event), event).points;
  if (state.tool === "ellipse" || state.tool === "rectangle") currentObject.points = shapeBoxFromModifiers(startPoint, worldFromEvent(event), event).points;
  if (currentObject.points.length >= 1 && currentObject.type === "dot") addObject(currentObject);
  else if (currentObject.points.length >= 2) addObject(currentObject);
  state.previewObject = null; currentObject = null; startPoint = null; hideAngleHint();
}

export function handleSpace(event, down) {
  if (event.code !== "Space") return;
  if (down && event.target === state.ui.sizeInput) return;
  event.preventDefault();
  spaceDown = down;
  state.canvas.classList.toggle("panning", down || state.tool === "pan");
}
export function handleTemporaryDot(event, down) {
  const isD = event.key?.toLowerCase?.() === "d";
  if (!isD) return;
  if (down && event.target === state.ui.sizeInput) return;
  temporaryDotDown = down;
}

export { addPathPointMode as addPathPoint, toggleSelectedPathPointMode, deleteSelectedPathPoint };
