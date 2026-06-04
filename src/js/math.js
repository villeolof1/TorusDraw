// Small geometry helpers used by the canvas, eraser, repeats, and 3D preview.
export const TAU = Math.PI * 2;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v, amount) => ({ x: v.x * amount, y: v.y * amount });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const length = v => Math.hypot(v.x, v.y);
export const mod1 = value => ((value % 1) + 1) % 1;
const MAX_VISIBLE_OFFSETS = 4200;

export function defaultEdgeLinks() {
  return {
    v1: { active: true, label: "A", edges: ["left", "right"], direction: { left: 1, right: 1 } },
    v2: { active: true, label: "B", edges: ["bottom", "top"], direction: { bottom: 1, top: 1 } }
  };
}

export function normalizeEdgeLinks(links = null, surface = null) {
  const next = defaultEdgeLinks();
  if (surface && "repeatV1" in surface) next.v1.active = !!surface.repeatV1;
  if (surface && "repeatV2" in surface) next.v2.active = !!surface.repeatV2;
  if (links?.v1) next.v1 = { ...next.v1, ...links.v1, direction: { ...next.v1.direction, ...(links.v1.direction || {}) } };
  if (links?.v2) next.v2 = { ...next.v2, ...links.v2, direction: { ...next.v2.direction, ...(links.v2.direction || {}) } };
  next.v1.active = !!next.v1.active;
  next.v2.active = !!next.v2.active;
  next.v1.direction.left = next.v1.direction.left === -1 ? -1 : 1;
  next.v1.direction.right = next.v1.direction.right === -1 ? -1 : 1;
  next.v2.direction.bottom = next.v2.direction.bottom === -1 ? -1 : 1;
  next.v2.direction.top = next.v2.direction.top === -1 ? -1 : 1;
  return next;
}

export function edgeTopology(surface) {
  const links = normalizeEdgeLinks(surface.edgeLinks, surface);
  return {
    links,
    repeatV1: links.v1.active,
    repeatV2: links.v2.active,
    flipV: links.v1.active && links.v1.direction.left !== links.v1.direction.right,
    flipU: links.v2.active && links.v2.direction.bottom !== links.v2.direction.top
  };
}

// The signed area of the parallelogram. Near zero means v1/v2 are almost parallel.
export function determinant(surface) {
  return surface.v1.x * surface.v2.y - surface.v1.y * surface.v2.x;
}

export function worldToBasis(point, surface) {
  const det = determinant(surface);
  if (Math.abs(det) < 0.001) return null;
  return {
    u: (point.x * surface.v2.y - point.y * surface.v2.x) / det,
    v: (surface.v1.x * point.y - surface.v1.y * point.x) / det
  };
}

export function basisToWorld(uv, surface) { return add(scale(surface.v1, uv.u), scale(surface.v2, uv.v)); }
export function displacement(surface, i, j) { return add(scale(surface.v1, i), scale(surface.v2, j)); }

export function cellTransform(surface, i, j) {
  const topo = edgeTopology(surface);
  const flipU = topo.flipU && Math.abs(j) % 2 === 1;
  const flipV = topo.flipV && Math.abs(i) % 2 === 1;
  let origin = displacement(surface, i, j);
  let e1 = { ...surface.v1 };
  let e2 = { ...surface.v2 };
  if (flipU) { origin = add(origin, surface.v1); e1 = scale(surface.v1, -1); }
  if (flipV) { origin = add(origin, surface.v2); e2 = scale(surface.v2, -1); }
  return { origin, e1, e2, flipU, flipV, i, j };
}

export function cellPoint(surface, offset, uv) {
  const c = cellTransform(surface, offset.i, offset.j);
  return add(add(c.origin, scale(c.e1, uv.u)), scale(c.e2, uv.v));
}

export function worldToBaseFromCell(point, surface, offset) {
  const c = cellTransform(surface, offset.i, offset.j);
  const rel = sub(point, c.origin);
  const det = c.e1.x * c.e2.y - c.e1.y * c.e2.x;
  if (Math.abs(det) < 0.001) return null;
  const uv = {
    u: (rel.x * c.e2.y - rel.y * c.e2.x) / det,
    v: (c.e1.x * rel.y - c.e1.y * rel.x) / det
  };
  return basisToWorld(uv, surface);
}

