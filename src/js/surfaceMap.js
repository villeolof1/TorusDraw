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

  // Keep the classical analytic immersion for the final preview.  The earlier
  // metric-relaxation pass made the bottle locally more length-matched, but it
  // introduced visible crumpling/wrinkling.  This map is smooth, seam-exact,
  // and dimension-aware without adding solver artifacts.
  validateKleinSeams(map);
  return map;
}

function createKleinMetric(metric, reversedV1) {
  const mainLength = reversedV1 ? metric.lenU : metric.lenV;
  const tubeLength = reversedV1 ? metric.heightVOverU : metric.heightUOverV;
  const skew = reversedV1 ? metric.skewVAlongU : metric.skewUAlongV;
  // One global preview scale comes from the actual paper dimensions. These
  // scales are only the starting immersion; a metric-relaxation pass below
  // adjusts the mesh so local edge lengths match the input cell metric as
  // closely as possible while preserving the exact Klein seam identities.
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

  // Keep the smooth analytic projective-plane immersion.  Solver relaxation
  // made the double-reversed surface wrinkly; this keeps the antipodal seams
  // exact and the dimensions visually faithful without crumpling.
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


const METRIC_RELAXATION_CACHE = new Map();
const METRIC_RELAXATION_MAX_CACHE = 10;

function relaxMetricMap(map, domain, metric) {
  if (!(map.metricKind?.startsWith("traditional-klein-bottle") || map.metricKind === "projective-plane-double-reversed-immersion")) return map;

  const key = metricRelaxationKey(map, domain, metric);
  const cached = METRIC_RELAXATION_CACHE.get(key);
  if (cached) return attachRelaxedSampler(map, cached);

  const gridSize = map.type === "klein"
    ? (map.reversedV1 ? { nx: 48, ny: 30 } : { nx: 30, ny: 48 })
    : { nx: 40, ny: 40 };
  const nx = gridSize.nx;
  const ny = gridSize.ny;
  const count = (nx + 1) * (ny + 1);
  const initial = new Array(count);
  const points = new Array(count);

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / ny;
      const p = map.point(u, v);
      initial[idx(i, j, nx)] = [...p];
      points[idx(i, j, nx)] = [...p];
    }
  }
  enforceRelaxedSeams(points, nx, ny, map);

  const relaxationScale = estimateMetricScale(points, nx, ny, metric, map.worldToModelScale || metric.globalScale || 0.003);
  const constraints = buildMetricConstraints(nx, ny, metric, relaxationScale);
  // The first metric-relaxation version was intentionally aggressive, but on
  // impossible-to-embed surfaces it could satisfy local edge lengths by making
  // tiny crumples. For a university-facing preview we prefer a smooth,
  // low-bending immersion whose metric error is measured rather than a
  // wrinkled pseudo-isometry. These softer constraints, a strong attraction to
  // the analytic immersion, and explicit topological Laplacian smoothing remove
  // the wrinkle artifacts while still making the shape respond to the input
  // cell metric.
  const iterations = map.type === "double-reversed" ? 62 : 58;
  const edgeStiffness = map.type === "double-reversed" ? 0.25 : 0.28;
  const anchorStiffness = map.type === "double-reversed" ? 0.050 : 0.055;
  const smoothingStiffness = map.type === "double-reversed" ? 0.090 : 0.075;

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const c of constraints) applyDistanceConstraint(points, c, edgeStiffness * c.weight);
    enforceRelaxedSeams(points, nx, ny, map);
    applyTopologicalSmoothing(points, nx, ny, map, smoothingStiffness);
    enforceRelaxedSeams(points, nx, ny, map);
    applyAnchorPull(points, initial, anchorStiffness);
    enforceRelaxedSeams(points, nx, ny, map);
  }

  for (let pass = 0; pass < 5; pass++) {
    applyTopologicalSmoothing(points, nx, ny, map, smoothingStiffness * 0.55);
    enforceRelaxedSeams(points, nx, ny, map);
    applyAnchorPull(points, initial, anchorStiffness * 0.75);
    enforceRelaxedSeams(points, nx, ny, map);
  }

  centerRelaxedPoints(points);
  const audit = auditMetricGrid(points, constraints, nx, ny, map);
  const relaxed = { nx, ny, points, audit, scale: relaxationScale };
  rememberMetricRelaxation(key, relaxed);
  return attachRelaxedSampler(map, relaxed);
}

