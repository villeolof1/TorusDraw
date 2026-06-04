// The coordinate-domain model for the 3D preview.
// It treats the single fundamental cell as the source of truth: every 3D
// surface point must come from a valid (u, v) coordinate inside this cell.
import { basisToWorld, clamp, edgeTopology, mod1, worldToBasis } from "./math.js";

const EPS = 1e-6;

export function createSurfaceDomain(surface) {
  const topo = edgeTopology(surface);
  const classification = classifyTopology(topo);

  return {
    surface,
    topology: topo,
    type: classification.type,
    typeLabel: classification.label,
    representation: classification.representation,
    linkedPairCount: classification.linkedPairCount,
    reverseCount: classification.reverseCount,
    reversedPair: classification.reversedPair,
    preservedPair: classification.preservedPair,
    worldToCell(point) {
      if (point && Number.isFinite(point.u) && Number.isFinite(point.v)) return { u: point.u, v: point.v };
      return worldToBasis(point, surface);
    },
    cellToWorld(uv) {
      return basisToWorld(uv, surface);
    },
    isInsideCell(uv, pad = EPS) {
      return uv && uv.u >= -pad && uv.u <= 1 + pad && uv.v >= -pad && uv.v <= 1 + pad;
    },
    isLinked(edge) {
      if (edge === "left" || edge === "right") return topo.repeatV1;
      if (edge === "bottom" || edge === "top") return topo.repeatV2;
      return false;
    },
    transitionAcrossEdge(edge, uv) {
      return transitionAcrossEdge(uv, edge, topo);
    },
    normalizeUV(uv) {
      return normalizeUV(uv, topo);
    },
    splitSegmentByGluing(a, b) {
      return splitSegmentByGluing(a, b, topo, classification.type);
    },
    splitPolylineByGluing(points) {
      return splitPolylineByGluing(points, topo, classification.type);
    },
    classify() {
      return classification.type;
    }
  };
}

function classifyTopology(topo) {
  const linkedA = topo.repeatV1;
  const linkedB = topo.repeatV2;
  const reversedA = linkedA && topo.flipV;
  const reversedB = linkedB && topo.flipU;
  const linkedPairCount = Number(linkedA) + Number(linkedB);
  const reverseCount = Number(reversedA) + Number(reversedB);
  const reversedPair = reversedA && !reversedB ? "v1" : reversedB && !reversedA ? "v2" : reverseCount === 2 ? "both" : null;
  const preservedPair = linkedA && !reversedA ? "v1" : linkedB && !reversedB ? "v2" : null;

  if (!linkedA && !linkedB) return { type: "plane", label: "Plane", representation: "embedding", linkedPairCount, reverseCount, reversedPair, preservedPair };
  if (linkedPairCount === 1) {
    const type = reverseCount === 1 ? "mobius" : "cylinder";
    return { type, label: type === "mobius" ? "Möbius" : "Cylinder", representation: "embedding", linkedPairCount, reverseCount, reversedPair, preservedPair };
  }
  if (reverseCount === 0) return { type: "torus", label: "Torus", representation: "embedding", linkedPairCount, reverseCount, reversedPair, preservedPair };
  if (reverseCount === 1) return { type: "klein", label: "Klein immersion", representation: "immersion", linkedPairCount, reverseCount, reversedPair, preservedPair };
  return { type: "double-reversed", label: "Double-reversed", representation: "immersion", linkedPairCount, reverseCount, reversedPair, preservedPair };
}

function transitionAcrossEdge(uv, edge, topo) {
  let { u, v } = uv;
  if ((edge === "left" || edge === "right") && topo.repeatV1) {
    u = edge === "right" ? u - 1 : u + 1;
    if (topo.flipV) v = 1 - v;
  }
  if ((edge === "top" || edge === "bottom") && topo.repeatV2) {
    v = edge === "top" ? v - 1 : v + 1;
    if (topo.flipU) u = 1 - u;
  }
  return { u, v };
}

