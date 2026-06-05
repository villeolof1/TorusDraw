// Main canvas renderer. The canvas is only a view; objects are stored separately.
import { state } from "./state.js";
import { add, cellPoint, cellTransform, displacement, edgeTopology, length, pointUv, scale, visibleOffsets, viewportWorldCorners, worldToBasis, worldToScreen } from "./math.js";
import { analyzeSurfaceQuality } from "./surfaceQuality.js";
import { getRasterCanvas } from "./rasterStore.js";

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

function transformedLinePoints(object, offset) {
  return (object.points || []).map(point => {
    const base = transformedObjectPoint(point, offset);
    if (!base) return null;
    const next = { ...base };
    if (point.inHandle) next.inHandle = { ...point.inHandle };
    if (point.outHandle) next.outHandle = { ...point.outHandle };
    return next;
  }).filter(Boolean);
}


function rasterFramePoints(object, offset) {
  const pts = object.points || [];
  if (!pts[0]) return null;
  const origin = transformedObjectPoint(pts[0], offset);
  let xCorner = pts[1] ? transformedObjectPoint(pts[1], offset) : null;
  let yCorner = pts[2] ? transformedObjectPoint(pts[2], offset) : null;
  if (!origin || !xCorner) return null;
  if (!yCorner) yCorner = transformedObjectPoint({ x: pts[0].x, y: pts[1].y, u: pts[0].u, v: pts[1].v }, offset);
  if (!yCorner) return null;
  const xAxis = { x: xCorner.x - origin.x, y: xCorner.y - origin.y };
  const yAxis = { x: yCorner.x - origin.x, y: yCorner.y - origin.y };
  return { origin, xCorner, yCorner, xAxis, yAxis, fourth: { x: xCorner.x + yAxis.x, y: xCorner.y + yAxis.y } };
}
function rasterFrameBasePoints(object) {
  const pts = object.points || [];
  if (!pts[0] || !pts[1]) return [];
  const origin = pts[0];
  const xCorner = pts[1];
  const yCorner = pts[2] || { x: pts[0].x, y: pts[1].y, u: pts[0].u, v: pts[1].v };
  const fourth = { x: xCorner.x + (yCorner.x - origin.x), y: xCorner.y + (yCorner.y - origin.y) };
  return [origin, xCorner, fourth, yCorner, origin];
}

function rotatePoint(point, center, angle) {
  if (!angle) return point;
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = point.x - center.x, dy = point.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

function drawShapePath(ctx, object, points) {
  if (object.type === "rectangle") {
    if (points.length < 2) return false;
    const a = points[0], b = points[1];
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    ctx.beginPath();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(object.rotation || 0);
    ctx.rect(-(x1 - x0) / 2, -(y1 - y0) / 2, x1 - x0, y1 - y0);
    ctx.restore();
    return true;
  }
  if (object.type === "ellipse") {
    if (points.length < 2) return false;
    const a = points[0], b = points[1];
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, object.rotation || 0, 0, Math.PI * 2);
    return true;
  }
  return false;
}

function shapeOutlinePoints(object) {
  if (!object.points?.length || (object.type !== "rectangle" && object.type !== "ellipse")) return [];
  const [a, b] = object.points;
  if (!a || !b) return [];
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const angle = object.rotation || 0;
  if (object.type === "rectangle") {
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }].map(point => rotatePoint(point, center, angle));
  }
  const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const points = [];
  for (let i = 0; i <= 144; i++) {
    const t = Math.PI * 2 * i / 144;
    points.push(rotatePoint({ x: center.x + Math.cos(t) * rx, y: center.y + Math.sin(t) * ry }, center, angle));
  }
  return points;
}

function nodeHandlePoint(node, key) {
  const handle = node?.[key];
  return handle ? { x: node.x + handle.dx, y: node.y + handle.dy } : null;
}

