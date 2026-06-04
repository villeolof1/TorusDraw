// 3D coordinate maps for the fundamental cell.
// Every rendered vertex is generated from one valid cell coordinate (u, v).
// The maps below are metric-driven: v1/v2 lengths, angle, area, and skew all
// influence the 3D shape. Exact flat embeddings are used where possible
// (plane/cylinder); closed/non-orientable surfaces use faithful metric-based
// immersions because perfect flat embeddings are mathematically impossible.
import { TAU, clamp, determinant, dot, length } from "./math.js";

export function createSurfaceMap(domain) {
  const metric = cellMetric(domain.surface);
  const base = {
    domain,
    metric,
    type: domain.classify(),
    typeLabel: domain.typeLabel,
    representation: domain.representation,
    isValidUV,
    textureUV: (u, v) => ({ u, v })
  };

  if (base.type === "plane") return withNormal({ ...base, ...createPlaneMap(metric) });
  if (base.type === "cylinder") return withNormal({ ...base, ...createCylinderMap(domain, metric) });
  if (base.type === "torus") return withNormal({ ...base, ...createTorusMap(domain, metric) });
  if (base.type === "mobius") return withNormal({ ...base, ...createMobiusMap(domain, metric) });
  if (base.type === "klein") return withNormal({ ...base, ...createKleinMap(domain, metric) });
  return withNormal({ ...base, ...createDoubleReversedMap(domain, metric) });
}