function normalizeUV(uv, topo) {
  if (!uv || !Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return null;
  const iu = topo.repeatV1 ? Math.floor(uv.u) : 0;
  const iv = topo.repeatV2 ? Math.floor(uv.v) : 0;
  let u = topo.repeatV1 ? uv.u - iu : uv.u;
  let v = topo.repeatV2 ? uv.v - iv : uv.v;

  // A left/right reversed identification flips the transverse v-coordinate
  // every other copied cell. A top/bottom reversed identification flips u.
  if (topo.repeatV1 && topo.flipV && Math.abs(iu) % 2 === 1) v = 1 - v;
  if (topo.repeatV2 && topo.flipU && Math.abs(iv) % 2 === 1) u = 1 - u;

  return { u: clamp(u, 0, 1), v: clamp(v, 0, 1) };
}

function splitPolylineByGluing(points, topo, type) {
  const paths = [];
  let current = [];
  const finish = () => {
    if (current.length > 1) paths.push(current);
    current = [];
  };

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!validUV(a) || !validUV(b)) {
      finish();
      continue;
    }

    for (const piece of splitSegmentByGluing(a, b, topo, type)) {
      const samples = samplePiece(piece[0], piece[1]);
      if (samples.length < 2) continue;
      const first = samples[0];
      const last = current[current.length - 1];
      if (!last || distanceUV(last, first) > 0.035) finish();
      if (!current.length) current.push(first);
      for (let j = 1; j < samples.length; j++) current.push(samples[j]);
    }
  }
  finish();
  return paths;
}

function splitSegmentByGluing(a, b, topo, type) {
  const cuts = collectBoundaryCuts(a, b, topo, type);
  const pieces = [];

  for (let i = 1; i < cuts.length; i++) {
    const t0 = cuts[i - 1];
    const t1 = cuts[i];
    if (t1 - t0 < EPS) continue;

    const mid = lerpUV(a, b, (t0 + t1) / 2);
    if (!visibleLiftedUV(mid, topo, type)) continue;

    // Nudge interior boundary endpoints slightly inside their local piece so
    // the paired side renders as a new piece instead of one chord through 3D.
    const p0 = lerpUV(a, b, t0 === 0 ? t0 : t0 + EPS);
    const p1 = lerpUV(a, b, t1 === 1 ? t1 : t1 - EPS);
    const c0 = normalizeUV(p0, topo);
    const c1 = normalizeUV(p1, topo);
    if (!c0 || !c1) continue;

    // Do not draw a long local jump introduced by a seam. The following piece
    // continues from the glued side.
    const seamCut = t0 > EPS || t1 < 1 - EPS;
    if (seamCut && distanceUV(c0, c1) > 0.82) continue;
    pieces.push([c0, c1]);
  }
  return pieces;
}

function collectBoundaryCuts(a, b, topo, type) {
  const cuts = [0, 1];
  addAxisCuts(cuts, a.u, b.u, topo.repeatV1 || axisIsOpen("u", topo, type));
  addAxisCuts(cuts, a.v, b.v, topo.repeatV2 || axisIsOpen("v", topo, type));
  cuts.sort((x, y) => x - y);
  return cuts.filter((t, i) => t >= -EPS && t <= 1 + EPS && (i === 0 || Math.abs(t - cuts[i - 1]) > EPS));
}

function axisIsOpen(axis, topo, type) {
  if (type === "torus" || type === "klein" || type === "double-reversed") return false;
  return axis === "u" ? !topo.repeatV1 : !topo.repeatV2;
}

function addAxisCuts(cuts, start, end, active) {
  if (!active || !Number.isFinite(start) || !Number.isFinite(end) || Math.abs(end - start) < EPS) return;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  for (let boundary = Math.ceil(lo + EPS); boundary <= Math.floor(hi - EPS); boundary++) {
    cuts.push((boundary - start) / (end - start));
  }
  if (lo < 0 && hi > 0) cuts.push((0 - start) / (end - start));
  if (lo < 1 && hi > 1) cuts.push((1 - start) / (end - start));
}

function visibleLiftedUV(uv, topo, type) {
  if (type === "torus" || type === "klein" || type === "double-reversed") return true;
  if (type === "plane") return uv.u >= -EPS && uv.u <= 1 + EPS && uv.v >= -EPS && uv.v <= 1 + EPS;
  if (topo.repeatV1) return uv.v >= -EPS && uv.v <= 1 + EPS;
  if (topo.repeatV2) return uv.u >= -EPS && uv.u <= 1 + EPS;
  return true;
}

function samplePiece(a, b) {
  const steps = Math.max(2, Math.min(96, Math.ceil(Math.max(Math.abs(b.u - a.u), Math.abs(b.v - a.v)) * 260)));
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const p = lerpUV(a, b, i / steps);
    samples.push({ u: clamp(p.u, 0, 1), v: clamp(p.v, 0, 1) });
  }
  return samples;
}

function validUV(uv) { return uv && Number.isFinite(uv.u) && Number.isFinite(uv.v); }
function lerpUV(a, b, t) { return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t }; }
function distanceUV(a, b) { return Math.hypot(a.u - b.u, a.v - b.v); }
