// Main canvas renderer. The canvas is only a view; objects are stored separately.
import { state } from "./state.js";
import { add, cellPoint, cellTransform, displacement, edgeTopology, length, pointUv, scale, visibleOffsets, viewportWorldCorners, worldToBasis, worldToScreen } from "./math.js";
import { analyzeSurfaceQuality } from "./surfaceQuality.js";

export function requestRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => { state.renderQueued = false; redraw(); });
}

export function resizeCanvas() {
  state.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  state.cssWidth = window.innerWidth;
  state.cssHeight = window.innerHeight;
  state.canvas.width = Math.round(state.cssWidth * state.dpr);
  state.canvas.height = Math.round(state.cssHeight * state.dpr);
  state.canvas.style.width = `${state.cssWidth}px`;
  state.canvas.style.height = `${state.cssHeight}px`;
  requestRender();
}

function setScreenTransform() { state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); }
function setWorldTransform() {
  const { ctx, cssWidth, cssHeight, view, dpr } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(cssWidth / 2, cssHeight / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.x, -view.y);
}

function clearScreen() {
  setScreenTransform();
  state.ctx.fillStyle = "#fffdf8";
  state.ctx.fillRect(0, 0, state.cssWidth, state.cssHeight);
}

function cellPath(offset) {
  const { ctx, surface } = state;
  const c = cellTransform(surface, offset.i, offset.j);
  ctx.beginPath();
  ctx.moveTo(c.origin.x, c.origin.y);
  ctx.lineTo(c.origin.x + c.e1.x, c.origin.y + c.e1.y);
  ctx.lineTo(c.origin.x + c.e1.x + c.e2.x, c.origin.y + c.e1.y + c.e2.y);
  ctx.lineTo(c.origin.x + c.e2.x, c.origin.y + c.e2.y);
  ctx.closePath();
}

function imageCrop() {
  const { background, surface, imageFitMode } = state;
  const iw = background.naturalWidth, ih = background.naturalHeight;
  if (imageFitMode === "stretch") return { sx: 0, sy: 0, sw: iw, sh: ih };
  const cellAspect = Math.max(1, length(surface.v1)) / Math.max(1, length(surface.v2));
  const imageAspect = iw / ih;
  if (imageAspect > cellAspect) {
    const sw = ih * cellAspect;
    return { sx: (iw - sw) / 2, sy: 0, sw, sh: ih };
  }
  const sh = iw / cellAspect;
  return { sx: 0, sy: (ih - sh) / 2, sw: iw, sh };
}

function drawCellImage(offset, layer = null) {
  const { background, ctx, surface } = state;
  if (!background.image || layer?.visible === false) return;
  const c = cellTransform(surface, offset.i, offset.j);
  const crop = imageCrop();
  ctx.save();
  cellPath(offset);
  ctx.clip();
  ctx.globalAlpha = layer ? (layer.opacity ?? 1) : state.imageOpacity;
  ctx.translate(c.origin.x, c.origin.y);
  ctx.transform(c.e1.x, c.e1.y, c.e2.x, c.e2.y, 0, 0);
  // Cell coordinates use +v upward, but image pixels use y downward.
  // Flip inside local cell space so uploaded images remain visually upright.
  ctx.translate(0, 1);
  ctx.scale(1, -1);
  ctx.drawImage(background.image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, 1, 1);
  ctx.restore();
}

function drawGrid(offsets, denseMode = false) {
  if (state.hideGrid) return;
  if (denseMode && edgeTopology(state.surface).repeatV1 && edgeTopology(state.surface).repeatV2) {
    drawGridLineFamilies();
    return;
  }
  const { ctx, view, background } = state;
  ctx.save();
  ctx.strokeStyle = background.image ? "rgba(0,0,0,.24)" : "rgba(0,0,0,.12)";
  ctx.lineWidth = Math.max(1 / view.zoom, 0.45);
  for (const offset of offsets) { cellPath(offset); ctx.stroke(); }
  ctx.restore();
}