function drawLineObjectPath(ctx, points, object) {
  if (points.length < 2) return false;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1], next = points[i];
    const c1 = nodeHandlePoint(prev, "outHandle");
    const c2 = nodeHandlePoint(next, "inHandle");
    if (c1 || c2) ctx.bezierCurveTo(c1?.x ?? prev.x, c1?.y ?? prev.y, c2?.x ?? next.x, c2?.y ?? next.y, next.x, next.y);
    else ctx.lineTo(next.x, next.y);
  }
  return true;
}

function sampleDisplayLinePoints(points, object, segments = 18) {
  if (points.length < 2) return points;
  const out = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const c1 = nodeHandlePoint(a, "outHandle");
    const c2 = nodeHandlePoint(b, "inHandle");
    if (!(c1 || c2)) { out.push({ ...b }); continue; }
    for (let step = 1; step <= segments; step++) {
      const t = step / segments, mt = 1 - t;
      out.push({
        x: mt ** 3 * a.x + 3 * mt ** 2 * t * (c1?.x ?? a.x) + 3 * mt * t ** 2 * (c2?.x ?? b.x) + t ** 3 * b.x,
        y: mt ** 3 * a.y + 3 * mt ** 2 * t * (c1?.y ?? a.y) + 3 * mt * t ** 2 * (c2?.y ?? b.y) + t ** 3 * b.y
      });
    }
  }
  return out;
}

function drawPolyline(ctx, points, object = null) {
  if (points.length < 2) return false;
  if (object?.type === "line") return drawLineObjectPath(ctx, points, object);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  return true;
}

