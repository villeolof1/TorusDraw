import assert from "node:assert/strict";
import { createSurfaceDomain } from "../src/js/surfaceDomain.js";
import { createSurfaceMap } from "../src/js/surfaceMap.js";

const base = { v1: { x: 600, y: 0 }, v2: { x: 0, y: -420 } };
const preserved = {
  v1: { active: true, label: "A", direction: { left: 1, right: 1 } },
  v2: { active: true, label: "B", direction: { bottom: 1, top: 1 } }
};
const revV1 = {
  v1: { active: true, label: "A", direction: { left: 1, right: -1 } },
  v2: { active: true, label: "B", direction: { bottom: 1, top: 1 } }
};
const revV2 = {
  v1: { active: true, label: "A", direction: { left: 1, right: 1 } },
  v2: { active: true, label: "B", direction: { bottom: 1, top: -1 } }
};
const bothRev = {
  v1: { active: true, label: "A", direction: { left: 1, right: -1 } },
  v2: { active: true, label: "B", direction: { bottom: 1, top: -1 } }
};

function d(a,b){ return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }
function map(surface, twist=0){ return createSurfaceMap(createSurfaceDomain(surface), { viewTwist: twist }); }
function check(name, value, eps=1e-6){ assert.ok(value < eps, `${name}: ${value}`); }

for (const twist of [0, 1, 1.5]) {
  const torus = map({ ...base, edgeLinks: preserved }, twist);
  for (let i=0;i<=16;i++) { const t=i/16; check(`torus u ${twist}`, d(torus.point(0,t), torus.point(1,t)), 1e-6); check(`torus v ${twist}`, d(torus.point(t,0), torus.point(t,1)), 1e-6); }

  const klein = map({ ...base, edgeLinks: revV1 }, twist);
  for (let i=0;i<=16;i++) { const t=i/16; check(`klein circular ${twist}`, d(klein.point(t,0), klein.point(t,1)), 1e-6); check(`klein reversed ${twist}`, d(klein.point(0,t), klein.point(1,1-t)), 1e-6); }

  const projective = map({ ...base, edgeLinks: bothRev }, twist);
  for (let i=0;i<=16;i++) { const t=i/16; check(`projective lr ${twist}`, d(projective.point(0,t), projective.point(1,1-t)), 1e-6); check(`projective tb ${twist}`, d(projective.point(t,0), projective.point(1-t,1)), 1e-6); }
}

const cylinder = map({ ...base, edgeLinks: { ...preserved, v2: { ...preserved.v2, active: false } } });
for (let i=0;i<=16;i++) { const t=i/16; check("cylinder seam", d(cylinder.point(0,t), cylinder.point(1,t)), 1e-6); }

const mobius = map({ ...base, edgeLinks: { ...revV1, v2: { ...revV1.v2, active: false } } });
for (let i=0;i<=16;i++) { const t=i/16; check("mobius seam", d(mobius.point(0,t), mobius.point(1,1-t)), 1e-6); }

console.log("Topology seam tests passed.");
