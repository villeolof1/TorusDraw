// Pointer input: drawing, panning, line snapping, and two eraser styles.
import { state, cloneObjects } from "./state.js";
import { add, clamp, length, screenToWorld, sub, visibleOffsets, worldToBaseFromCell } from "./math.js";
import { hideAngleHint, showAngleHint } from "./dom.js";
import { addObject, replaceAll } from "./history.js";
import { redraw, requestRender } from "./render2d.js";

const SNAP = Math.PI / 12;
let isDrawing = false, isPanning = false, startPoint = null, currentObject = null;
let panStart = null, viewStart = null, eraseBefore = null, eraseChanged = false, spaceDown = false;

function pointerPoint(event) {
  const box = state.canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}
function worldFromEvent(event) {
  const p = screenToWorld(pointerPoint(event), state.view, state.cssWidth, state.cssHeight);
  p.pressure = event.pointerType === "pen" ? clamp(event.pressure || 0.5, 0, 1) : 0.5;
  return p;
}
function currentStyle() { return { color: state.ui.colorInput.value, size: Number(state.ui.sizeInput.value) || 1 }; }

export function chooseTool(tool) {
  saveCurrentSize();
  state.tool = tool;
  state.ui.penButton.classList.toggle("active", tool === "pen");
  state.ui.lineButton.classList.toggle("active", tool === "line");
  state.ui.eraseButton.classList.toggle("active", tool === "erase");
  state.ui.homButton.classList.toggle("active", tool === "hom");
  state.ui.panButton.classList.toggle("active", tool === "pan");
  setEraserOptionsVisible(tool === "erase");
  state.canvas.classList.toggle("panning", tool === "pan" || spaceDown);
  state.canvas.classList.toggle("homing", tool === "hom");
  state.ui.sizeInput.value = tool === "erase" ? state.eraserSize : state.penSize;
  if (tool !== "hom") {
    state.homHoverId = null;
    state.homSelectedId = null;
  }
  hideAngleHint();
}

function setEraserOptionsVisible(visible) {
  const options = state.ui.eraserOptions;
  if (visible) {
    options.hidden = false;
    requestAnimationFrame(() => options.classList.add("visible"));
    return;
  }
  options.classList.remove("visible");
  window.setTimeout(() => {
    if (state.tool !== "erase") options.hidden = true;
  }, 210);
}

export function saveCurrentSize() {
  const value = Math.max(1, Number(state.ui.sizeInput.value) || 1);
  if (state.tool === "erase") state.eraserSize = value;
  if (state.tool === "pen" || state.tool === "line") state.penSize = value;
}

export function setEraserMode(mode) {
  state.eraserMode = mode === "rub" ? "rub" : "object";
  state.ui.eraseObjectButton.classList.toggle("active", state.eraserMode === "object");
  state.ui.eraseRubButton.classList.toggle("active", state.eraserMode === "rub");
}

function lineFromModifiers(center, pointer, event) {
  let delta = sub(pointer, center), angleDegrees = null;
  if (event.shiftKey) {
    const len = length(delta);
    const snapped = Math.round(Math.atan2(delta.y, delta.x) / SNAP) * SNAP;
    delta = { x: Math.cos(snapped) * len, y: Math.sin(snapped) * len };
    angleDegrees = ((Math.round(snapped * 180 / Math.PI) % 360) + 360) % 360;
  }
  return { points: event.altKey ? [sub(center, delta), add(center, delta)] : [center, add(center, delta)], angleDegrees };
}

function distanceToSegment(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a), denom = ab.x * ab.x + ab.y * ab.y;
  const t = denom ? clamp((ap.x * ab.x + ap.y * ab.y) / denom, 0, 1) : 0;
  return length(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
}
function hitObject(object, localPoint, radius) {
  const threshold = radius + (object.size || 1) / 2;
  for (let i = 1; i < object.points.length; i++) if (distanceToSegment(localPoint, object.points[i - 1], object.points[i]) <= threshold) return true;
  return false;
}
function localHitPoint(object, worldPoint, radius) {
  for (const offset of visibleOffsets(state)) {
    const local = worldToBaseFromCell(worldPoint, state.surface, offset);
    if (local && hitObject(object, local, radius)) return local;
  }
  return null;
}

function objectHitAt(worldPoint, radius = 12 / Math.max(0.2, state.view.zoom)) {
  let best = null;
  for (const object of state.objects) {
    for (const offset of visibleOffsets(state)) {
      const local = worldToBaseFromCell(worldPoint, state.surface, offset);
      if (local && hitObject(object, local, radius)) best = { object, offset };
    }
  }
  return best;
}

