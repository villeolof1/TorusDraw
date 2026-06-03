// 3D coordinate maps for the fundamental cell.
// Every rendered vertex is generated from one valid cell coordinate (u, v).
import { TAU, clamp, determinant, dot, length } from "./math.js";

export function createSurfaceMap(domain) {
  const metric = cellMetric(domain.surface);
  const base = { domain, metric, type: domain.classify(), typeLabel: domain.typeLabel, representation: domain.representation, isValidUV, textureUV: (u, v) => ({ u, v }) };
  if (base.type === "plane") return withNormal({ ...base, ...createPlaneMap(metric) });
  if (base.type === "cylinder") return withNormal({ ...base, ...createCylinderMap(domain, metric) });
  if (base.type === "torus") return withNormal({ ...base, ...createTorusMap(domain, metric) });
  if (base.type === "mobius") return withNormal({ ...base, ...createMobiusMap(domain, metric) });
  if (base.type === "klein") return withNormal({ ...base, ...createKleinMap(domain, metric) });
  return withNormal({ ...base, ...createDoubleReversedInspectionMap(domain, metric) });
}

function cellMetric(surface) {
  const lenU = Math.max(1, length(surface.v1));
  const lenV = Math.max(1, length(surface.v2));
  const area = Math.max(1, Math.abs(determinant(surface)));
  const heightVOverU = area / lenU;
  const heightUOverV = area / lenV;
  const skewVAlongU = clamp(dot(surface.v2, surface.v1) / Math.max(1, lenU * lenU), -1.15, 1.15);
  const skewUAlongV = clamp(dot(surface.v1, surface.v2) / Math.max(1, lenV * lenV), -1.15, 1.15);
  return { surface, lenU, lenV, area, heightVOverU, heightUOverV, skewVAlongU, skewUAlongV };
}

function isValidUV(u, v) {
  return Number.isFinite(u) && Number.isFinite(v) && u >= -0.000001 && u <= 1.000001 && v >= -0.000001 && v <= 1.000001;
}

function createPlaneMap(metric) {
  const { surface } = metric;
  const pts = [
    [0, 0, 0],
    [surface.v1.x, -surface.v1.y, 0],
    [surface.v2.x, -surface.v2.y, 0],
    [surface.v1.x + surface.v2.x, -(surface.v1.y + surface.v2.y), 0]
  ];
  const center = average3(pts);
  const maxDistance = Math.max(1, ...pts.map(p => len3(sub3(p, center))));
  const s = 1.8 / maxDistance;
  return {
    point(u, v) {
      return [
        ((surface.v1.x * u + surface.v2.x * v) - center[0]) * s,
        (-(surface.v1.y * u + surface.v2.y * v) - center[1]) * s,
        0
      ];
    },
    worldToModelScale: s
  };
}

function createCylinderMap(domain, metric) {
  const repeatU = domain.topology.repeatV1;
  const repeatLength = repeatU ? metric.lenU : metric.lenV;
  const openLength = repeatU ? metric.heightVOverU : metric.heightUOverV;
  const radius = 0.82;
  const height = clamp((openLength / repeatLength) * 4.2, 1.05, 3.05);
  const skew = repeatU ? metric.skewVAlongU : metric.skewUAlongV;
  return {
    repeatU,
    point(u, v) {
      const loop = repeatU ? u : v;
      const open = repeatU ? v : u;
      const theta = TAU * (loop + skew * (open - 0.5));
      const h = (open - 0.5) * height;
      const x = radius * Math.cos(theta);
      const z = radius * Math.sin(theta);
      return repeatU ? [x, h, z] : [h, x, z];
    },
    worldToModelScale: (TAU * radius / repeatLength + height / Math.max(1, openLength)) * 0.5
  };
}

function createTorusMap(domain, metric) {
  const R = 1.24;
  const r = clamp((metric.heightVOverU / metric.lenU) * 1.05, 0.18, 0.74);
  const skew = metric.skewVAlongU;
  return {
    point(u, v) {
      const theta = TAU * (u + skew * v);
      const phi = TAU * v;
      const tube = R + r * Math.cos(phi);
      return [tube * Math.cos(theta), r * Math.sin(phi), tube * Math.sin(theta)];
    },
    worldToModelScale: (TAU * R / metric.lenU + TAU * r / metric.lenV) * 0.5
  };
}