function metricRelaxationKey(map, domain, metric) {
  const s = metric.surface;
  const links = s.edgeLinks || {};
  return [
    map.metricKind,
    map.reversedV1 ? 1 : 0,
    round6(map.viewTwistValue || 0),
    round6(s.v1.x), round6(s.v1.y), round6(s.v2.x), round6(s.v2.y),
    links.v1?.active ? 1 : 0, links.v1?.direction?.left ?? 1, links.v1?.direction?.right ?? 1,
    links.v2?.active ? 1 : 0, links.v2?.direction?.bottom ?? 1, links.v2?.direction?.top ?? 1,
    domain.type
  ].join("|");
}

function rememberMetricRelaxation(key, value) {
  if (METRIC_RELAXATION_CACHE.size >= METRIC_RELAXATION_MAX_CACHE) {
    const oldest = METRIC_RELAXATION_CACHE.keys().next().value;
    METRIC_RELAXATION_CACHE.delete(oldest);
  }
  METRIC_RELAXATION_CACHE.set(key, value);
}

function attachRelaxedSampler(map, relaxed) {
  return {
    ...map,
    metricKind: `${map.metricKind}+metric-relaxed`,
    metricAudit: relaxed.audit,
    worldToModelScale: relaxed.scale || map.worldToModelScale,
    point(u, v) {
      return sampleRelaxedGrid(relaxed, clamp(u, 0, 1), clamp(v, 0, 1));
    }
  };
}

function estimateMetricScale(points, nx, ny, metric, fallback) {
  let num = 0;
  let den = 0;
  const add = (i0, j0, i1, j1) => {
    const p0 = points[idx(i0, j0, nx)];
    const p1 = points[idx(i1, j1, nx)];
    const paper = metricDistance({ u: i0 / nx, v: j0 / ny }, { u: i1 / nx, v: j1 / ny }, metric);
    if (paper <= 1e-8) return;
    const current = distance3(p0, p1);
    num += current * paper;
    den += paper * paper;
  };
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) add(i, j, i + 1, j);
  for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) add(i, j, i, j + 1);
  const scale = den > 0 ? num / den : fallback;
  return clamp(scale, Math.max(0.00015, fallback * 0.35), Math.max(0.0002, fallback * 3.25));
}

function buildMetricConstraints(nx, ny, metric, scale) {
  const constraints = [];
  const add = (i0, j0, i1, j1, weight = 1) => {
    const aUv = { u: i0 / nx, v: j0 / ny };
    const bUv = { u: i1 / nx, v: j1 / ny };
    constraints.push({
      a: idx(i0, j0, nx),
      b: idx(i1, j1, nx),
      len: metricDistance(aUv, bUv, metric) * scale,
      weight
    });
  };

  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) add(i, j, i + 1, j, 1.0);
  for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) add(i, j, i, j + 1, 1.0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      add(i, j, i + 1, j + 1, 0.34);
      add(i + 1, j, i, j + 1, 0.34);
    }
  }
  return constraints;
}

function applyDistanceConstraint(points, c, stiffness) {
  const a = points[c.a];
  const b = points[c.b];
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const d = Math.max(1e-8, Math.hypot(dx, dy, dz));
  const diff = ((d - c.len) / d) * 0.5 * stiffness;
  const cx = dx * diff, cy = dy * diff, cz = dz * diff;
  a[0] += cx; a[1] += cy; a[2] += cz;
  b[0] -= cx; b[1] -= cy; b[2] -= cz;
}

