// Torus Drawing Pane
// Minimalist object-based drawing on an infinite camera view with parameterized repeats.

const canvas = document.getElementById("drawingCanvas");
const ctx = canvas.getContext("2d", { alpha: false });

const penButton = document.getElementById("penButton");
const lineButton = document.getElementById("lineButton");
const eraseButton = document.getElementById("eraseButton");
const panButton = document.getElementById("panButton");
const eraserOptions = document.getElementById("eraserOptions");
const eraseObjectButton = document.getElementById("eraseObjectButton");
const eraseRubButton = document.getElementById("eraseRubButton");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const clearButton = document.getElementById("clearButton");
const colorInput = document.getElementById("colorInput");
const sizeInput = document.getElementById("sizeInput");
const repeatV1Input = document.getElementById("repeatV1Input");
const repeatV2Input = document.getElementById("repeatV2Input");
const hideGridInput = document.getElementById("hideGridInput");
const geometryButton = document.getElementById("geometryButton");
const geometryPanel = document.getElementById("geometryPanel");
const backgroundInput = document.getElementById("backgroundInput");
const removeBackgroundButton = document.getElementById("removeBackgroundButton");
const resetGeometryButton = document.getElementById("resetGeometryButton");
const centerViewButton = document.getElementById("centerViewButton");
const updateSurfaceButton = document.getElementById("updateSurfaceButton");
const fitCellButton = document.getElementById("fitCellButton");
const exportButton = document.getElementById("exportButton");
const saveProjectButton = document.getElementById("saveProjectButton");
const projectInput = document.getElementById("projectInput");
const zoomSlider = document.getElementById("zoomSlider");
const zoomInButton = document.getElementById("zoomInButton");
const zoomOutButton = document.getElementById("zoomOutButton");
const status = document.getElementById("status");
const helpButton = document.getElementById("helpButton");
const helpPanel = document.getElementById("helpPanel");
const angleHint = document.getElementById("angleHint");

const a1Input = document.getElementById("a1Input");
const b1Input = document.getElementById("b1Input");
const a2Input = document.getElementById("a2Input");
const b2Input = document.getElementById("b2Input");

const MIN_ZOOM = 0.16;
const MAX_ZOOM = 7.5;
const REPEAT_PADDING = 4;
const DET_MIN = 0.001;
const VECTOR_REPEAT_MIN_LENGTH = 1;
const STORAGE_KEY = "torus-drawing-app.autosave.v3";
const SNAP_STEP_RADIANS = Math.PI / 12;
const DEFAULT_HIDE_GRID = false;
const DEFAULT_SURFACE = {
  v1: { x: 600, y: 0 },
  v2: { x: 0, y: 420 },
  repeatV1: true,
  repeatV2: true
};

let cssWidth = 1;
let cssHeight = 1;
let dpr = 1;

let objects = [];
let undoStack = [];
let redoStack = [];
let nextObjectId = 1;

let tool = "pen";
let isDrawing = false;
let isPanning = false;
let startPoint = null;
let lastPoint = null;
let currentObject = null;
let panStart = null;
let viewStart = null;
let spaceIsDown = false;
let eraserMode = "object";
let eraseBeforeObjects = null;
let eraseChanged = false;

let view = {
  x: 300,
  y: 210,
  zoom: 0.9
};

let surface = cloneSurface(DEFAULT_SURFACE);

let background = {
  image: null,
  dataUrl: null,
  naturalWidth: 1,
  naturalHeight: 1
};

let renderQueued = false;
let previewObject = null;
let previewQueued = false;
let statusTimer = null;
let autosaveTimer = null;
let loadedAutosave = false;

function cloneSurface(value) {
  return {
    v1: { ...value.v1 },
    v2: { ...value.v2 },
    repeatV1: Boolean(value.repeatV1),
    repeatV2: Boolean(value.repeatV2)
  };
}

function surfacesEqual(a, b) {
  return (
    a.v1.x === b.v1.x &&
    a.v1.y === b.v1.y &&
    a.v2.x === b.v2.x &&
    a.v2.y === b.v2.y &&
    a.repeatV1 === b.repeatV1 &&
    a.repeatV2 === b.repeatV2
  );
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    redraw();
  });
}

function resizeCanvas() {
  dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  cssWidth = window.innerWidth;
  cssHeight = window.innerHeight;

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  requestRender();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pointFromEvent(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: event.clientX - box.left,
    y: event.clientY - box.top
  };
}

function pointerPressure(event) {
  if (event.pointerType === "pen" && Number.isFinite(event.pressure) && event.pressure > 0) {
    return clamp(event.pressure, 0, 1);
  }
  return 0.5;
}

function worldPointFromEvent(event) {
  const world = screenToWorld(pointFromEvent(event));
  world.pressure = pointerPressure(event);
  return world;
}