function updateHomHover(worldPoint) {
  const hit = objectHitAt(worldPoint);
  state.homHoverId = hit ? hit.object.id : null;
  state.homHoverOffset = hit ? { ...hit.offset } : { i: 0, j: 0 };
  requestRender();
}

function splitByRubEraser(object, point, radius) {
  const threshold = radius + (object.size || 1) * 0.6;
  const chunks = []; let chunk = [], changed = false;
  for (const p of object.points) {
    if (length(sub(p, point)) <= threshold) { changed = true; if (chunk.length >= 2) chunks.push(chunk); chunk = []; }
    else chunk.push({ ...p });
  }
  if (chunk.length >= 2) chunks.push(chunk);
  return changed ? chunks.map(points => ({ ...object, id: state.nextObjectId++, type: "pen", points })) : [object];
}

function applyEraser(worldPoint) {
  const radius = Math.max(1, Number(state.ui.sizeInput.value) || state.eraserSize) / 2;
  const next = [];
  for (const object of state.objects) {
    const local = localHitPoint(object, worldPoint, radius);
    if (!local) { next.push(object); continue; }
    eraseChanged = true;
    if (state.eraserMode === "rub") next.push(...splitByRubEraser(object, local, radius));
  }
  if (eraseChanged) { state.objects = next; requestRender(); }
}

export function startPointer(event) {
  state.ui.sizeInput.blur();
  event.preventDefault();
  state.canvas.setPointerCapture(event.pointerId);
  const screen = pointerPoint(event);
  if (state.tool === "hom") {
    const hit = objectHitAt(screenToWorld(screen, state.view, state.cssWidth, state.cssHeight));
    state.homSelectedId = hit ? hit.object.id : null;
    state.homSelectedOffset = hit ? { ...hit.offset } : { i: 0, j: 0 };
    state.homHoverId = hit ? hit.object.id : null;
    state.homHoverOffset = hit ? { ...hit.offset } : { i: 0, j: 0 };
    requestRender();
    return;
  }
  if (state.tool === "pan" || spaceDown) {
    isPanning = true; panStart = screen; viewStart = { ...state.view }; state.canvas.classList.add("active-pan"); return;
  }
  isDrawing = true;
  if (state.tool === "erase") { eraseBefore = cloneObjects(state.objects); eraseChanged = false; applyEraser(screenToWorld(screen, state.view, state.cssWidth, state.cssHeight)); return; }
  startPoint = worldFromEvent(event);
  currentObject = { id: state.nextObjectId++, type: state.tool, points: [startPoint], ...currentStyle() };
}

export function movePointer(event) {
  const screen = pointerPoint(event);
  if (state.tool === "hom") {
    updateHomHover(screenToWorld(screen, state.view, state.cssWidth, state.cssHeight));
    return;
  }
  if (isPanning) {
    event.preventDefault();
    state.view.x = viewStart.x - (screen.x - panStart.x) / state.view.zoom;
    state.view.y = viewStart.y - (screen.y - panStart.y) / state.view.zoom;
    requestRender(); return;
  }
  if (!isDrawing) return;
  event.preventDefault();
  if (state.tool === "erase") { applyEraser(screenToWorld(screen, state.view, state.cssWidth, state.cssHeight)); return; }
  const point = worldFromEvent(event);
  if (state.tool === "pen") { currentObject.points.push(point); state.previewObject = currentObject; hideAngleHint(); redraw(currentObject); }
  if (state.tool === "line") {
    const data = lineFromModifiers(startPoint, point, event);
    state.previewObject = { ...currentObject, points: data.points };
    showAngleHint(screen, data.angleDegrees); redraw(state.previewObject);
  }
}

export function stopPointer(event) {
  if (isPanning) { isPanning = false; state.canvas.classList.remove("active-pan"); return; }
  if (!isDrawing) return;
  event.preventDefault(); isDrawing = false;
  if (state.tool === "erase") { if (eraseChanged) replaceAll(eraseBefore, state.objects); eraseBefore = null; eraseChanged = false; return; }
  if (state.tool === "line") currentObject.points = lineFromModifiers(startPoint, worldFromEvent(event), event).points;
  if (currentObject.points.length >= 2) addObject(currentObject);
  state.previewObject = null; currentObject = null; startPoint = null; hideAngleHint();
}

export function handleSpace(event, down) {
  if (event.key !== " ") return;
  event.preventDefault(); spaceDown = down; state.canvas.classList.toggle("panning", state.tool === "pan" || spaceDown);
}