function applyAnchorPull(points, initial, stiffness) {
  for (let i = 0; i < points.length; i++) {
    points[i][0] += (initial[i][0] - points[i][0]) * stiffness;
    points[i][1] += (initial[i][1] - points[i][1]) * stiffness;
    points[i][2] += (initial[i][2] - points[i][2]) * stiffness;
  }
}

function applyTopologicalSmoothing(points, nx, ny, map, amount) {
  if (amount <= 0) return;
  const before = points.map(p => [...p]);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const id = idx(i, j, nx);
      const n = [gridNeighbor(i - 1, j, nx, ny, map), gridNeighbor(i + 1, j, nx, ny, map), gridNeighbor(i, j - 1, nx, ny, map), gridNeighbor(i, j + 1, nx, ny, map)];
      if (n.some(item => !item)) continue;
      const avg = [0, 0, 0];
      for (const item of n) {
        const p = before[idx(item.i, item.j, nx)];
        avg[0] += p[0] * 0.25; avg[1] += p[1] * 0.25; avg[2] += p[2] * 0.25;
      }
      const p = points[id];
      p[0] += (avg[0] - p[0]) * amount;
      p[1] += (avg[1] - p[1]) * amount;
      p[2] += (avg[2] - p[2]) * amount;
    }
  }
}