export function screenToWorld(point, view, width, height) {
  return { x: (point.x - width / 2) / view.zoom + view.x, y: (point.y - height / 2) / view.zoom + view.y };
}
export function worldToScreen(point, view, width, height) {
  return { x: (point.x - view.x) * view.zoom + width / 2, y: (point.y - view.y) * view.zoom + height / 2 };
}
export function viewportWorldCorners(view, width, height) {
  return [screenToWorld({ x: 0, y: 0 }, view, width, height), screenToWorld({ x: width, y: 0 }, view, width, height), screenToWorld({ x: width, y: height }, view, width, height), screenToWorld({ x: 0, y: height }, view, width, height)];
}

function rangeFrom(values, padding = 4) { return { min: Math.floor(Math.min(...values)) - padding, max: Math.ceil(Math.max(...values)) + padding }; }

export function visibleOffsets(state) {
  const { surface, view, cssWidth, cssHeight } = state;
  const topo = edgeTopology(surface);
  const corners = viewportWorldCorners(view, cssWidth, cssHeight);
  if (!topo.repeatV1 && !topo.repeatV2) return [{ i: 0, j: 0 }];
  if (topo.repeatV1 && topo.repeatV2) {
    const basis = corners.map(p => worldToBasis(p, surface)).filter(Boolean);
    if (basis.length < 4) return [{ i: 0, j: 0 }];
    const ur = rangeFrom(basis.map(p => p.u));
    const vr = rangeFrom(basis.map(p => p.v));
    return collectOffsets(ur.min, ur.max, vr.min, vr.max);
  }
  const vector = topo.repeatV1 ? surface.v1 : surface.v2;
  const vectorLength = Math.max(1, length(vector));
  const unit = scale(vector, 1 / vectorLength);
  const values = corners.map(p => dot(p, unit) / vectorLength);
  const range = rangeFrom(values);
  return topo.repeatV1 ? collectOffsets(range.min, range.max, 0, 0) : collectOffsets(0, 0, range.min, range.max);
}

function trimRangeAroundCenter(start, end, maxCount) {
  const count = Math.max(0, end - start + 1);
  if (count <= maxCount) return { start, end };
  const center = (start + end) / 2;
  const half = Math.floor((maxCount - 1) / 2);
  return { start: Math.round(center) - half, end: Math.round(center) - half + maxCount - 1 };
}

export function collectOffsets(iStart, iEnd, jStart, jEnd) {
  let width = Math.max(0, iEnd - iStart + 1);
  let height = Math.max(0, jEnd - jStart + 1);
  const total = width * height;
  if (total > MAX_VISIBLE_OFFSETS) {
    const ratio = width / Math.max(1, height);
    const targetWidth = Math.max(1, Math.floor(Math.sqrt(MAX_VISIBLE_OFFSETS * ratio)));
    const targetHeight = Math.max(1, Math.floor(MAX_VISIBLE_OFFSETS / targetWidth));
    const iRange = trimRangeAroundCenter(iStart, iEnd, Math.min(width, targetWidth));
    const jRange = trimRangeAroundCenter(jStart, jEnd, Math.min(height, targetHeight));
    iStart = iRange.start; iEnd = iRange.end; jStart = jRange.start; jEnd = jRange.end;
  }
  const offsets = [];
  for (let i = iStart; i <= iEnd; i++) for (let j = jStart; j <= jEnd; j++) offsets.push({ i, j });
  return offsets;
}

export function pointUv(point, surface) {
  if (Number.isFinite(point.u) && Number.isFinite(point.v)) return { u: point.u, v: point.v };
  return worldToBasis(point, surface);
}

export function metricDistanceBetweenUv(a, b, surface) {
  const du = a.u - b.u;
  const dv = a.v - b.v;
  const g11 = dot(surface.v1, surface.v1);
  const g12 = dot(surface.v1, surface.v2);
  const g22 = dot(surface.v2, surface.v2);
  return Math.sqrt(Math.max(0, du * du * g11 + 2 * du * dv * g12 + dv * dv * g22));
}

export function cloneSurface(surface) {
  const links = normalizeEdgeLinks(surface.edgeLinks, surface);
  const topo = edgeTopology({ ...surface, edgeLinks: links });
  return { v1: { ...surface.v1 }, v2: { ...surface.v2 }, repeatV1: topo.repeatV1, repeatV2: topo.repeatV2, edgeLinks: links };
}

export function surfacesEqual(a, b) {
  return a.v1.x === b.v1.x && a.v1.y === b.v1.y && a.v2.x === b.v2.x && a.v2.y === b.v2.y;
}
