// 3D coordinate maps for the fundamental cell.
// Every rendered vertex is generated from one valid cell coordinate (u, v).
// The maps below are metric-driven: v1/v2 lengths, angle, area, and skew all
// influence the 3D shape. Exact flat embeddings are used where possible
// (plane/cylinder); closed/non-orientable surfaces use faithful metric-based
// immersions because perfect flat embeddings are mathematically impossible.
import { TAU, clamp, determinant, dot, length } from "./math.js";

export function createSurfaceMap(domain, options = {}) {
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
  if (base.type === "cylinder") return withNormal({ ...base, ...createCylinderMap(domain, metric, options) });
  if (base.type === "torus") return withNormal({ ...base, ...createTorusMap(domain, metric, options) });
  if (base.type === "mobius") return withNormal({ ...base, ...createMobiusMap(domain, metric, options) });
  if (base.type === "klein") return withNormal({ ...base, ...createKleinMap(domain, metric, options) });
  return withNormal({ ...base, ...createDoubleReversedMap(domain, metric, options) });
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

function createCylinderMap(domain, metric, options = {}) {
  const repeatU = domain.topology.repeatV1;
  const linkedLength = repeatU ? metric.lenU : metric.lenV;
  const openHeight = repeatU ? metric.heightVOverU : metric.heightUOverV;
  const shear = repeatU ? metric.skewVAlongU : metric.skewUAlongV;
  const viewTwist = Number.isFinite(options.viewTwist) ? options.viewTwist : 0;

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
      const theta = TAU * (loop + viewTwist + shear * open);
      const h = (open - 0.5) * height;
      const x = radius * Math.cos(theta);
      const z = radius * Math.sin(theta);
      return repeatU ? [x, h, z] : [h, x, z];
    },
    worldToModelScale: s
  };
}

function createTorusMap(domain, metric, options = {}) {
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
  const viewTwist = Number.isFinite(options.viewTwist) ? options.viewTwist : 0;
  return {
    metricKind: "metric-torus-immersion",
    point(u, v) {
      const theta = TAU * (u + skew * v);
      const phi = TAU * (v + viewTwist);
      const tube = R + r * Math.cos(phi);
      return [tube * Math.cos(theta), r * Math.sin(phi), tube * Math.sin(theta)];
    },
    worldToModelScale: s
  };
}

function createMobiusMap(domain, metric, options = {}) {
  const loopU = domain.topology.repeatV1;
  const repeatLength = loopU ? metric.lenU : metric.lenV;
  const openHeight = loopU ? metric.heightVOverU : metric.heightUOverV;
  const shear = loopU ? metric.skewVAlongU : metric.skewUAlongV;
  const viewTwist = Number.isFinite(options.viewTwist) ? options.viewTwist : 0;

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
      const theta = TAU * (loop + viewTwist + shear * stripCoord);
      const radial = radius + strip * Math.cos(theta / 2);
      const x = radial * Math.cos(theta);
      const z = radial * Math.sin(theta);
      const y = strip * Math.sin(theta / 2);
      return loopU ? [x, y, z] : [y, x, z];
    },
    worldToModelScale: s
  };
}

function createKleinMap(domain, metric, options = {}) {
  const reversedV1 = domain.reversedPair === "v1";
  const km = createKleinMetric(metric, reversedV1);
  const viewTwistValue = Number.isFinite(options.viewTwist) ? options.viewTwist : 0;

  const map = {
    type: "klein",
    representation: "immersion",
    metricKind: "traditional-klein-bottle-metric-immersion",
    reversedV1,
    viewTwistValue,
    // The classical bottle formula is piecewise along the long path. Making
    // these exact mesh boundaries prevents triangles from cutting across the
    // neck/penetration transitions.
    pieceBreaks: reversedV1
      ? { u: [0, 0.25, 0.5, 0.75, 1], v: [0, 1] }
      : { u: [0, 1], v: [0, 0.25, 0.5, 0.75, 1] },
    point(u, v) {
      // The reversed edge pair is the bottle path. The preserved edge pair is
      // the circular tube coordinate. This is the essential Klein quotient:
      //   P(ring, 0) = P(1 - ring, 1)
      const main = reversedV1 ? u : v;
      const ring = reversedV1 ? v : u;
      const seamSafe = Math.sin(Math.PI * clamp(main, 0, 1));
      // User twist is a smooth "roll" of the tube around the Klein path.  A
      // constant phase shift would break the reversed seam.  Using opposite
      // phases at main=0 and main=1 preserves P(r,0)=P(1-r,1), while one full
      // slider loop still returns to the same view.
      const seamRespectingTwist = viewTwistValue * Math.cos(Math.PI * clamp(main, 0, 1));
      const adjustedRing = ring + seamRespectingTwist + km.skewTwist * seamSafe * seamSafe;
      return applyKleinMetric(classicKleinBottleRawPoint(adjustedRing, main), km);
    },
    worldToModelScale: km.worldToModelScale
  };

  // Keep the classical analytic immersion: smooth, seam-exact, and dimension-aware.
  validateKleinSeams(map);
  return map;
}