function gridNeighbor(i, j, nx, ny, map) {
  if (i >= 0 && i <= nx && j >= 0 && j <= ny) return { i, j };
  if (map.type === "klein") {
    if (map.reversedV1) {
      if (i < 0) return { i: nx, j: ny - clampInt(j, 0, ny) };
      if (i > nx) return { i: 0, j: ny - clampInt(j, 0, ny) };
      if (j < 0) return { i: clampInt(i, 0, nx), j: ny };
      if (j > ny) return { i: clampInt(i, 0, nx), j: 0 };
    } else {
      if (i < 0) return { i: nx, j: clampInt(j, 0, ny) };
      if (i > nx) return { i: 0, j: clampInt(j, 0, ny) };
      if (j < 0) return { i: nx - clampInt(i, 0, nx), j: ny };
      if (j > ny) return { i: nx - clampInt(i, 0, nx), j: 0 };
    }
  } else if (map.type === "double-reversed") {
    if (i < 0) return { i: nx, j: ny - clampInt(j, 0, ny) };
    if (i > nx) return { i: 0, j: ny - clampInt(j, 0, ny) };
    if (j < 0) return { i: nx - clampInt(i, 0, nx), j: ny };
    if (j > ny) return { i: nx - clampInt(i, 0, nx), j: 0 };
  }
  return null;
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function enforceRelaxedSeams(points, nx, ny, map) {
  const pair = (a, b) => {
    const pa = points[a], pb = points[b];
    const m = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    pa[0] = pb[0] = m[0]; pa[1] = pb[1] = m[1]; pa[2] = pb[2] = m[2];
  };
  const unifyCorners = () => {
    const ids = [idx(0, 0, nx), idx(nx, 0, nx), idx(0, ny, nx), idx(nx, ny, nx)];
    const m = [0, 0, 0];
    for (const id of ids) { m[0] += points[id][0] / ids.length; m[1] += points[id][1] / ids.length; m[2] += points[id][2] / ids.length; }
    for (const id of ids) { points[id][0] = m[0]; points[id][1] = m[1]; points[id][2] = m[2]; }
  };

  // Pair constraints that meet at corners need a few projection passes because
  // one seam can otherwise slightly disturb another. The final corner unifier
  // makes the quotient exact at all four cell corners.
  for (let pass = 0; pass < 5; pass++) {
    if (map.type === "klein") {
      if (map.reversedV1) {
        for (let i = 0; i <= nx; i++) pair(idx(i, 0, nx), idx(i, ny, nx));
        for (let j = 0; j <= ny; j++) pair(idx(0, j, nx), idx(nx, ny - j, nx));
      } else {
        for (let j = 0; j <= ny; j++) pair(idx(0, j, nx), idx(nx, j, nx));
        for (let i = 0; i <= nx; i++) pair(idx(i, 0, nx), idx(nx - i, ny, nx));
      }
      unifyCorners();
    } else if (map.type === "double-reversed") {
      for (let j = 0; j <= ny; j++) pair(idx(0, j, nx), idx(nx, ny - j, nx));
      for (let i = 0; i <= nx; i++) pair(idx(i, 0, nx), idx(nx - i, ny, nx));
      unifyCorners();
    }
  }
}

function centerRelaxedPoints(points) {
  const center = [0, 0, 0];
  for (const p of points) { center[0] += p[0]; center[1] += p[1]; center[2] += p[2]; }
  center[0] /= points.length; center[1] /= points.length; center[2] /= points.length;
  for (const p of points) { p[0] -= center[0]; p[1] -= center[1]; p[2] -= center[2]; }
}

function sampleRelaxedGrid(relaxed, u, v) {
  const { nx, ny, points } = relaxed;
  const x = clamp(u, 0, 1) * nx;
  const y = clamp(v, 0, 1) * ny;
  const i0 = Math.min(nx - 1, Math.max(0, Math.floor(x)));
  const j0 = Math.min(ny - 1, Math.max(0, Math.floor(y)));
  const i1 = i0 + 1;
  const j1 = j0 + 1;
  const tx = x - i0;
  const ty = y - j0;
  const a = points[idx(i0, j0, nx)], b = points[idx(i1, j0, nx)], c = points[idx(i1, j1, nx)], d = points[idx(i0, j1, nx)];
  return [
    lerp(lerp(a[0], b[0], tx), lerp(d[0], c[0], tx), ty),
    lerp(lerp(a[1], b[1], tx), lerp(d[1], c[1], tx), ty),
    lerp(lerp(a[2], b[2], tx), lerp(d[2], c[2], tx), ty)
  ];
}

function auditMetricGrid(points, constraints, nx, ny, map) {
  let sum = 0, max = 0, count = 0;
  for (const c of constraints) {
    if (c.len <= 1e-8 || c.weight < 0.99) continue;
    const d = distance3(points[c.a], points[c.b]);
    const err = Math.abs(d - c.len) / c.len;
    sum += err; max = Math.max(max, err); count++;
  }
  return {
    averageStretchError: count ? sum / count : 0,
    maxStretchError: max,
    seamError: seamError(points, nx, ny, map)
  };
}

function seamError(points, nx, ny, map) {
  let max = 0;
  const add = (a, b) => { max = Math.max(max, distance3(points[a], points[b])); };
  if (map.type === "klein") {
    if (map.reversedV1) {
      for (let i = 0; i <= nx; i++) add(idx(i, 0, nx), idx(i, ny, nx));
      for (let j = 0; j <= ny; j++) add(idx(0, j, nx), idx(nx, ny - j, nx));
    } else {
      for (let j = 0; j <= ny; j++) add(idx(0, j, nx), idx(nx, j, nx));
      for (let i = 0; i <= nx; i++) add(idx(i, 0, nx), idx(nx - i, ny, nx));
    }
  } else if (map.type === "double-reversed") {
    for (let j = 0; j <= ny; j++) add(idx(0, j, nx), idx(nx, ny - j, nx));
    for (let i = 0; i <= nx; i++) add(idx(i, 0, nx), idx(nx - i, ny, nx));
  }
  return max;
}

function metricDistance(a, b, metric) {
  const du = a.u - b.u;
  const dv = a.v - b.v;
  const g11 = metric.lenU * metric.lenU;
  const g12 = metric.cosAngle * metric.lenU * metric.lenV;
  const g22 = metric.lenV * metric.lenV;
  return Math.sqrt(Math.max(0, du * du * g11 + 2 * du * dv * g12 + dv * dv * g22));
}

function idx(i, j, nx) { return j * (nx + 1) + i; }
function lerp(a, b, t) { return a + (b - a) * t; }
function round6(value) { return Math.round((value || 0) * 1000000) / 1000000; }

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

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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
function distance3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function normalize(a) { const l = Math.max(0.000001, len3(a)); return [a[0] / l, a[1] / l, a[2] / l]; }
