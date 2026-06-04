// Surface quality checks for extreme/narrow/skewed cells.
// The important value is relative area: sin(angle) = area / (|v1| |v2|).
// A raw determinant alone is not enough because very large almost-parallel
// vectors can have a big determinant while still being numerically unstable.
import { determinant, dot, length } from "./math.js";

export function analyzeSurfaceQuality(surface) {
  const len1 = Math.max(0, length(surface.v1));
  const len2 = Math.max(0, length(surface.v2));
  const det = determinant(surface);
  const area = Math.abs(det);
  const denom = Math.max(1e-9, len1 * len2);
  const sinAngle = Math.min(1, area / denom);
  const cosAngle = Math.max(-1, Math.min(1, dot(surface.v1, surface.v2) / denom));
  const angleDegrees = Math.acos(cosAngle) * 180 / Math.PI;
  const aspect = Math.max(len1, len2) / Math.max(1e-9, Math.min(len1, len2));
  const condition = 1 / Math.max(1e-9, sinAngle);

  const invalid = len1 < 5 || len2 < 5 || sinAngle < 0.008;
  const extreme = !invalid && (sinAngle < 0.035 || aspect > 55 || condition > 140);
  const dense = !invalid && (sinAngle < 0.07 || aspect > 35 || condition > 80);
  const category = invalid ? "invalid" : extreme ? "extreme" : dense ? "dense" : "healthy";

  return { len1, len2, det, area, sinAngle, cosAngle, angleDegrees, aspect, condition, invalid, extreme, dense, category };
}

export function qualityMessage(q) {
  if (q.invalid) return "This cell is too collapsed or close to parallel to draw accurately. Please increase the angle or one of the heights.";
  if (q.extreme) return "This surface is extremely narrow/skewed. The app will use safer rendering for stability.";
  if (q.dense) return "This surface is very narrow/skewed. Safer grid rendering is active.";
  return "";
}