function createKleinMetric(metric, reversedV1) {
  const mainLength = reversedV1 ? metric.lenU : metric.lenV;
  const tubeLength = reversedV1 ? metric.heightVOverU : metric.heightUOverV;
  const skew = reversedV1 ? metric.skewVAlongU : metric.skewUAlongV;
  // One global preview scale comes from the actual paper dimensions. The smooth
  // immersion is dimension-aware without adding wrinkle-prone mesh relaxation.
  const fit = 2.55 / Math.max(mainLength, tubeLength * 2.25, 1);
  const mainScale = mainLength * fit * 0.50;
  const tubeScale = tubeLength * fit * 0.50;
  const depthScale = tubeLength * fit * 0.50;

  return {
    mainScale,
    tubeScale,
    depthScale,
    mirror: metric.detSign < 0 ? -1 : 1,
    // The twist envelope in createKleinMap is zero on the reversed seam, so
    // skew can influence the interior presentation without breaking gluing.
    skewTwist: clamp(skew * 0.14, -0.30, 0.30),
    worldToModelScale: Math.max(0.0006, Math.min(mainScale, tubeScale) / Math.max(1, Math.min(mainLength, tubeLength)))
  };
}

function createDoubleReversedMap(domain, metric, options = {}) {
  const pm = createProjectivePlaneMetric(metric);
  const viewTwistValue = Number.isFinite(options.viewTwist) ? options.viewTwist : 0;

  const map = {
    type: "double-reversed",
    representation: "immersion",
    metricKind: "projective-plane-double-reversed-immersion",
    viewTwistValue,
    // The projective-plane map is smoothest when the mesh honors the square
    // and disk symmetry axes. This also makes seam and grid lines cleaner.
    pieceBreaks: {
      u: [0, 0.25, 0.5, 0.75, 1],
      v: [0, 0.25, 0.5, 0.75, 1]
    },
    point(u, v) {
      const disk = doubleReversedSquareToDisk(u, v);
      const twistAngle = TAU * viewTwistValue;
      const dx = disk.x * Math.cos(twistAngle) - disk.y * Math.sin(twistAngle);
      const dy = disk.x * Math.sin(twistAngle) + disk.y * Math.cos(twistAngle);
      const raw = projectivePlaneRawPoint(dx, dy, pm);
      return applyProjectivePlaneMetric(raw, pm);
    },
    worldToModelScale: pm.worldToModelScale
  };

  // Keep the smooth analytic projective-plane immersion with exact antipodal seams.
  validateProjectivePlaneSeams(map);
  return map;
}

function createProjectivePlaneMetric(metric) {
  const aspect = clamp(metric.lenU / Math.max(1, metric.lenV), 0.24, 4.2);
  const avgLength = Math.sqrt(metric.lenU * metric.lenV);
  const fit = 2.15 / Math.max(metric.lenU, metric.lenV, avgLength * 1.2, 1);
  const baseScale = Math.max(0.28, avgLength * fit);
  const skew = 0.5 * (metric.skewVAlongU - metric.skewUAlongV);
  return {
    uStretch: Math.sqrt(aspect),
    vStretch: 1 / Math.sqrt(aspect),
    baseScale,
    mirror: metric.detSign < 0 ? -1 : 1,
    centerX: (aspect - (1 / aspect)) / 2,
    skewTwist: clamp(skew * 0.42, -0.55, 0.55),
    worldToModelScale: fit
  };
}