function screenToWorld(point) {
  return {
    x: (point.x - cssWidth / 2) / view.zoom + view.x,
    y: (point.y - cssHeight / 2) / view.zoom + view.y
  };
}

function worldToScreen(point) {
  return {
    x: (point.x - view.x) * view.zoom + cssWidth / 2,
    y: (point.y - view.y) * view.zoom + cssHeight / 2
  };
}

function currentStyle() {
  return {
    color: colorInput.value,
    size: Math.max(1, Number(sizeInput.value) || 1)
  };
}

function cloneObject(object) {
  return {
    ...object,
    points: object.points.map(point => ({ ...point }))
  };
}

function cloneObjects(list) {
  return list.map(cloneObject);
}

function updateHistoryButtons() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function chooseTool(newTool) {
  tool = newTool;
  penButton.classList.toggle("active", tool === "pen");
  lineButton.classList.toggle("active", tool === "line");
  eraseButton.classList.toggle("active", tool === "erase");
  panButton.classList.toggle("active", tool === "pan");
  eraserOptions.hidden = tool !== "erase";
  canvas.classList.toggle("panning", tool === "pan" || spaceIsDown);
  hideAngleHint();
}

function length(vector) {
  return Math.hypot(vector.x, vector.y);
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v, amount) {
  return { x: v.x * amount, y: v.y * amount };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function displacement(i, j) {
  return add(scale(surface.v1, i), scale(surface.v2, j));
}

function determinant() {
  return surface.v1.x * surface.v2.y - surface.v1.y * surface.v2.x;
}

function worldToBasis(point) {
  const det = determinant();
  if (Math.abs(det) < DET_MIN) return null;

  return {
    u: (point.x * surface.v2.y - point.y * surface.v2.x) / det,
    v: (surface.v1.x * point.y - surface.v1.y * point.x) / det
  };
}

function viewportWorldCorners() {
  return [
    screenToWorld({ x: 0, y: 0 }),
    screenToWorld({ x: cssWidth, y: 0 }),
    screenToWorld({ x: cssWidth, y: cssHeight }),
    screenToWorld({ x: 0, y: cssHeight })
  ];
}

function objectBounds(object) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of object.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const pad = object.size || 1;
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad
  };
}

function boundsCorners(bounds) {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];
}

function rangeFromValues(values, padding = REPEAT_PADDING) {
  return {
    min: Math.floor(Math.min(...values)) - padding,
    max: Math.ceil(Math.max(...values)) + padding
  };
}

function getViewportBasisRange() {
  const basis = viewportWorldCorners().map(worldToBasis).filter(Boolean);
  if (basis.length < 4) return null;

  return {
    u: rangeFromValues(basis.map(point => point.u)),
    v: rangeFromValues(basis.map(point => point.v))
  };
}

function getViewportProjectionRange(vector) {
  const vectorLength = length(vector);
  if (vectorLength < VECTOR_REPEAT_MIN_LENGTH) return { min: 0, max: 0 };

  const unit = scale(vector, 1 / vectorLength);
  const values = viewportWorldCorners().map(point => dot(point, unit) / vectorLength);
  return rangeFromValues(values);
}