function drawGridLineFamilies() {
  const { ctx, surface, view, background } = state;
  const corners = viewportWorldCorners(view, state.cssWidth, state.cssHeight);
  const basis = corners.map(point => worldToBasis(point, surface)).filter(Boolean);
  if (basis.length < 4) return;
  const uMin = Math.floor(Math.min(...basis.map(p => p.u))) - 2;
  const uMax = Math.ceil(Math.max(...basis.map(p => p.u))) + 2;
  const vMin = Math.floor(Math.min(...basis.map(p => p.v))) - 2;
  const vMax = Math.ceil(Math.max(...basis.map(p => p.v))) + 2;
  const uCount = Math.max(1, uMax - uMin + 1);
  const vCount = Math.max(1, vMax - vMin + 1);
  const strideU = Math.max(1, Math.ceil(uCount / 520));
  const strideV = Math.max(1, Math.ceil(vCount / 520));
  ctx.save();
  ctx.strokeStyle = background.image ? "rgba(0,0,0,.24)" : "rgba(0,0,0,.12)";
  ctx.lineWidth = Math.max(1 / view.zoom, 0.45);
  ctx.beginPath();
  for (let i = uMin; i <= uMax; i += strideU) {
    const from = displacement(surface, i, vMin);
    const to = displacement(surface, i, vMax);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  for (let j = vMin; j <= vMax; j += strideV) {
    const from = displacement(surface, uMin, j);
    const to = displacement(surface, uMax, j);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
  ctx.restore();
}

function transformedObjectPoint(objectPoint, offset) {
  const uv = pointUv(objectPoint, state.surface);
  if (!uv) return null;
  return cellPoint(state.surface, offset, uv);
}

export function drawObject(object, offset = { i: 0, j: 0 }, preview = false) {
  if (!object || !object.points?.length) return;
  const { ctx } = state;
  const points = object.points.map(point => transformedObjectPoint(point, offset)).filter(Boolean);
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = object.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (preview) ctx.globalAlpha = 0.72;

  if (object.type === "dot") {
    ctx.lineWidth = Math.max(1, (object.size || 8) * 0.13);
    const radius = Math.max(0.5, (object.size || 8) / 2);
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (points.length < 2) { ctx.restore(); return; }
  ctx.lineWidth = object.size;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (object.type === "pen" && points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], n = points[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
    }
    const last = points.at(-1);
    ctx.lineTo(last.x, last.y);
  } else {
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawObjectHalo(object, offset, selected) {
  if (!object || !object.points?.length) return;
  const { ctx } = state;
  const points = object.points.map(point => transformedObjectPoint(point, offset)).filter(Boolean);
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = selected ? "rgba(30, 80, 190, 0.42)" : "rgba(30, 30, 30, 0.20)";
  ctx.lineWidth = Math.max((object.size || 1) + (selected ? 9 : 6), 8 / state.view.zoom);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (object.type === "dot") {
    const radius = Math.max(0.5, (object.size || 8) / 2) + (selected ? 5 : 3) / state.view.zoom;
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (points.length < 2) { ctx.restore(); return; }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawHomologyOverlay(offsets) {
  const hover = state.objects.find(object => object.id === state.homHoverId);
  const selected = state.objects.find(object => object.id === state.homSelectedId);
  if (hover && hover !== selected) for (const offset of offsets) drawObjectHalo(hover, offset, false);
  if (!selected) return;

  for (const offset of offsets) drawObjectHalo(selected, offset, true);
  drawHomologyMarkers(selected, state.homSelectedOffset || { i: 0, j: 0 });
  drawHomologyLabel(selected, state.homSelectedOffset || { i: 0, j: 0 });
}

function homologyForObject(object) {
  if (!object || object.points.length < 2) return null;

  const basisPoints = object.points.map(point => worldToBasis(point, state.surface)).filter(Boolean);
  if (basisPoints.length < 2) return null;

  const start = basisPoints[0];
  const end = basisPoints[basisPoints.length - 1];
  const raw = { u: end.u - start.u, v: end.v - start.v };
  const crossings = { u: 0, v: 0 };

  for (let i = 1; i < basisPoints.length; i++) {
    crossings.u += countGridCrossings(basisPoints[i - 1].u, basisPoints[i].u);
    crossings.v += countGridCrossings(basisPoints[i - 1].v, basisPoints[i].v);
  }

  const topo = edgeTopology(state.surface);
  const first = topo.repeatV1 ? String(crossings.u) : "—";
  const second = topo.repeatV2 ? String(crossings.v) : "—";
  const rawFirst = topo.repeatV1 ? raw.u.toFixed(2) : "—";
  const rawSecond = topo.repeatV2 ? raw.v.toFixed(2) : "—";
  return { start, end, raw, crossings, label: `(${first}, ${second})`, rawLabel: `raw Δ: (${rawFirst}, ${rawSecond})` };
}

function countGridCrossings(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 0;
  // Count integer grid lines crossed by the actual path segment. This matches
  // what a human counts visually: boundaries between cells, not rounded endpoint displacement.
  if (b > a) return Math.floor(b) - Math.floor(a);
  return -(Math.floor(a) - Math.floor(b));
}

function drawHomologyMarkers(object, offset) {
  const { ctx } = state;
  const first = transformedObjectPoint(object.points[0], offset);
  const last = transformedObjectPoint(object.points[object.points.length - 1], offset);
  if (!first || !last) return;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.96)";
  ctx.strokeStyle = "rgba(30,80,190,.9)";
  ctx.lineWidth = Math.max(2 / state.view.zoom, 0.8);
  for (const [point, radius] of [[first, 5], [last, 7]]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(radius / state.view.zoom, 2.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawHomologyLabel(object, offset) {
  const hom = homologyForObject(object);
  if (!hom) return;
  setScreenTransform();
  const anchorWorld = transformedObjectPoint(object.points[object.points.length - 1], offset);
  if (!anchorWorld) return;
  const anchor = worldToScreen(anchorWorld, state.view, state.cssWidth, state.cssHeight);
  const { ctx } = state;
  const text = hom.label;
  const topo = edgeTopology(state.surface);
  const first = topo.repeatV1 ? `${hom.crossings.u} × A` : "—";
  const second = topo.repeatV2 ? `${hom.crossings.v} × B` : "—";
  const sub = topo.repeatV1 || topo.repeatV2 ? `${first} · ${second}` : "No linked edges";
  const rawText = hom.rawLabel;
  ctx.save();
  ctx.font = "700 13px Inter, system-ui, sans-serif";
  const w = Math.max(ctx.measureText(text).width, ctx.measureText(sub).width, ctx.measureText(rawText).width) + 24;
  const h = 64;
  const x = Math.min(state.cssWidth - w - 14, Math.max(14, anchor.x + 14));
  const y = Math.min(state.cssHeight - h - 84, Math.max(14, anchor.y - h - 14));
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.strokeStyle = "rgba(0,0,0,.10)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(20,20,20,.92)";
  ctx.fillText(text, x + 12, y + 20);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(92,86,76,.95)";
  ctx.fillText(sub, x + 12, y + 38);
  ctx.fillText(rawText, x + 12, y + 54);
  ctx.restore();
  setWorldTransform();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawHomologyDirectionArrows() {
  if (state.tool !== "hom") return;
  const { ctx, surface, view } = state;
  const size = Math.min(70, Math.max(36, Math.min(length(surface.v1), length(surface.v2)) * 0.16));
  const origin = { x: view.x - state.cssWidth / view.zoom / 2 + 48 / view.zoom, y: view.y + state.cssHeight / view.zoom / 2 - 54 / view.zoom };
  drawArrow(origin, add(origin, scale(surface.v1, size / Math.max(1, length(surface.v1)))), "+v1");
  drawArrow(origin, add(origin, scale(surface.v2, size / Math.max(1, length(surface.v2)))), "+v2");
}

function drawArrow(from, to, label) {
  const { ctx, view } = state;
  ctx.save();
  ctx.strokeStyle = "rgba(30,80,190,.75)";
  ctx.fillStyle = "rgba(30,80,190,.9)";
  ctx.lineWidth = Math.max(1.8 / view.zoom, 0.8);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = 8 / view.zoom;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - Math.cos(angle - 0.55) * head, to.y - Math.sin(angle - 0.55) * head);
  ctx.lineTo(to.x - Math.cos(angle + 0.55) * head, to.y - Math.sin(angle + 0.55) * head);
  ctx.closePath();
  ctx.fill();
  ctx.font = `${Math.max(11 / view.zoom, 5)}px Inter, system-ui, sans-serif`;
  ctx.fillText(label, to.x + 5 / view.zoom, to.y - 5 / view.zoom);
  ctx.restore();
}

export function redraw(preview = state.previewObject) {
  clearScreen();
  setWorldTransform();
  const quality = analyzeSurfaceQuality(state.surface);
  const offsets = visibleOffsets(state);
  const denseMode = quality.dense || offsets.length >= 4000;
  const layers = Array.isArray(state.layers) && state.layers.length ? state.layers : [{ id: "layer-1", type: "drawing", opacity: 1, visible: true }];

  for (const layer of layers) {
    if (layer.visible === false || layer.type !== "image") continue;
    for (const offset of offsets) drawCellImage(offset, layer);
  }

  drawGrid(offsets, denseMode);

  for (const layer of layers) {
    if (layer.visible === false || layer.type !== "drawing") continue;
    state.ctx.save();
    state.ctx.globalAlpha = layer.opacity ?? 1;
    for (const object of state.objects) {
      if ((object.layerId || "layer-1") !== layer.id) continue;
      for (const offset of offsets) drawObject(object, offset);
    }
    state.ctx.restore();
  }

  drawHomologyDirectionArrows();
  drawHomologyOverlay(offsets);
  if (preview) for (const offset of offsets) drawObject(preview, offset, true);
  setScreenTransform();
}