function classicKleinBottleRawPoint(ring, main) {
  // Traditional self-intersecting Klein bottle, based on the classical
  // four-piece tube construction. The ring phase shift makes the app's
  // orientation-reversing seam exact: point(q, 0) === point(1 - q, 1).
  const u = TAU * (ring - 0.25);
  const v = 4 * Math.PI * clamp(main, 0, 1);
  let x, y, z;

  if (v < Math.PI) {
    x = (2.5 - 1.5 * Math.cos(v)) * Math.cos(u);
    y = (2.5 - 1.5 * Math.cos(v)) * Math.sin(u);
    z = -2.5 * Math.sin(v);
  } else if (v < 2 * Math.PI) {
    x = (2.5 - 1.5 * Math.cos(v)) * Math.cos(u);
    y = (2.5 - 1.5 * Math.cos(v)) * Math.sin(u);
    z = 3 * v - 3 * Math.PI;
  } else if (v < 3 * Math.PI) {
    x = -2 + (2 + Math.cos(u)) * Math.cos(v);
    y = Math.sin(u);
    z = (2 + Math.cos(u)) * Math.sin(v) + 3 * Math.PI;
  } else {
    x = -2 + 2 * Math.cos(v) - Math.cos(u);
    y = Math.sin(u);
    z = -3 * v + 12 * Math.PI;
  }

  return { x, y, z };
}

function applyKleinMetric(raw, km) {
  const b = CLASSIC_KLEIN_RAW_BOUNDS;
  const x = (raw.x - b.center.x) / b.half.x;
  const y = (raw.y - b.center.y) / b.half.y;
  const z = (raw.z - b.center.z) / b.half.z;

  // Raw z is the long bottle path. Raw x/y are the tube/bulb cross-section.
  return [
    x * km.tubeScale * km.mirror,
    z * km.mainScale,
    y * km.depthScale
  ];
}

function computeClassicKleinRawBounds() {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i <= 160; i++) {
    const main = i / 160;
    for (let j = 0; j <= 72; j++) {
      const ring = j / 72;
      const p = classicKleinBottleRawPoint(ring, main);
      min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
    }
  }
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2
  };
  return {
    min,
    max,
    center,
    half: {
      x: Math.max(0.000001, (max.x - min.x) / 2),
      y: Math.max(0.000001, (max.y - min.y) / 2),
      z: Math.max(0.000001, (max.z - min.z) / 2)
    }
  };
}

const CLASSIC_KLEIN_RAW_BOUNDS = computeClassicKleinRawBounds();

function doubleReversedSquareToDisk(u, v) {
  // Shirley/Chiu concentric square-to-disk map. It preserves antipodal
  // symmetry exactly: disk(-x, -y) = -disk(x, y). Therefore the two reversed
  // edge pairs become the single antipodal boundary of a projective plane.
  const x = 2 * clamp(u, 0, 1) - 1;
  const y = 2 * clamp(v, 0, 1) - 1;
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return { x: 0, y: 0, r: 0 };

  let r, phi;
  if (Math.abs(x) > Math.abs(y)) {
    r = x;
    phi = (Math.PI / 4) * (y / x);
  } else {
    r = y;
    phi = Math.PI / 2 - (Math.PI / 4) * (x / y);
  }
  const dx = r * Math.cos(phi);
  const dy = r * Math.sin(phi);
  return { x: dx, y: dy, r: Math.hypot(dx, dy) };
}

function projectivePlaneRawPoint(dx, dy, pm) {
  const r = clamp(Math.hypot(dx, dy), 0, 1);
  if (r > 1e-8 && Math.abs(pm.skewTwist) > 1e-8) {
    // Interior-only twist: exactly zero on the boundary, so both reversed
    // seams remain mathematically exact.
    const angle = Math.atan2(dy, dx) + pm.skewTwist * r * (1 - r) * (1 - r);
    dx = r * Math.cos(angle);
    dy = r * Math.sin(angle);
  }

  const x = dx * pm.uStretch;
  const y = dy * pm.vStretch;
  const boundaryFade = Math.max(0, 1 - r * r);

  // Cross-cap/projective-plane immersion from a disk with antipodal boundary.
  // On r=1, the third coordinate is zero and the first two are quadratic, so
  // antipodal boundary points map to the same 3D location exactly.
  return {
    x: x * x - y * y,
    y: 2 * x * y,
    z: 1.65 * x * boundaryFade
  };
}