function getObjectProjectionRange(object, vector) {
  const vectorLength = length(vector);
  if (vectorLength < VECTOR_REPEAT_MIN_LENGTH) return { min: 0, max: 0 };

  const unit = scale(vector, 1 / vectorLength);
  const values = boundsCorners(objectBounds(object)).map(point => dot(point, unit) / vectorLength);
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function getGridOffsets() {
  if (!surface.repeatV1 && !surface.repeatV2) return [{ i: 0, j: 0 }];

  if (surface.repeatV1 && surface.repeatV2) {
    const basisRange = getViewportBasisRange();
    if (!basisRange) return [{ i: 0, j: 0 }];

    return collectOffsets(basisRange.u.min, basisRange.u.max, basisRange.v.min, basisRange.v.max);
  }

  if (surface.repeatV1) {
    const range = getViewportProjectionRange(surface.v1);
    return collectOffsets(range.min, range.max, 0, 0);
  }

  const range = getViewportProjectionRange(surface.v2);
  return collectOffsets(0, 0, range.min, range.max);
}

function getObjectOffsets(object) {
  if (!surface.repeatV1 && !surface.repeatV2) return [{ i: 0, j: 0 }];

  if (surface.repeatV1 && surface.repeatV2) {
    const viewportRange = getViewportBasisRange();
    if (!viewportRange) return [{ i: 0, j: 0 }];

    const objectBasis = boundsCorners(objectBounds(object)).map(worldToBasis).filter(Boolean);
    if (objectBasis.length < 4) return [{ i: 0, j: 0 }];

    const objU = {
      min: Math.min(...objectBasis.map(point => point.u)),
      max: Math.max(...objectBasis.map(point => point.u))
    };
    const objV = {
      min: Math.min(...objectBasis.map(point => point.v)),
      max: Math.max(...objectBasis.map(point => point.v))
    };

    return collectOffsets(
      Math.floor(viewportRange.u.min - objU.max) - 1,
      Math.ceil(viewportRange.u.max - objU.min) + 1,
      Math.floor(viewportRange.v.min - objV.max) - 1,
      Math.ceil(viewportRange.v.max - objV.min) + 1
    );
  }

  if (surface.repeatV1) {
    const viewRange = getViewportProjectionRange(surface.v1);
    const objRange = getObjectProjectionRange(object, surface.v1);
    return collectOffsets(
      Math.floor(viewRange.min - objRange.max) - 1,
      Math.ceil(viewRange.max - objRange.min) + 1,
      0,
      0
    );
  }

  const viewRange = getViewportProjectionRange(surface.v2);
  const objRange = getObjectProjectionRange(object, surface.v2);
  return collectOffsets(
    0,
    0,
    Math.floor(viewRange.min - objRange.max) - 1,
    Math.ceil(viewRange.max - objRange.min) + 1
  );
}

function collectOffsets(iStart, iEnd, jStart, jEnd) {
  const offsets = [];
  for (let i = iStart; i <= iEnd; i++) {
    for (let j = jStart; j <= jEnd; j++) {
      offsets.push({ i, j });
    }
  }
  return offsets;
}

function setStatus(message, persistent = false) {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  status.textContent = message || "";

  if (message) {
    status.classList.add("visible");
    if (!persistent) {
      statusTimer = setTimeout(() => {
        status.classList.remove("visible");
      }, 2200);
    }
  } else {
    status.classList.remove("visible");
  }
}

function setDefaultStatus() {
  setStatus("");
}

function setWorldTransform() {

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(cssWidth / 2, cssHeight / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.x, -view.y);
}

function setScreenTransform() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawCoverImage(image) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const viewRatio = cssWidth / cssHeight;

  let drawWidth;
  let drawHeight;
  let x;
  let y;

  if (imageRatio > viewRatio) {
    drawHeight = cssHeight;
    drawWidth = drawHeight * imageRatio;
    x = (cssWidth - drawWidth) / 2;
    y = 0;
  } else {
    drawWidth = cssWidth;
    drawHeight = drawWidth / imageRatio;
    x = 0;
    y = (cssHeight - drawHeight) / 2;
  }

  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function clearScreen() {
  setScreenTransform();
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  if (background.image) {
    ctx.save();
    ctx.globalAlpha = 0.58;
    drawCoverImage(background.image);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255, 253, 248, 0.34)";
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.restore();
  }
}

function drawCell(offset) {
  const d = displacement(offset.i, offset.j);
  const p0 = d;
  const p1 = add(d, surface.v1);
  const p2 = add(add(d, surface.v1), surface.v2);
  const p3 = add(d, surface.v2);

  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.strokeStyle = background.image ? "rgba(0, 0, 0, 0.20)" : "rgba(0, 0, 0, 0.105)";
  ctx.lineWidth = Math.max(1 / view.zoom, 0.45);
  ctx.stroke();
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = background.image ? "rgba(0, 0, 0, 0.20)" : "rgba(0, 0, 0, 0.105)";
  ctx.lineWidth = Math.max(1 / view.zoom, 0.45);
  ctx.lineCap = "butt";

  if (surface.repeatV1 && surface.repeatV2) {
    const basisRange = getViewportBasisRange();
    if (!basisRange) {
      drawCell({ i: 0, j: 0 });
      ctx.restore();
      return;
    }

    const iStart = basisRange.u.min;
    const iEnd = basisRange.u.max;
    const jStart = basisRange.v.min;
    const jEnd = basisRange.v.max;

    ctx.beginPath();

    // Cell edges parallel to v2.
    for (let i = iStart; i <= iEnd; i++) {
      const from = displacement(i, jStart);
      const to = displacement(i, jEnd);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }

    // Cell edges parallel to v1.
    for (let j = jStart; j <= jEnd; j++) {
      const from = displacement(iStart, j);
      const to = displacement(iEnd, j);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }

    ctx.stroke();
    ctx.restore();
    return;
  }

  if (surface.repeatV1) {
    const range = getViewportProjectionRange(surface.v1);
    for (let i = range.min; i <= range.max; i++) {
      drawCell({ i, j: 0 });
    }
    ctx.restore();
    return;
  }

  if (surface.repeatV2) {
    const range = getViewportProjectionRange(surface.v2);
    for (let j = range.min; j <= range.max; j++) {
      drawCell({ i: 0, j });
    }
    ctx.restore();
    return;
  }

  drawCell({ i: 0, j: 0 });
  ctx.restore();
}

function pressureScale(point) {
  const pressure = Number.isFinite(point.pressure) ? point.pressure : 0.5;
  return 0.9 + pressure * 0.2;
}

function midPoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    pressure: ((Number.isFinite(a.pressure) ? a.pressure : 0.5) + (Number.isFinite(b.pressure) ? b.pressure : 0.5)) / 2
  };
}

function drawPenStroke(object) {
  const points = object.points;
  if (points.length < 2) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const previous = points[Math.max(0, i - 1)];
    const start = i === 0 ? current : midPoint(previous, current);
    const end = i === points.length - 2 ? next : midPoint(current, next);
    const widthPoint = midPoint(current, next);

    ctx.lineWidth = object.size * pressureScale(widthPoint);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(current.x, current.y, end.x, end.y);
    ctx.stroke();
  }
}

function drawObject(object, offset = { i: 0, j: 0 }, preview = false) {
  if (!object || object.points.length < 2) return;

  const d = displacement(offset.i, offset.j);

  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.strokeStyle = object.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (preview) {
    ctx.globalAlpha = 0.72;
  }

  if (object.type === "pen") {
    drawPenStroke(object);
    ctx.restore();
    return;
  }

  ctx.lineWidth = object.size;
  ctx.beginPath();
  ctx.moveTo(object.points[0].x, object.points[0].y);
  for (let i = 1; i < object.points.length; i++) {
    ctx.lineTo(object.points[i].x, object.points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawWorld(preview = null) {
  if (!hideGridInput.checked) {
    drawGrid();
  }

  for (const object of objects) {
    for (const offset of getObjectOffsets(object)) {
      drawObject(object, offset);
    }
  }

  if (preview) {
    for (const offset of getObjectOffsets(preview)) {
      drawObject(preview, offset, true);
    }
  }
}

function redraw(preview = null) {
  clearScreen();
  setWorldTransform();
  drawWorld(preview);
  setScreenTransform();
}

function addObject(object) {
  const savedObject = cloneObject(object);
  objects.push(savedObject);

  undoStack.push({
    type: "add",
    object: cloneObject(savedObject)
  });

  redoStack = [];
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
}

function undo() {
  if (undoStack.length === 0) return;
  const action = undoStack.pop();

  if (action.type === "add") {
    objects = objects.filter(object => object.id !== action.object.id);
  }

  if (action.type === "clear") {
    objects = cloneObjects(action.before);
  }

  if (action.type === "replaceAll") {
    objects = cloneObjects(action.before);
  }

  redoStack.push(action);
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
}

function redo() {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();

  if (action.type === "add") {
    objects.push(cloneObject(action.object));
  }

  if (action.type === "clear") {
    objects = [];
  }

  if (action.type === "replaceAll") {
    objects = cloneObjects(action.after);
  }

  undoStack.push(action);
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
}

function lineDataFromModifiers(center, pointer, event) {
  let delta = sub(pointer, center);
  let angleDegrees = null;

  if (event.shiftKey) {
    const segmentLength = Math.hypot(delta.x, delta.y);
    const angle = Math.atan2(delta.y, delta.x);
    const snapped = Math.round(angle / SNAP_STEP_RADIANS) * SNAP_STEP_RADIANS;
    delta = {
      x: Math.cos(snapped) * segmentLength,
      y: Math.sin(snapped) * segmentLength
    };
    angleDegrees = ((Math.round(snapped * 180 / Math.PI) % 360) + 360) % 360;
  }

  const points = event.altKey
    ? [sub(center, delta), add(center, delta)]
    : [center, add(center, delta)];

  return { points, angleDegrees };
}

function showAngleHint(screenPoint, angleDegrees) {
  if (angleDegrees === null || angleDegrees === undefined) {
    hideAngleHint();
    return;
  }
  angleHint.textContent = `${angleDegrees}°`;
  angleHint.style.left = `${screenPoint.x}px`;
  angleHint.style.top = `${screenPoint.y}px`;
  angleHint.classList.add("visible");
}

function hideAngleHint() {
  angleHint.classList.remove("visible");
}

function setEraserMode(nextMode) {
  eraserMode = nextMode;
  eraseObjectButton.classList.toggle("active", eraserMode === "object");
  eraseRubButton.classList.toggle("active", eraserMode === "rub");
}

function distanceToSegment(point, a, b) {
  const ab = sub(b, a);
  const ap = sub(point, a);
  const ab2 = ab.x * ab.x + ab.y * ab.y;
  if (ab2 === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp((ap.x * ab.x + ap.y * ab.y) / ab2, 0, 1);
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function hitObject(object, point, radius) {
  const threshold = radius + (object.size || 1) / 2;
  for (let i = 1; i < object.points.length; i++) {
    if (distanceToSegment(point, object.points[i - 1], object.points[i]) <= threshold) {
      return true;
    }
  }
  return false;
}

function densifyPoints(points, maxStep = 6) {
  if (points.length < 2) return points.map(point => ({ ...point }));
  const dense = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(distance / maxStep));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      dense.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        pressure: (Number.isFinite(a.pressure) ? a.pressure : 0.5) + ((Number.isFinite(b.pressure) ? b.pressure : 0.5) - (Number.isFinite(a.pressure) ? a.pressure : 0.5)) * t
      });
    }
  }
  return dense;
}