function cellMetric(surface) {
  const lenU = Math.max(1, length(surface.v1));
  const lenV = Math.max(1, length(surface.v2));
  const area = Math.max(1, Math.abs(determinant(surface)));
  const detSign = determinant(surface) < 0 ? -1 : 1;

  const cosAngle = clamp(dot(surface.v1, surface.v2) / Math.max(1, lenU * lenV), -0.999, 0.999);
  const angle = Math.acos(cosAngle);
  const heightVOverU = area / lenU;
  const heightUOverV = area / lenV;

  // If v is used after u, this is how much a one-cell v step advances around u.
  const skewVAlongU = clamp(dot(surface.v2, surface.v1) / Math.max(1, lenU * lenU), -2.5, 2.5);
  // If u is used after v, this is how much a one-cell u step advances around v.
  const skewUAlongV = clamp(dot(surface.v1, surface.v2) / Math.max(1, lenV * lenV), -2.5, 2.5);

  const diagonal = Math.max(1, Math.hypot(lenU, lenV));
  const globalScale = 2.35 / diagonal;

  return {
    surface,
    lenU,
    lenV,
    area,
    detSign,
    cosAngle,
    angle,
    heightVOverU,
    heightUOverV,
    skewVAlongU,
    skewUAlongV,
    globalScale
  };
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
  const s = 1.9 / maxDistance;
  return {
    metricKind: "exact-affine-plane",
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
  const linkedLength = repeatU ? metric.lenU : metric.lenV;
  const openHeight = repeatU ? metric.heightVOverU : metric.heightUOverV;
  const shear = repeatU ? metric.skewVAlongU : metric.skewUAlongV;

  // Exact cylinder metric up to one global preview scale:
  // circumference = linkedLength * s, height = open perpendicular height * s.
  const fit = 2.7 / Math.max(openHeight, linkedLength / Math.PI, 1);
  const s = clamp(fit, 0.0012, 0.012);
  const radius = (linkedLength * s) / TAU;
  const height = openHeight * s;

  return {
    repeatU,
    metricKind: "exact-cylinder",
    point(u, v) {
      const loop = repeatU ? u : v;
      const open = repeatU ? v : u;
      const theta = TAU * (loop + shear * open);
      const h = (open - 0.5) * height;
      const x = radius * Math.cos(theta);
      const z = radius * Math.sin(theta);
      return repeatU ? [x, h, z] : [h, x, z];
    },
    worldToModelScale: s
  };
}

function createTorusMap(domain, metric) {
  // Metric-driven torus immersion. A perfectly flat torus cannot be embedded
  // in ordinary 3D, so R/r are chosen from the two fundamental lengths and the
  // skew is applied as a twist of the major-loop coordinate.
  const lenMajor = metric.lenU;
  const lenTube = metric.heightVOverU;
  const fit = 1.62 / Math.max((lenMajor / TAU) + (lenTube / TAU), 1);
  const s = clamp(fit, 0.00085, 0.010);
  const R = Math.max(0.54, (lenMajor * s) / TAU);
  const r = clamp((lenTube * s) / TAU, 0.11, Math.max(0.12, R * 0.62));
  const skew = metric.skewVAlongU;

  return {
    metricKind: "metric-torus-immersion",
    point(u, v) {
      const theta = TAU * (u + skew * v);
      const phi = TAU * v;
      const tube = R + r * Math.cos(phi);
      return [tube * Math.cos(theta), r * Math.sin(phi), tube * Math.sin(theta)];
    },
    worldToModelScale: s
  };
}

function createMobiusMap(domain, metric) {
  const loopU = domain.topology.repeatV1;
  const repeatLength = loopU ? metric.lenU : metric.lenV;
  const openHeight = loopU ? metric.heightVOverU : metric.heightUOverV;
  const shear = loopU ? metric.skewVAlongU : metric.skewUAlongV;

  // A Möbius strip has no exact rectangular flat embedding in this simple
  // analytic form, but these dimensions now come from the true metric.
  const fit = 2.9 / Math.max(repeatLength / Math.PI + openHeight, 1);
  const s = clamp(fit, 0.0010, 0.012);
  const radius = Math.max(0.45, (repeatLength * s) / TAU);
  const stripWidth = clamp(openHeight * s, 0.16, radius * 0.82);

  return {
    loopU,
    metricKind: "metric-mobius-immersion",
    point(u, v) {
      const loop = loopU ? u : v;
      const stripCoord = loopU ? v : u;
      const strip = (stripCoord - 0.5) * stripWidth;
      const theta = TAU * (loop + shear * stripCoord);
      const radial = radius + strip * Math.cos(theta / 2);
      const x = radial * Math.cos(theta);
      const z = radial * Math.sin(theta);
      const y = strip * Math.sin(theta / 2);
      return loopU ? [x, y, z] : [y, x, z];
    },
    worldToModelScale: s
  };
}

function createKleinMap(domain, metric) {
  const reversedV1 = domain.reversedPair === "v1";
  const mainLength = reversedV1 ? metric.lenV : metric.lenU;
  const tubeLength = reversedV1 ? metric.heightUOverV : metric.heightVOverU;
  const shear = reversedV1 ? metric.skewUAlongV : metric.skewVAlongU;
  const fit = 1.70 / Math.max(mainLength / TAU + tubeLength / TAU, 1);
  const s = clamp(fit, 0.00085, 0.010);
  const R = Math.max(0.56, (mainLength * s) / TAU);
  const r = clamp((tubeLength * s) / TAU, 0.10, Math.max(0.12, R * 0.38));

  return {
    representation: "immersion",
    metricKind: "clean-klein-bottle-immersion",
    point(u, v) {
      const main = reversedV1 ? v : u;
      const tubeCoord = reversedV1 ? u : v;
      return cleanBottlePoint(main, tubeCoord, R, r, shear);
    },
    worldToModelScale: s
  };
}

function createDoubleReversedMap(domain, metric) {
  const lenMain = metric.lenU;
  const lenTube = metric.heightVOverU;
  const fit = 1.70 / Math.max(lenMain / TAU + lenTube / TAU, 1);
  const s = clamp(fit, 0.00085, 0.010);
  const R = Math.max(0.56, (lenMain * s) / TAU);
  const r = clamp((lenTube * s) / TAU, 0.10, Math.max(0.12, R * 0.38));
  const skew = metric.skewVAlongU;

  return {
    representation: "immersion",
    metricKind: "clean-double-reversed-bottle-immersion",
    point(u, v) {
      return cleanBottlePoint(u, v, R, r, skew, 0.16);
    },
    worldToModelScale: s
  };
}

function cleanBottlePoint(main, tubeCoord, R, r, shear, extraTwist = 0) {
  const theta = TAU * (main + shear * tubeCoord);
  const phi = TAU * (tubeCoord + extraTwist * Math.sin(TAU * main));
  const neck = smoothstep(0.55, 0.86, main) * (1 - smoothstep(0.94, 1.0, main));
  const bulb = 1 - smoothstep(0.40, 0.72, main);
  const radius = R * (0.92 + 0.26 * bulb - 0.24 * neck);
  const tubeRadius = r * (1.24 - 0.56 * neck + 0.18 * bulb);
  const radial = [Math.cos(theta), 0, Math.sin(theta)];
  const vertical = [0, 1, 0];

  const center = [
    radius * radial[0] + neck * R * 0.22 * Math.cos(theta * 0.5),
    0.54 * neck - 0.20 * bulb * Math.cos(theta),
    radius * radial[2] - neck * R * 0.28 * Math.sin(theta * 0.5)
  ];

  const squeeze = 1 - 0.36 * neck * Math.max(0, Math.cos(phi));
  return [
    center[0] + tubeRadius * squeeze * Math.cos(phi) * radial[0],
    center[1] + tubeRadius * Math.sin(phi),
    center[2] + tubeRadius * squeeze * Math.cos(phi) * radial[2]
  ];
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function withNormal(map) {
  return {
    ...map,
    normal(u, v) {
      const e = 0.001;
      // Closed directions should sample through the map instead of collapsing
      // the derivative to zero at the edge.
      const uw0 = wrapIfClosed(u - e, map.domain.topology.repeatV1);
      const uw1 = wrapIfClosed(u + e, map.domain.topology.repeatV1);
      const vw0 = wrapIfClosed(v - e, map.domain.topology.repeatV2);
      const vw1 = wrapIfClosed(v + e, map.domain.topology.repeatV2);
      const u0 = map.domain.topology.repeatV1 ? uw0 : clamp(u - e, 0, 1);
      const u1 = map.domain.topology.repeatV1 ? uw1 : clamp(u + e, 0, 1);
      const v0 = map.domain.topology.repeatV2 ? vw0 : clamp(v - e, 0, 1);
      const v1 = map.domain.topology.repeatV2 ? vw1 : clamp(v + e, 0, 1);

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

function wrapIfClosed(value, closed) {
  if (!closed) return value;
  return ((value % 1) + 1) % 1;
}

function average3(points) {
  return points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length, sum[2] + p[2] / points.length], [0, 0, 0]);
}
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a) { const l = Math.max(0.000001, len3(a)); return [a[0] / l, a[1] / l, a[2] / l]; }
