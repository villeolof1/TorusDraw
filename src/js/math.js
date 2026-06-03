// Small geometry helpers used by the canvas, eraser, repeats, and 3D preview.
export const TAU = Math.PI * 2;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v, amount) => ({ x: v.x * amount, y: v.y * amount });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const length = v => Math.hypot(v.x, v.y);
export const mod1 = value => ((value % 1) + 1) % 1;

// The signed area of the parallelogram. Near zero means v1/v2 are almost parallel.
export function determinant(surface) {
  return surface.v1.x * surface.v2.y - surface.v1.y * surface.v2.x;
}

// Convert world coordinates into the local cell basis: point = u*v1 + v*v2.
export function worldToBasis(point, surface) {
  const det = determinant(surface);
  if (Math.abs(det) < 0.001) return null;
  return {
    u: (point.x * surface.v2.y - point.y * surface.v2.x) / det,
    v: (surface.v1.x * point.y - surface.v1.y * point.x) / det
  };
}

// Convert local cell coordinates back to world coordinates.
export function basisToWorld(uv, surface) {
  return add(scale(surface.v1, uv.u), scale(surface.v2, uv.v));
}

export function displacement(surface, i, j) {
  return add(scale(surface.v1, i), scale(surface.v2, j));
}

export function screenToWorld(point, view, width, height) {
  return {
    x: (point.x - width / 2) / view.zoom + view.x,
    y: (point.y - height / 2) / view.zoom + view.y
  };
}

export function worldToScreen(point, view, width, height) {
  return {
    x: (point.x - view.x) * view.zoom + width / 2,
    y: (point.y - view.y) * view.zoom + height / 2
  };
}

export function viewportWorldCorners(view, width, height) {
  return [
    screenToWorld({ x: 0, y: 0 }, view, width, height),
    screenToWorld({ x: width, y: 0 }, view, width, height),
    screenToWorld({ x: width, y: height }, view, width, height),
    screenToWorld({ x: 0, y: height }, view, width, height)
  ];
}

function rangeFrom(values, padding = 4) {
  return { min: Math.floor(Math.min(...values)) - padding, max: Math.ceil(Math.max(...values)) + padding };
}

// Which repeated copies can possibly touch the viewport. This is why pan can be infinite.
export function visibleOffsets(state) {
  const { surface, view, cssWidth, cssHeight } = state;
  const corners = viewportWorldCorners(view, cssWidth, cssHeight);

  if (!surface.repeatV1 && !surface.repeatV2) return [{ i: 0, j: 0 }];

  if (surface.repeatV1 && surface.repeatV2) {
    const basis = corners.map(p => worldToBasis(p, surface)).filter(Boolean);
    if (basis.length < 4) return [{ i: 0, j: 0 }];
    const ur = rangeFrom(basis.map(p => p.u));
    const vr = rangeFrom(basis.map(p => p.v));
    return collectOffsets(ur.min, ur.max, vr.min, vr.max);
  }

  const vector = surface.repeatV1 ? surface.v1 : surface.v2;
  const vectorLength = Math.max(1, length(vector));
  const unit = scale(vector, 1 / vectorLength);
  const values = corners.map(p => dot(p, unit) / vectorLength);
  const range = rangeFrom(values);
  return surface.repeatV1 ? collectOffsets(range.min, range.max, 0, 0) : collectOffsets(0, 0, range.min, range.max);
}

export function collectOffsets(iStart, iEnd, jStart, jEnd) {
  const offsets = [];
  for (let i = iStart; i <= iEnd; i++) for (let j = jStart; j <= jEnd; j++) offsets.push({ i, j });
  return offsets;
}

export function cloneSurface(surface) {
  return { v1: { ...surface.v1 }, v2: { ...surface.v2 }, repeatV1: !!surface.repeatV1, repeatV2: !!surface.repeatV2 };
}

export function surfacesEqual(a, b) {
  return a.v1.x === b.v1.x && a.v1.y === b.v1.y && a.v2.x === b.v2.x && a.v2.y === b.v2.y && a.repeatV1 === b.repeatV1 && a.repeatV2 === b.repeatV2;
}