function splitObjectByEraser(object, point, radius) {
  const samples = densifyPoints(object.points, Math.max(4, (object.size || 1) / 2));
  const threshold = radius + (object.size || 1) * 0.55;
  let changed = false;
  const chunks = [];
  let current = [];

  for (const sample of samples) {
    const remove = Math.hypot(sample.x - point.x, sample.y - point.y) <= threshold;
    if (remove) {
      changed = true;
      if (current.length >= 2) chunks.push(current);
      current = [];
    } else {
      current.push(sample);
    }
  }

  if (current.length >= 2) chunks.push(current);
  if (!changed) return { changed: false, objects: [object] };

  return {
    changed: true,
    objects: chunks.map(chunk => ({
      ...object,
      id: nextObjectId++,
      type: "pen",
      points: chunk.map(sample => ({ ...sample }))
    }))
  };
}

function eraserRadius() {
  return Math.max(10 / view.zoom, (Number(sizeInput.value) || 4) / 2);
}

function localPointForHit(object, worldPoint, radius) {
  for (const offset of getObjectOffsets(object)) {
    const d = displacement(offset.i, offset.j);
    const localPoint = sub(worldPoint, d);
    if (hitObject(object, localPoint, radius)) {
      return localPoint;
    }
  }
  return null;
}

function applyEraserAt(point) {
  const radius = eraserRadius();
  let changed = false;

  if (eraserMode === "object") {
    const nextObjects = objects.filter(object => localPointForHit(object, point, radius) === null);
    changed = nextObjects.length !== objects.length;
    if (changed) objects = nextObjects;
  } else {
    const nextObjects = [];
    for (const object of objects) {
      const localPoint = localPointForHit(object, point, radius);
      if (!localPoint) {
        nextObjects.push(object);
        continue;
      }

      const result = splitObjectByEraser(object, localPoint, radius);
      if (result.changed) changed = true;
      nextObjects.push(...result.objects);
    }
    if (changed) objects = nextObjects;
  }

  if (changed) {
    eraseChanged = true;
    requestRender();
  }
}

function commitEraseIfNeeded() {
  if (!eraseChanged || !eraseBeforeObjects) return;
  undoStack.push({
    type: "replaceAll",
    before: eraseBeforeObjects,
    after: cloneObjects(objects)
  });
  redoStack = [];
  updateHistoryButtons();
  scheduleAutosave();
}

function startDrawing(event) {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);

  const screenPoint = pointFromEvent(event);

  if (tool === "pan" || spaceIsDown) {
    isPanning = true;
    panStart = screenPoint;
    viewStart = { ...view };
    canvas.classList.add("active-pan");
    return;
  }

  if (tool === "erase") {
    isDrawing = true;
    eraseBeforeObjects = cloneObjects(objects);
    eraseChanged = false;
    applyEraserAt(screenToWorld(screenPoint));
    return;
  }

  isDrawing = true;
  startPoint = worldPointFromEvent(event);
  lastPoint = startPoint;

  currentObject = {
    id: nextObjectId++,
    type: tool,
    points: [startPoint],
    ...currentStyle()
  };
}

function continueDrawing(event) {
  const screenPoint = pointFromEvent(event);

  if (isPanning && panStart && viewStart) {
    event.preventDefault();
    const dx = (screenPoint.x - panStart.x) / view.zoom;
    const dy = (screenPoint.y - panStart.y) / view.zoom;
    view.x = viewStart.x - dx;
    view.y = viewStart.y - dy;
    requestRender();
    return;
  }

  if (!isDrawing) return;
  event.preventDefault();

  if (tool === "erase") {
    applyEraserAt(screenToWorld(screenPoint));
    return;
  }

  if (!currentObject) return;

  const point = worldPointFromEvent(event);

  if (tool === "pen") {
    currentObject.points.push(point);
    lastPoint = point;
    hideAngleHint();
    requestRenderWithPreview(currentObject);
  }

  if (tool === "line") {
    const lineData = lineDataFromModifiers(startPoint, point, event);
    const preview = {
      ...currentObject,
      points: lineData.points
    };
    showAngleHint(screenPoint, lineData.angleDegrees);
    requestRenderWithPreview(preview);
  }
}

function requestRenderWithPreview(preview) {
  previewObject = preview;
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    clearScreen();
    setWorldTransform();
    drawWorld(previewObject);
    setScreenTransform();
  });
}