function applyProjectivePlaneMetric(raw, pm) {
  return [
    (raw.x - pm.centerX) * pm.baseScale * pm.mirror,
    raw.z * pm.baseScale * 1.06,
    raw.y * pm.baseScale * 0.88
  ];
}

let kleinValidationWarned = false;
function validateKleinSeams(map) {
  if (kleinValidationWarned || !map.metricKind?.startsWith("traditional-klein-bottle")) return;
  const eps = 0.0009;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const circularA = map.reversedV1 ? map.point(t, 0) : map.point(0, t);
    const circularB = map.reversedV1 ? map.point(t, 1) : map.point(1, t);
    const twistedA = map.reversedV1 ? map.point(0, t) : map.point(t, 0);
    const twistedB = map.reversedV1 ? map.point(1, 1 - t) : map.point(1 - t, 1);
    if (distance3(circularA, circularB) > eps || distance3(twistedA, twistedB) > eps) {
      kleinValidationWarned = true;
      console.warn("Klein seam validation failed", { t, circularA, circularB, twistedA, twistedB });
      return;
    }
  }
}

let projectivePlaneValidationWarned = false;
function validateProjectivePlaneSeams(map) {
  if (projectivePlaneValidationWarned || !map.metricKind?.startsWith("projective-plane-double-reversed-immersion")) return;
  const eps = 0.0009;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const lrA = map.point(0, t);
    const lrB = map.point(1, 1 - t);
    const tbA = map.point(t, 0);
    const tbB = map.point(1 - t, 1);
    if (distance3(lrA, lrB) > eps || distance3(tbA, tbB) > eps) {
      projectivePlaneValidationWarned = true;
      console.warn("Projective-plane seam validation failed", { t, lrA, lrB, tbA, tbB });
      return;
    }
  }
}


function withNormal(map) {
  return {
    ...map,
    normal(u, v) {
      const e = 0.001;
      // Sample neighboring coordinates through the actual domain normalizer.
      // This is critical for orientation-reversing seams: crossing the seam
      // must also flip the transverse coordinate, not merely wrap 0 ↔ 1.
      const u0uv = normalizeOffsetUV(map, u - e, v);
      const u1uv = normalizeOffsetUV(map, u + e, v);
      const v0uv = normalizeOffsetUV(map, u, v - e);
      const v1uv = normalizeOffsetUV(map, u, v + e);

      const pu0 = map.point(u0uv.u, u0uv.v);
      const pu1 = map.point(u1uv.u, u1uv.v);
      const pv0 = map.point(v0uv.u, v0uv.v);
      const pv1 = map.point(v1uv.u, v1uv.v);
      const du = sub3(pu1, pu0);
      const dv = sub3(pv1, pv0);
      let n = normalize(cross(dv, du));
      if (len3(n) < 0.001 || !Number.isFinite(n[0])) {
        const p = map.point(u, v);
        const pu = map.point(normalizeOffsetUV(map, u + e, v).u, normalizeOffsetUV(map, u + e, v).v);
        const pv = map.point(normalizeOffsetUV(map, u, v + e).u, normalizeOffsetUV(map, u, v + e).v);
        n = normalize(cross(sub3(pv, p), sub3(pu, p)));
      }
      if (len3(n) < 0.001 || !Number.isFinite(n[0])) n = [0, 1, 0];
      return n;
    }
  };
}

function normalizeOffsetUV(map, u, v) {
  const uv = map.domain.normalizeUV ? map.domain.normalizeUV({ u, v }) : null;
  if (uv) return uv;
  return { u: clamp(u, 0, 1), v: clamp(v, 0, 1) };
}


function average3(points) {
  return points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length, sum[2] + p[2] / points.length], [0, 0, 0]);
}
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function distance3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function normalize(a) { const l = Math.max(0.000001, len3(a)); return [a[0] / l, a[1] / l, a[2] / l]; }