function createMobiusMap(domain, metric) {
  const loopU = domain.topology.repeatV1;
  const repeatLength = loopU ? metric.lenU : metric.lenV;
  const openLength = loopU ? metric.heightVOverU : metric.heightUOverV;
  const radius = 0.95;
  const stripWidth = clamp((openLength / repeatLength) * 1.45, 0.30, 0.95);
  return {
    loopU,
    point(u, v) {
      const loop = loopU ? u : v;
      const strip = ((loopU ? v : u) - 0.5) * stripWidth;
      const theta = TAU * loop;
      const radial = radius + strip * Math.cos(theta / 2);
      const x = radial * Math.cos(theta);
      const z = radial * Math.sin(theta);
      const y = strip * Math.sin(theta / 2);
      return loopU ? [x, y, z] : [y, x, z];
    },
    worldToModelScale: (TAU * radius / repeatLength + stripWidth / Math.max(1, openLength)) * 0.5
  };
}

function createKleinMap(domain, metric) {
  const reversedV1 = domain.reversedPair === "v1";
  const R = 1.06;
  const r = clamp((metric.heightVOverU / metric.lenU) * 0.75, 0.24, 0.48);
  const scale = (TAU * R / metric.lenU + TAU * r / metric.lenV) * 0.5;
  return {
    representation: "immersion",
    point(u, v) {
      // A stable Klein-bottle immersion. The coordinate roles are explicit:
      // if left/right is the reversed pair, v is the main loop and u is tube;
      // if top/bottom is the reversed pair, u is the main loop and v is tube.
      const a = reversedV1 ? v : u;
      const b = reversedV1 ? u : v;
      const theta = TAU * a;
      const phi = TAU * b;
      const tube = Math.cos(theta / 2) * Math.sin(phi) - Math.sin(theta / 2) * Math.sin(2 * phi);
      const x = (R + r * tube) * Math.cos(theta);
      const z = (R + r * tube) * Math.sin(theta);
      const y = r * (Math.sin(theta / 2) * Math.sin(phi) + Math.cos(theta / 2) * Math.sin(2 * phi));
      return [x, y, z];
    },
    worldToModelScale: scale
  };
}

function createDoubleReversedInspectionMap(domain, metric) {
  // Both edge pairs reversed form a closed non-orientable gluing. We render it
  // as a stable closed Klein-like immersion rather than as an open inspection
  // sheet, so the preview still feels like a real closed surface while every
  // vertex remains generated from the fundamental cell coordinates.
  const R = 1.08;
  const r = clamp((metric.heightVOverU / metric.lenU) * 0.72, 0.24, 0.46);
  const skew = metric.skewVAlongU * 0.35;
  return {
    representation: "immersion",
    point(u, v) {
      const theta = TAU * (u + skew * v);
      const phi = TAU * v;
      const tube = Math.cos(theta / 2) * Math.sin(phi) - Math.sin(theta / 2) * Math.sin(2 * phi);
      const x = (R + r * tube) * Math.cos(theta);
      const z = (R + r * tube) * Math.sin(theta);
      const y = r * (Math.sin(theta / 2) * Math.sin(phi) + Math.cos(theta / 2) * Math.sin(2 * phi));
      return [x, y, z];
    },
    worldToModelScale: (TAU * R / metric.lenU + TAU * r / metric.lenV) * 0.5
  };
}

function withNormal(map) {
  return {
    ...map,
    normal(u, v) {
      const e = 0.001;
      const u0 = clamp(u - e, 0, 1);
      const u1 = clamp(u + e, 0, 1);
      const v0 = clamp(v - e, 0, 1);
      const v1 = clamp(v + e, 0, 1);
      const pu0 = map.point(u0, v);
      const pu1 = map.point(u1, v);
      const pv0 = map.point(u, v0);
      const pv1 = map.point(u, v1);
      const du = sub3(pu1, pu0);
      const dv = sub3(pv1, pv0);
      let n = normalize(cross(dv, du));
      if (len3(n) < 0.001 || !Number.isFinite(n[0])) {
        const p = map.point(u, v);
        const pu = map.point(clamp(u + e, 0, 1), v);
        const pv = map.point(u, clamp(v + e, 0, 1));
        n = normalize(cross(sub3(pv, p), sub3(pu, p)));
      }
      if (len3(n) < 0.001 || !Number.isFinite(n[0])) n = [0, 1, 0];
      return n;
    }
  };
}

function average3(points) {
  return points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length, sum[2] + p[2] / points.length], [0, 0, 0]);
}
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a) { const l = Math.max(0.000001, len3(a)); return [a[0] / l, a[1] / l, a[2] / l]; }