function stopDrawing(event) {
  if (isPanning) {
    event.preventDefault();
    isPanning = false;
    panStart = null;
    viewStart = null;
    canvas.classList.remove("active-pan");
    return;
  }

  if (!isDrawing) return;
  event.preventDefault();
  isDrawing = false;

  if (tool === "erase") {
    commitEraseIfNeeded();
    eraseBeforeObjects = null;
    eraseChanged = false;
    requestRender();
    return;
  }

  if (!currentObject) return;

  const endPoint = worldPointFromEvent(event);

  if (tool === "line") {
    currentObject.points = lineDataFromModifiers(startPoint, endPoint, event).points;
  }

  if (currentObject.points.length >= 2 && objectDistance(currentObject) > 0.5) {
    addObject(currentObject);
  } else {
    requestRender();
  }

  hideAngleHint();
  previewObject = null;
  currentObject = null;
  startPoint = null;
  lastPoint = null;
}

function objectDistance(object) {
  if (object.points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < object.points.length; i++) {
    total += Math.hypot(object.points[i].x - object.points[i - 1].x, object.points[i].y - object.points[i - 1].y);
  }
  return total;
}

function clearDrawing() {
  if (objects.length === 0) return;

  undoStack.push({
    type: "clear",
    before: cloneObjects(objects)
  });

  objects = [];
  redoStack = [];
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
}

function setZoom(nextZoom, anchorScreen = { x: cssWidth / 2, y: cssHeight / 2 }) {
  const oldWorld = screenToWorld(anchorScreen);
  view.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const newWorld = screenToWorld(anchorScreen);

  view.x += oldWorld.x - newWorld.x;
  view.y += oldWorld.y - newWorld.y;

  syncZoomSlider();
  requestRender();
}

function zoomToSliderValue(zoom) {
  const t = (Math.log(zoom) - Math.log(MIN_ZOOM)) / (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM));
  return Math.round(clamp(t, 0, 1) * 100);
}

function sliderValueToZoom(value) {
  const t = clamp(Number(value) / 100, 0, 1);
  return Math.exp(Math.log(MIN_ZOOM) + t * (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM)));
}

function syncZoomSlider() {
  zoomSlider.value = String(zoomToSliderValue(view.zoom));
}

function centerView() {
  const center = add(scale(surface.v1, 0.5), scale(surface.v2, 0.5));
  view.x = center.x;
  view.y = center.y;
  requestRender();
}

function fitCellToView() {
  const corners = [
    { x: 0, y: 0 },
    surface.v1,
    surface.v2,
    add(surface.v1, surface.v2)
  ];
  const minX = Math.min(...corners.map(point => point.x));
  const maxX = Math.max(...corners.map(point => point.x));
  const minY = Math.min(...corners.map(point => point.y));
  const maxY = Math.max(...corners.map(point => point.y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  view.x = (minX + maxX) / 2;
  view.y = (minY + maxY) / 2;
  view.zoom = clamp(Math.min(cssWidth / (width * 1.18), cssHeight / (height * 1.18)), MIN_ZOOM, MAX_ZOOM);
  syncZoomSlider();
  setStatus("Cell fitted.");
  requestRender();
}

function writeSurfaceToControls(value = surface) {
  a1Input.value = Math.round(value.v1.x);
  b1Input.value = Math.round(value.v1.y);
  a2Input.value = Math.round(value.v2.x);
  b2Input.value = Math.round(value.v2.y);
  repeatV1Input.checked = value.repeatV1;
  repeatV2Input.checked = value.repeatV2;
}

function readSurfaceFromControls() {
  return {
    v1: {
      x: Number(a1Input.value) || 0,
      y: Number(b1Input.value) || 0
    },
    v2: {
      x: Number(a2Input.value) || 0,
      y: Number(b2Input.value) || 0
    },
    repeatV1: repeatV1Input.checked,
    repeatV2: repeatV2Input.checked
  };
}

function validateSurface(next) {
  if (next.repeatV1 && length(next.v1) < VECTOR_REPEAT_MIN_LENGTH) {
    return "v1 is enabled, so it needs a non-zero displacement.";
  }

  if (next.repeatV2 && length(next.v2) < VECTOR_REPEAT_MIN_LENGTH) {
    return "v2 is enabled, so it needs a non-zero displacement.";
  }

  if (next.repeatV1 && next.repeatV2) {
    const det = next.v1.x * next.v2.y - next.v1.y * next.v2.x;
    if (Math.abs(det) < DET_MIN) {
      return "For a torus, v1 and v2 cannot be parallel or almost identical.";
    }
  }

  return null;
}

function clearForSurfaceChange() {
  objects = [];
  undoStack = [];
  redoStack = [];
  nextObjectId = 1;
  updateHistoryButtons();
}

function applySurface(next, message = "Surface updated.") {
  const error = validateSurface(next);

  if (error) {
    setStatus(error);
    writeSurfaceToControls(surface);
    return false;
  }

  const surfaceWillChange = !surfacesEqual(next, surface);
  if (!surfaceWillChange) {
    writeSurfaceToControls(surface);
    return true;
  }

  if (objects.length > 0) {
    const proceed = window.confirm(
      "Changing the surface clears the existing drawing so old strokes do not end up on the wrong torus/cylinder. Continue?"
    );

    if (!proceed) {
      writeSurfaceToControls(surface);
      setStatus("Surface unchanged.");
      return false;
    }

    clearForSurfaceChange();
  }

  surface = cloneSurface(next);
  writeSurfaceToControls(surface);
  centerView();
  setStatus(message);
  scheduleAutosave();
  requestRender();
  return true;
}

function applySurfaceFromControls() {
  applySurface(readSurfaceFromControls(), "Surface updated.");
}

function resetSurfaceFields() {
  const previousHideGrid = hideGridInput.checked;
  const applied = applySurface(cloneSurface(DEFAULT_SURFACE), "Surface reset.");

  if (applied) {
    hideGridInput.checked = DEFAULT_HIDE_GRID;
    requestRender();
    scheduleAutosave();
  } else {
    hideGridInput.checked = previousHideGrid;
  }
}

function setBackgroundFromDataUrl(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) {
      background = {
        image: null,
        dataUrl: null,
        naturalWidth: 1,
        naturalHeight: 1
      };
      resolve();
      return;
    }

    const image = new Image();
    image.onload = () => {
      background = {
        image,
        dataUrl,
        naturalWidth: image.naturalWidth || 1,
        naturalHeight: image.naturalHeight || 1
      };
      resolve();
    };
    image.onerror = () => resolve();
    image.src = dataUrl;
  });
}