function drawEraseCuts(ctx, object, offset) {
  if (!object.eraseHoles?.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let previous = null;
  for (const hole of object.eraseHoles) {
    const center = transformedObjectPoint(hole, offset);
    if (!center) { previous = null; continue; }
    const radius = Math.max(0.5, hole.radius || 1);
    if (previous) {
      const bridgeWidth = Math.max(radius, previous.radius) * 2;
      const maxBridge = Math.max(radius, previous.radius) * 5.5;
      const dx = center.x - previous.x;
      const dy = center.y - previous.y;
      if (Math.hypot(dx, dy) <= maxBridge) {
        ctx.beginPath();
        ctx.lineWidth = bridgeWidth;
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(center.x, center.y);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    previous = { x: center.x, y: center.y, radius };
  }
  ctx.restore();
}

export function drawObject(object, offset = { i: 0, j: 0 }, preview = false) {
  if (!object || !object.points?.length) return;
  const { ctx } = state;
  const points = object.type === "line" ? transformedLinePoints(object, offset) : object.points.map(point => transformedObjectPoint(point, offset)).filter(Boolean);
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
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2, true);
        ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (object.type === "raster") {
    const frame = rasterFramePoints(object, offset);
    const canvas = getRasterCanvas(object, requestRender);
    if (frame && canvas) {
      ctx.transform(frame.xAxis.x, frame.xAxis.y, frame.yAxis.x, frame.yAxis.y, frame.origin.x, frame.origin.y);
      ctx.drawImage(canvas, 0, 0, 1, 1);
    }
    ctx.restore();
    return;
  }

  if (object.type === "rectangle" || object.type === "ellipse") {
    ctx.lineWidth = object.size;
    ctx.fillStyle = object.fillColor || object.color;
    const mode = object.shapeMode || "outline";
    if (drawShapePath(ctx, object, points)) {
      if (mode === "fill") {
        ctx.fill();
        drawEraseCuts(ctx, object, offset);
      } else ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (object.type === "polygon") {
    ctx.lineWidth = object.size;
    ctx.fillStyle = object.fillColor || object.color;
    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      if ((object.shapeMode || "outline") === "fill") {
        ctx.fill();
        drawEraseCuts(ctx, object, offset);
      } else ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (points.length < 2) { ctx.restore(); return; }
  ctx.lineWidth = object.size;
  if (object.type === "pen" && points.length > 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], n = points[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
    }
    const last = points.at(-1);
    ctx.lineTo(last.x, last.y);
  } else {
    drawPolyline(ctx, points, object);
  }
  ctx.stroke();
  ctx.restore();
}

function drawObjectHalo(object, offset, selected) {
  if (!object || !object.points?.length) return;
  const { ctx } = state;
  const points = object.type === "line" ? transformedLinePoints(object, offset) : object.points.map(point => transformedObjectPoint(point, offset)).filter(Boolean);
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
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2, true);
        ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (object.type === "raster") {
    const frame = rasterFramePoints(object, offset);
    if (frame) {
      const outline = [frame.origin, frame.xCorner, frame.fourth, frame.yCorner, frame.origin];
      if (drawPolyline(ctx, outline, object)) ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (object.type === "rectangle" || object.type === "ellipse") {
    const outline = shapeOutlinePoints(object).map(point => transformedObjectPoint(point, offset)).filter(Boolean);
    if (drawPolyline(ctx, outline, object)) ctx.stroke();
    ctx.restore();
    return;
  }
  if (object.type === "polygon") {
    const outline = [...object.points, object.points[0]].map(point => transformedObjectPoint(point, offset)).filter(Boolean);
    if (drawPolyline(ctx, outline, object)) ctx.stroke();
    ctx.restore();
    return;
  }
  if (points.length < 2) { ctx.restore(); return; }
  if (object.type === "line") drawPolyline(ctx, points, object);
  else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  }
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

function drawSelectionOverlay(offsets) {
  if (state.tool !== "select") return;
  const selectedIds = state.selectedObjectIds?.length ? state.selectedObjectIds : (state.selectedObjectId != null ? [state.selectedObjectId] : []);
  const selected = state.objects.filter(object => selectedIds.includes(object.id));
  for (const offset of offsets) {
    for (const object of selected) drawObjectHalo(object, offset, true);
    if (selected.length) drawSelectionHandles(selected, offset);
  }
  // The marquee rectangle must be visible while dragging even before any
  // object has actually been selected/released.
  drawSelectionMarquee();
}

function objectDisplayBounds(object, offset) {
  const sourcePoints = object.type === "line" ? sampleDisplayLinePoints(object.points, object, 18) : (object.type === "rectangle" || object.type === "ellipse" ? shapeOutlinePoints(object) : (object.type === "raster" ? rasterFrameBasePoints(object) : object.points));
  const points = sourcePoints.map(point => transformedObjectPoint(point, offset)).filter(Boolean);
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { points, minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function dotRadiusForRender(object) { return Math.max(0.5, (object?.size || 20) / 2); }
function shapeBoxHandlePoints(object, offset) {
  if (!object || (object.type !== "rectangle" && object.type !== "ellipse") || object.points.length < 2) return null;
  const [a, b] = object.points;
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const width = x1 - x0, height = y1 - y0;
  const angle = object.rotation || 0;
  const names = {
    nw: [-width / 2, -height / 2], n: [0, -height / 2], ne: [width / 2, -height / 2],
    e: [width / 2, 0], se: [width / 2, height / 2], s: [0, height / 2],
    sw: [-width / 2, height / 2], w: [-width / 2, 0]
  };
  const out = {};
  for (const [name, [dx, dy]] of Object.entries(names)) out[name] = transformedObjectPoint(rotatePoint({ x: center.x + dx, y: center.y + dy }, center, angle), offset);
  out.center = transformedObjectPoint(center, offset);
  out.rotate = transformedObjectPoint(rotatePoint({ x: center.x, y: center.y - height / 2 - 34 / state.view.zoom }, center, angle), offset);
  return out;
}

function genericBoxHandlePoints(object, offset) {
  if (!object || object.type === "dot" || !["pen", "line", "polygon", "raster"].includes(object.type)) return null;
  const sourcePoints = object.type === "line" ? sampleDisplayLinePoints(object.points, object, 18) : (object.type === "polygon" ? [...object.points, object.points[0]] : (object.type === "raster" ? rasterFrameBasePoints(object) : object.points));
  const samples = sourcePoints.map(point => transformedObjectPoint(point, offset)).filter(Boolean);
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
    const local = rotatePoint(point, center, -angle);
    minX = Math.min(minX, local.x); minY = Math.min(minY, local.y);
    maxX = Math.max(maxX, local.x); maxY = Math.max(maxY, local.y);
  }
  const localCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const names = {
    nw: [minX, minY], n: [localCenter.x, minY], ne: [maxX, minY], e: [maxX, localCenter.y],
    se: [maxX, maxY], s: [localCenter.x, maxY], sw: [minX, maxY], w: [minX, localCenter.y]
  };
  const out = {};
  for (const [name, [x, y]] of Object.entries(names)) out[name] = rotatePoint({ x, y }, center, angle);
  out.center = rotatePoint(localCenter, center, angle);
  out.rotate = rotatePoint({ x: localCenter.x, y: minY - 34 / state.view.zoom }, center, angle);
  return out;
}

function drawSelectionHandles(objects, offset) {
  const { ctx } = state;
  const handle = Math.max(5.8 / state.view.zoom, 3.4);
  const activeFill = "rgba(30,80,190,.95)";
  const inactiveFill = "rgba(255,255,255,.96)";
  const stroke = "rgba(30,80,190,.95)";

  function drawDotHandle(point, active = false, scale = 1) {
    ctx.fillStyle = active ? activeFill : inactiveFill;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.arc(point.x, point.y, handle * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (state.selectMode === "points") {
    if (objects.length !== 1) return;
    const object = objects[0];
    ctx.save();
    ctx.strokeStyle = "rgba(30,80,190,.78)";
    ctx.fillStyle = inactiveFill;
    ctx.lineWidth = Math.max(1.2 / state.view.zoom, 0.7);

    if (object.type === "line") {
      const selectedIndex = state.selectedNodeIndex;
      for (let i = 0; i < object.points.length; i++) {
        const p = transformedObjectPoint(object.points[i], offset);
        if (!p) continue;
        const inHandle = nodeHandlePoint(object.points[i], "inHandle");
        const outHandle = nodeHandlePoint(object.points[i], "outHandle");
        for (const [handlePoint, kind] of [[inHandle, "inHandle"], [outHandle, "outHandle"]]) {
          const hp = handlePoint ? transformedObjectPoint(handlePoint, offset) : null;
          if (!hp) continue;
          const active = i === selectedIndex && state.selectedHandleKind === kind;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hp.x, hp.y); ctx.strokeStyle = "rgba(30,80,190,.45)"; ctx.stroke();
          drawDotHandle(hp, active, active ? 1.15 : 0.85);
        }
        const nodeActive = i === selectedIndex && (!state.selectedHandleKind || state.selectedHandleKind === "node" || state.selectedHandleKind === "shapeNode");
        drawDotHandle(p, nodeActive, nodeActive ? 1.25 : 1);
      }
      ctx.restore();
      return;
    }

    if (object.type === "polygon") {
      const pts = object.points.map(point => transformedObjectPoint(point, offset)).filter(Boolean);
      if (pts.length) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.strokeStyle = "rgba(30,80,190,.45)";
        ctx.stroke();
      }
      for (let i = 0; i < object.points.length; i++) {
        const p = transformedObjectPoint(object.points[i], offset);
        if (p) drawDotHandle(p, i === state.selectedNodeIndex, i === state.selectedNodeIndex ? 1.25 : 1);
      }
      ctx.restore();
      return;
    }

    if (object.type === "rectangle") {
      const corners = shapeOutlinePoints(object).slice(0, 4).map(point => transformedObjectPoint(point, offset)).filter(Boolean);
      if (corners.length) {
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.strokeStyle = "rgba(30,80,190,.45)";
        ctx.stroke();
      }
      for (let i = 0; i < corners.length; i++) drawDotHandle(corners[i], i === state.selectedNodeIndex, i === state.selectedNodeIndex ? 1.25 : 1);
      ctx.restore();
      return;
    }

    ctx.restore();
    return;
  }

  if (objects.length === 1 && objects[0].type === "line") {
    const object = objects[0];
    ctx.save();
    ctx.lineWidth = Math.max(1.2 / state.view.zoom, 0.7);
    ctx.strokeStyle = stroke;
    ctx.fillStyle = inactiveFill;
    const first = transformedObjectPoint(object.points[0], offset);
    const last = transformedObjectPoint(object.points.at(-1), offset);
    if (first) drawDotHandle(first, false, 1);
    if (last) drawDotHandle(last, false, 1);
    const lineBox = genericBoxHandlePoints(object, offset);
    if (lineBox?.rotate) {
      const top = lineBox.n;
      ctx.strokeStyle = "rgba(30,80,190,.55)";
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(lineBox.rotate.x, lineBox.rotate.y); ctx.stroke();
      drawDotHandle(lineBox.rotate, state.selectedHandleKind === "rotate", 1);
    }
    ctx.restore();
    return;
  }

  if (objects.length === 1 && objects[0].type === "dot") {
    const object = objects[0];
    const center = transformedObjectPoint(object.points[0], offset);
    if (!center) return;
    const rWorld = dotRadiusForRender(object);
    const resize = transformedObjectPoint({ x: object.points[0].x + rWorld, y: object.points[0].y }, offset);
    ctx.save();
    ctx.strokeStyle = "rgba(30,80,190,.78)";
    ctx.lineWidth = Math.max(1.2 / state.view.zoom, 0.6);
    ctx.beginPath(); ctx.arc(center.x, center.y, rWorld, 0, Math.PI * 2); ctx.stroke();
    if (resize) drawDotHandle(resize, state.selectedHandleKind === "dotResize", state.selectedHandleKind === "dotResize" ? 1.2 : 1);
    ctx.restore();
    return;
  }

  if (objects.length === 1 && (objects[0].type === "pen" || objects[0].type === "polygon" || objects[0].type === "raster")) {
    const handles = genericBoxHandlePoints(objects[0], offset);
    if (!handles) return;
    ctx.save();
    ctx.strokeStyle = "rgba(30,80,190,.78)";
    ctx.lineWidth = Math.max(1.2 / state.view.zoom, 0.6);
    ctx.beginPath();
    ctx.moveTo(handles.nw.x, handles.nw.y); ctx.lineTo(handles.ne.x, handles.ne.y); ctx.lineTo(handles.se.x, handles.se.y); ctx.lineTo(handles.sw.x, handles.sw.y); ctx.closePath(); ctx.stroke();
    for (const name of ["nw","n","ne","e","se","s","sw","w"]) drawDotHandle(handles[name], state.selectedHandleKind === "bbox", 1);
    ctx.beginPath(); ctx.moveTo(handles.n.x, handles.n.y); ctx.lineTo(handles.rotate.x, handles.rotate.y); ctx.stroke();
    drawDotHandle(handles.rotate, state.selectedHandleKind === "rotate", 1);
    ctx.restore();
    return;
  }

  if (objects.length === 1 && (objects[0].type === "rectangle" || objects[0].type === "ellipse")) {
    const handles = shapeBoxHandlePoints(objects[0], offset);
    if (!handles) return;
    ctx.save();
    ctx.strokeStyle = "rgba(30,80,190,.78)";
    ctx.lineWidth = Math.max(1.2 / state.view.zoom, 0.6);
    ctx.beginPath();
    ctx.moveTo(handles.nw.x, handles.nw.y); ctx.lineTo(handles.ne.x, handles.ne.y); ctx.lineTo(handles.se.x, handles.se.y); ctx.lineTo(handles.sw.x, handles.sw.y); ctx.closePath(); ctx.stroke();
    for (const name of ["nw","n","ne","e","se","s","sw","w"]) drawDotHandle(handles[name], state.selectedHandleKind === "bbox", 1);
    ctx.beginPath(); ctx.moveTo(handles.n.x, handles.n.y); ctx.lineTo(handles.rotate.x, handles.rotate.y); ctx.stroke();
    drawDotHandle(handles.rotate, state.selectedHandleKind === "rotate", 1);
    ctx.restore();
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const object of objects) {
    const bounds = objectDisplayBounds(object, offset);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.minX); minY = Math.min(minY, bounds.minY); maxX = Math.max(maxX, bounds.maxX); maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX)) return;
  const pad = 8 / state.view.zoom;
  let cx, cy, halfW, halfH, angle;
  if (state.selectionGroupFrame && objects.length > 1) {
    const frame = state.selectionGroupFrame;
    const baseCenter = transformedObjectPoint({ x: frame.cx, y: frame.cy }, offset) || { x: frame.cx, y: frame.cy };
    cx = baseCenter.x; cy = baseCenter.y;
    halfW = frame.width / 2 + pad;
    halfH = frame.height / 2 + pad;
    angle = frame.rotation || 0;
  } else {
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    cx = (minX + maxX) / 2; cy = (minY + maxY) / 2;
    halfW = (maxX - minX) / 2; halfH = (maxY - minY) / 2;
    angle = state.selectionGroupRotation || 0;
  }
  const center = { x: cx, y: cy };
  const handles = {
    nw: rotatePoint({ x: cx - halfW, y: cy - halfH }, center, angle),
    n: rotatePoint({ x: cx, y: cy - halfH }, center, angle),
    ne: rotatePoint({ x: cx + halfW, y: cy - halfH }, center, angle),
    e: rotatePoint({ x: cx + halfW, y: cy }, center, angle),
    se: rotatePoint({ x: cx + halfW, y: cy + halfH }, center, angle),
    s: rotatePoint({ x: cx, y: cy + halfH }, center, angle),
    sw: rotatePoint({ x: cx - halfW, y: cy + halfH }, center, angle),
    w: rotatePoint({ x: cx - halfW, y: cy }, center, angle)
  };
  handles.rotate = rotatePoint({ x: cx, y: cy - halfH - 26 / state.view.zoom }, center, angle);
  ctx.save();
  ctx.strokeStyle = "rgba(30,80,190,.78)";
  ctx.fillStyle = inactiveFill;
  ctx.lineWidth = Math.max(1.2 / state.view.zoom, 0.6);
  ctx.setLineDash([6 / state.view.zoom, 5 / state.view.zoom]);
  ctx.beginPath();
  ctx.moveTo(handles.nw.x, handles.nw.y); ctx.lineTo(handles.ne.x, handles.ne.y); ctx.lineTo(handles.se.x, handles.se.y); ctx.lineTo(handles.sw.x, handles.sw.y); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  for (const name of ["nw","n","ne","e","se","s","sw","w"]) drawDotHandle(handles[name], state.selectedHandleKind === "bbox", 1);
  if (objects.some(object => object.type !== "dot")) {
    ctx.beginPath(); ctx.moveTo(handles.n.x, handles.n.y); ctx.lineTo(handles.rotate.x, handles.rotate.y); ctx.stroke();
    drawDotHandle(handles.rotate, state.selectedHandleKind === "rotate", 1);
  }
  ctx.restore();
}

function drawSelectionMarquee() {
  const box = state.selectionBox;
  if (!box) return;
  const { ctx } = state;
  ctx.save();
  ctx.fillStyle = "rgba(30,80,190,.08)";
  ctx.strokeStyle = "rgba(30,80,190,.55)";
  ctx.lineWidth = Math.max(1 / state.view.zoom, 0.6);
  ctx.setLineDash([6 / state.view.zoom, 5 / state.view.zoom]);
  ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  ctx.restore();
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
  drawSelectionOverlay(offsets);
  if (preview) for (const offset of offsets) drawObject(preview, offset, true);
  setScreenTransform();
}