function loadBackground(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    await setBackgroundFromDataUrl(reader.result);
    setStatus("Background added.");
    scheduleAutosave();
    requestRender();
  };
  reader.readAsDataURL(file);
}

function removeBackground(skipStatus = false) {
  background = {
    image: null,
    dataUrl: null,
    naturalWidth: 1,
    naturalHeight: 1
  };
  backgroundInput.value = "";
  if (!skipStatus) setStatus("Background removed.");
  scheduleAutosave();
  requestRender();
}

function serializeProject() {
  return {
    version: 3,
    surface: cloneSurface(surface),
    hideGrid: hideGridInput.checked,
    view: { ...view },
    objects: cloneObjects(objects),
    nextObjectId,
    color: colorInput.value,
    size: sizeInput.value,
    backgroundDataUrl: background.dataUrl || null
  };
}

async function restoreProject(data, silent = false) {
  if (!data || !data.surface || !Array.isArray(data.objects)) {
    setStatus("Could not open project file.");
    return;
  }

  surface = cloneSurface(data.surface);
  objects = cloneObjects(data.objects);
  nextObjectId = Number(data.nextObjectId) || (objects.reduce((maxId, object) => Math.max(maxId, object.id || 0), 0) + 1);
  view = data.view && Number.isFinite(data.view.zoom) ? { ...data.view } : { x: 300, y: 210, zoom: 0.9 };
  colorInput.value = data.color || "#111111";
  sizeInput.value = data.size || "4";
  hideGridInput.checked = Boolean(data.hideGrid);
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
  writeSurfaceToControls(surface);
  syncZoomSlider();
  await setBackgroundFromDataUrl(data.backgroundDataUrl || null);
  requestRender();
  if (!silent) setStatus("Project opened.");
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject()));
    } catch (error) {
      // Large background images can exceed browser storage limits. Manual save still works.
    }
  }, 250);
}

async function restoreAutosave() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    const data = JSON.parse(saved);
    await restoreProject(data, true);
    loadedAutosave = true;
    setStatus("Restored previous drawing.");
    return true;
  } catch (error) {
    return false;
  }
}

function saveProject() {
  const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "torus-drawing.torusdraw";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Project saved.");
}

function openProjectFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      await restoreProject(data);
      scheduleAutosave();
    } catch (error) {
      setStatus("Could not open project file.");
    }
    projectInput.value = "";
  };
  reader.readAsText(file);
}

function exportPNG() {
  redraw();
  canvas.toBlob(blob => {
    if (!blob) {
      setStatus("Export failed.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "torus-drawing.png";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("PNG exported.");
  }, "image/png");
}

function handleWheel(event) {
  event.preventDefault();

  const point = pointFromEvent(event);
  const zoomFactor = Math.exp(-event.deltaY * 0.0018);
  setZoom(view.zoom * zoomFactor, point);
}

function editingTextField(event) {
  const element = event.target;
  return element && ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) && element.type !== "checkbox" && element.type !== "color";
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  const cmd = event.ctrlKey || event.metaKey;

  if (key === " " && !spaceIsDown && !editingTextField(event)) {
    event.preventDefault();
    spaceIsDown = true;
    canvas.classList.add("panning");
  }

  const isUndo = cmd && key === "z" && !event.shiftKey;
  const isRedo = cmd && (key === "y" || (event.shiftKey && key === "z"));

  if (cmd && key === "s") {
    event.preventDefault();
    saveProject();
    return;
  }

  if (isRedo) {
    event.preventDefault();
    redo();
    return;
  }

  if (isUndo) {
    event.preventDefault();
    undo();
    return;
  }

  if (editingTextField(event) || cmd || event.altKey) return;

  if (key === "1" || key === "p") {
    event.preventDefault();
    chooseTool("pen");
  } else if (key === "2" || key === "l") {
    event.preventDefault();
    chooseTool("line");
  } else if (key === "4" || key === "e") {
    event.preventDefault();
    chooseTool("erase");
  } else if (key === "3" || key === "v") {
    event.preventDefault();
    chooseTool("pan");
  } else if (key === "+" || key === "=") {
    event.preventDefault();
    setZoom(view.zoom * 1.18);
  } else if (key === "-" || key === "_") {
    event.preventDefault();
    setZoom(view.zoom / 1.18);
  } else if (key === "0") {
    event.preventDefault();
    centerView();
  } else if (key === "f") {
    event.preventDefault();
    fitCellToView();
  } else if (key === "c") {
    event.preventDefault();
    clearDrawing();
  } else if (key === "g") {
    event.preventDefault();
    geometryPanel.classList.toggle("open");
  } else if (key === "u") {
    event.preventDefault();
    applySurfaceFromControls();
  } else if (key === "h") {
    event.preventDefault();
    hideGridInput.checked = !hideGridInput.checked;
    setStatus(hideGridInput.checked ? "Grid hidden." : "Grid shown.");
    scheduleAutosave();
    requestRender();
  } else if (key === "i") {
    event.preventDefault();
    backgroundInput.click();
  } else if (key === "?" || (event.shiftKey && key === "/")) {
    event.preventDefault();
    helpPanel.classList.toggle("open");
  } else if (key === "escape") {
    geometryPanel.classList.remove("open");
    helpPanel.classList.remove("open");
    hideAngleHint();
  }
}

function handleKeyUp(event) {
  if (event.key === " ") {
    spaceIsDown = false;
    canvas.classList.toggle("panning", tool === "pan");
  }
}

penButton.addEventListener("click", () => chooseTool("pen"));
lineButton.addEventListener("click", () => chooseTool("line"));
eraseButton.addEventListener("click", () => chooseTool("erase"));
panButton.addEventListener("click", () => chooseTool("pan"));
eraseObjectButton.addEventListener("click", () => setEraserMode("object"));
eraseRubButton.addEventListener("click", () => setEraserMode("rub"));
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
clearButton.addEventListener("click", clearDrawing);

repeatV1Input.addEventListener("change", () => setStatus("Repeat setting changed in the fields. Click Update surface to apply."));
repeatV2Input.addEventListener("change", () => setStatus("Repeat setting changed in the fields. Click Update surface to apply."));
hideGridInput.addEventListener("change", () => {
  setStatus(hideGridInput.checked ? "Grid hidden." : "Grid shown.");
  scheduleAutosave();
  requestRender();
});

geometryButton.addEventListener("click", () => {
  geometryPanel.classList.toggle("open");
});

helpButton.addEventListener("click", () => {
  helpPanel.classList.toggle("open");
});

resetGeometryButton.addEventListener("click", resetSurfaceFields);
centerViewButton.addEventListener("click", centerView);
fitCellButton.addEventListener("click", fitCellToView);
updateSurfaceButton.addEventListener("click", applySurfaceFromControls);
backgroundInput.addEventListener("change", event => loadBackground(event.target.files[0]));
removeBackgroundButton.addEventListener("click", () => removeBackground());
exportButton.addEventListener("click", exportPNG);
saveProjectButton.addEventListener("click", saveProject);
projectInput.addEventListener("change", event => openProjectFile(event.target.files[0]));

zoomSlider.addEventListener("input", () => setZoom(sliderValueToZoom(zoomSlider.value)));
zoomInButton.addEventListener("click", () => setZoom(view.zoom * 1.18));
zoomOutButton.addEventListener("click", () => setZoom(view.zoom / 1.18));

canvas.addEventListener("pointerdown", startDrawing);
canvas.addEventListener("pointermove", continueDrawing);
canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);
canvas.addEventListener("wheel", handleWheel, { passive: false });

document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", handleKeyUp);
window.addEventListener("resize", resizeCanvas);

writeSurfaceToControls();
hideGridInput.checked = DEFAULT_HIDE_GRID;
syncZoomSlider();
updateHistoryButtons();
setDefaultStatus();
resizeCanvas();
chooseTool("pen");
setEraserMode("object");
restoreAutosave();
