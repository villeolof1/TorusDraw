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
const imageButton = document.getElementById("imageButton");
const imagePanel = document.getElementById("imagePanel");
const imageCloseButton = document.getElementById("imageCloseButton");
const imageSummary = document.getElementById("imageSummary");
const backgroundInput = document.getElementById("backgroundInput");
const removeBackgroundButton = document.getElementById("removeBackgroundButton");
const resetGeometryButton = document.getElementById("resetGeometryButton");
const centerViewButton = document.getElementById("centerViewButton");
const updateSurfaceButton = document.getElementById("updateSurfaceButton");
const fitCellButton = document.getElementById("fitCellButton");
const fitSurfaceToImageButton = document.getElementById("fitSurfaceToImageButton");
const imageCropButton = document.getElementById("imageCropButton");
const imageStretchButton = document.getElementById("imageStretchButton");
const imageManualButton = document.getElementById("imageManualButton");
const imageOpacityInput = document.getElementById("imageOpacityInput");
const imageOpacityValue = document.getElementById("imageOpacityValue");
const editImagePlacementButton = document.getElementById("editImagePlacementButton");
const placementPanel = document.getElementById("placementPanel");
const imageKeepAspectInput = document.getElementById("imageKeepAspectInput");
const cancelPlacementButton = document.getElementById("cancelPlacementButton");
const donePlacementButton = document.getElementById("donePlacementButton");
const exportButton = document.getElementById("exportButton");
const saveProjectButton = document.getElementById("saveProjectButton");
const projectInput = document.getElementById("projectInput");
const zoomSlider = document.getElementById("zoomSlider");
const zoomInButton = document.getElementById("zoomInButton");
const zoomOutButton = document.getElementById("zoomOutButton");
const status = document.getElementById("status");
const helpButton = document.getElementById("helpButton");
const helpPanel = document.getElementById("helpPanel");
const shapeButton = document.getElementById("shapeButton");
const shapePanel = document.getElementById("shapePanel");
const shapeCloseButton = document.getElementById("shapeCloseButton");
const shapeCanvas = document.getElementById("shapeCanvas");
const shapeCtx = shapeCanvas.getContext("2d");
const shapeSummary = document.getElementById("shapeSummary");
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
const STORAGE_KEY = "torus-drawing-app.autosave.v4";
const SNAP_STEP_RADIANS = Math.PI / 12;
const DEFAULT_HIDE_GRID = false;
const DEFAULT_DRAW_SIZE = 4;
const DEFAULT_ERASER_SIZE = 10;
const DEFAULT_IMAGE_FIT_MODE = "crop";
const DEFAULT_IMAGE_OPACITY = 0.76;
const DEFAULT_IMAGE_PLACEMENT = { x: 0, y: 0, width: 1, height: 1, keepAspect: true };
const FIT_IMAGE_LONG_SIDE = 650;
const MAX_CELL_IMAGE_COPIES = 2200;
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
let drawingSize = DEFAULT_DRAW_SIZE;
let eraserSize = DEFAULT_ERASER_SIZE;

let view = {
  x: 300,
  y: 210,
  zoom: 0.9
};

let surface = cloneSurface(DEFAULT_SURFACE);
let imageFitMode = DEFAULT_IMAGE_FIT_MODE;
let imageOpacity = DEFAULT_IMAGE_OPACITY;
let imagePlacement = { ...DEFAULT_IMAGE_PLACEMENT };
let placementEditor = {
  active: false,
  draft: null,
  before: null,
  action: null,
  startBasis: null,
  startPlacement: null
};

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
let shapeView = { yaw: -0.72, pitch: 0.45, zoom: 1.0 };
let shapeDrag = null;

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
    if (shapePanel.classList.contains("open")) renderShapePreview();
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

function normalizedSize(value, fallback = 1) {
  return clamp(Number(value) || fallback, 1, 300);
}

function storeVisibleSize() {
  const value = normalizedSize(sizeInput.value, tool === "erase" ? eraserSize : drawingSize);
  if (tool === "erase") {
    eraserSize = value;
  } else {
    drawingSize = value;
  }
}

function syncSizeInputForTool() {
  sizeInput.value = String(Math.round((tool === "erase" ? eraserSize : drawingSize) * 10) / 10);
}

function currentStyle() {
  return {
    color: colorInput.value,
    size: drawingSize
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
  storeVisibleSize();
  tool = newTool;
  penButton.classList.toggle("active", tool === "pen");
  lineButton.classList.toggle("active", tool === "line");
  eraseButton.classList.toggle("active", tool === "erase");
  panButton.classList.toggle("active", tool === "pan");
  eraserOptions.hidden = tool !== "erase";
  canvas.classList.toggle("panning", tool === "pan" || spaceIsDown);
  syncSizeInputForTool();
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

function clearScreen() {
  setScreenTransform();
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
}

function cellCorners(offset) {
  const d = displacement(offset.i, offset.j);
  return [
    d,
    add(d, surface.v1),
    add(add(d, surface.v1), surface.v2),
    add(d, surface.v2)
  ];
}

function clipToCell(offset) {
  const corners = cellCorners(offset);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.closePath();
  ctx.clip();
}

function imageSourceCrop() {
  const image = background.image;
  const imageWidth = background.naturalWidth || image.naturalWidth || 1;
  const imageHeight = background.naturalHeight || image.naturalHeight || 1;

  const cellWidth = length(surface.v1);
  const cellHeight = length(surface.v2);
  if (cellWidth < VECTOR_REPEAT_MIN_LENGTH || cellHeight < VECTOR_REPEAT_MIN_LENGTH) return null;

  if (imageFitMode === "stretch" || imageFitMode === "manual") {
    return { sx: 0, sy: 0, sw: imageWidth, sh: imageHeight };
  }

  const cellAspect = cellWidth / cellHeight;
  const imageAspect = imageWidth / imageHeight;

  if (imageAspect > cellAspect) {
    const sw = imageHeight * cellAspect;
    return { sx: (imageWidth - sw) / 2, sy: 0, sw, sh: imageHeight };
  }

  const sh = imageWidth / cellAspect;
  return { sx: 0, sy: (imageHeight - sh) / 2, sw: imageWidth, sh };
}

function drawCellImage(offset) {
  if (!background.image) return;
  const d = displacement(offset.i, offset.j);
  const crop = imageSourceCrop();
  if (!crop) return;

  ctx.save();
  clipToCell(offset);
  ctx.globalAlpha = imageOpacity;
  ctx.translate(d.x, d.y);
  ctx.transform(surface.v1.x, surface.v1.y, surface.v2.x, surface.v2.y, 0, 0);

  if (imageFitMode === "manual") {
    ctx.drawImage(
      background.image,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      imagePlacement.x,
      imagePlacement.y,
      imagePlacement.width,
      imagePlacement.height
    );
  } else {
    ctx.drawImage(background.image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, 1, 1);
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255, 253, 248, 0.09)";
  ctx.fillRect(0, 0, 1, 1);
  ctx.restore();
}

function basisToWorld(point) {
  return add(scale(surface.v1, point.u), scale(surface.v2, point.v));
}

function drawPlacementOverlay() {
  if (!placementEditor.active || !background.image) return;
  const p = placementEditor.draft || imagePlacement;
  const corners = [
    basisToWorld({ u: 0, v: 0 }),
    basisToWorld({ u: 1, v: 0 }),
    basisToWorld({ u: 1, v: 1 }),
    basisToWorld({ u: 0, v: 1 })
  ];
  const rect = [
    basisToWorld({ u: p.x, v: p.y }),
    basisToWorld({ u: p.x + p.width, v: p.y }),
    basisToWorld({ u: p.x + p.width, v: p.y + p.height }),
    basisToWorld({ u: p.x, v: p.y + p.height })
  ];

  ctx.save();
  ctx.lineWidth = Math.max(2 / view.zoom, 0.9);
  ctx.strokeStyle = "rgba(31,31,31,0.72)";
  ctx.setLineDash([8 / view.zoom, 6 / view.zoom]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.closePath();
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(31,31,31,0.92)";
  ctx.beginPath();
  ctx.moveTo(rect[0].x, rect[0].y);
  ctx.lineTo(rect[1].x, rect[1].y);
  ctx.lineTo(rect[2].x, rect[2].y);
  ctx.lineTo(rect[3].x, rect[3].y);
  ctx.closePath();
  ctx.stroke();

  const handle = rect[2];
  const r = Math.max(7 / view.zoom, 3.5);
  ctx.fillStyle = "rgba(31,31,31,0.92)";
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function collectImageOffsets(iStart, iEnd, jStart, jEnd) {
  const width = Math.max(0, iEnd - iStart + 1);
  const height = Math.max(0, jEnd - jStart + 1);
  if (width * height > MAX_CELL_IMAGE_COPIES) return null;
  return collectOffsets(iStart, iEnd, jStart, jEnd);
}

function getCellImageOffsets() {
  if (!surface.repeatV1 && !surface.repeatV2) return [{ i: 0, j: 0 }];

  if (surface.repeatV1 && surface.repeatV2) {
    const basisRange = getViewportBasisRange();
    if (!basisRange) return [{ i: 0, j: 0 }];
    return collectImageOffsets(basisRange.u.min, basisRange.u.max, basisRange.v.min, basisRange.v.max);
  }

  if (surface.repeatV1) {
    const range = getViewportProjectionRange(surface.v1);
    return collectImageOffsets(range.min, range.max, 0, 0);
  }

  const range = getViewportProjectionRange(surface.v2);
  return collectImageOffsets(0, 0, range.min, range.max);
}

function drawImageFallbackForTinyCells() {
  ctx.save();
  ctx.globalAlpha = 0.18;
  const corners = viewportWorldCorners();
  const minX = Math.min(...corners.map(point => point.x));
  const maxX = Math.max(...corners.map(point => point.x));
  const minY = Math.min(...corners.map(point => point.y));
  const maxY = Math.max(...corners.map(point => point.y));
  ctx.drawImage(background.image, minX, minY, maxX - minX, maxY - minY);
  ctx.restore();
}

function drawCellImages() {
  if (!background.image) return;
  const offsets = getCellImageOffsets();

  if (!offsets) {
    drawImageFallbackForTinyCells();
    return;
  }

  for (const offset of offsets) {
    drawCellImage(offset);
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
  drawCellImages();

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

  drawPlacementOverlay();
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
  return Math.max(0.5, eraserSize) / 2;
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

function placementPointFromEvent(event) {
  const basis = worldToBasis(screenToWorld(pointFromEvent(event)));
  if (!basis) return null;
  return { u: basis.u, v: basis.v };
}

function placementHandleDistance(point, placement) {
  const handle = { u: placement.x + placement.width, v: placement.y + placement.height };
  return Math.hypot(point.u - handle.u, point.v - handle.v);
}

function placementContains(point, placement) {
  const minU = Math.min(placement.x, placement.x + placement.width);
  const maxU = Math.max(placement.x, placement.x + placement.width);
  const minV = Math.min(placement.y, placement.y + placement.height);
  const maxV = Math.max(placement.y, placement.y + placement.height);
  return point.u >= minU && point.u <= maxU && point.v >= minV && point.v <= maxV;
}

function startImagePlacement() {
  if (!background.image) {
    setStatus("Upload an image first.");
    return;
  }
  setImageFitMode("manual", false);
  placementEditor.active = true;
  placementEditor.draft = { ...imagePlacement };
  placementEditor.before = { ...imagePlacement };
  placementEditor.action = null;
  placementPanel.classList.add("open");
  imagePanel.classList.add("open");
  setStatus("Drag image to move it. Drag the corner dot to resize.", true);
  requestRender();
}

function stopImagePlacement(commit) {
  if (!placementEditor.active) return;
  if (commit && placementEditor.draft) {
    imagePlacement = { ...placementEditor.draft, keepAspect: imageKeepAspectInput.checked };
    setImageFitMode("manual", false);
    setStatus("Image placement updated.");
    scheduleAutosave();
  } else if (!commit && placementEditor.before) {
    imagePlacement = { ...placementEditor.before };
    setStatus("Image placement cancelled.");
  }
  placementEditor.active = false;
  placementEditor.draft = null;
  placementEditor.before = null;
  placementEditor.action = null;
  placementPanel.classList.remove("open");
  setStatus(commit ? "Image placement updated." : "Image placement cancelled.");
  updateImagePanelState();
  requestRender();
}

function startPlacementDrag(event) {
  const point = placementPointFromEvent(event);
  if (!point || !placementEditor.active || !placementEditor.draft) return false;
  const draft = placementEditor.draft;
  const handleThreshold = 0.055;
  if (placementHandleDistance(point, draft) < handleThreshold) {
    placementEditor.action = "resize";
  } else if (placementContains(point, draft)) {
    placementEditor.action = "move";
  } else {
    placementEditor.action = "move";
    draft.x = point.u - draft.width / 2;
    draft.y = point.v - draft.height / 2;
  }
  placementEditor.startBasis = point;
  placementEditor.startPlacement = { ...draft };
  requestRender();
  return true;
}

function continuePlacementDrag(event) {
  if (!placementEditor.active || !placementEditor.action || !placementEditor.startBasis || !placementEditor.startPlacement) return false;
  const point = placementPointFromEvent(event);
  if (!point) return true;
  const start = placementEditor.startBasis;
  const before = placementEditor.startPlacement;
  const draft = placementEditor.draft;
  const du = point.u - start.u;
  const dv = point.v - start.v;

  if (placementEditor.action === "move") {
    draft.x = before.x + du;
    draft.y = before.y + dv;
  } else {
    let width = Math.max(0.04, before.width + du);
    let height = Math.max(0.04, before.height + dv);
    if (imageKeepAspectInput.checked) {
      const aspect = Math.max(0.05, Math.abs(before.width / before.height));
      const signW = width < 0 ? -1 : 1;
      const signH = height < 0 ? -1 : 1;
      if (Math.abs(du) > Math.abs(dv)) {
        height = Math.abs(width) / aspect * signH;
      } else {
        width = Math.abs(height) * aspect * signW;
      }
    }
    draft.width = width;
    draft.height = height;
  }
  requestRender();
  return true;
}

function finishPlacementDrag() {
  if (!placementEditor.active) return false;
  placementEditor.action = null;
  placementEditor.startBasis = null;
  placementEditor.startPlacement = null;
  return true;
}

function startDrawing(event) {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);

  if (placementEditor.active && startPlacementDrag(event)) {
    return;
  }

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
  if (placementEditor.active && placementEditor.action) {
    event.preventDefault();
    continuePlacementDrag(event);
    return;
  }

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
  if (placementEditor.active && placementEditor.action) {
    event.preventDefault();
    finishPlacementDrag();
    return;
  }

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

function setImageFitMode(nextMode, showStatus = true) {
  imageFitMode = ["crop", "stretch", "manual"].includes(nextMode) ? nextMode : "crop";
  imageCropButton.classList.toggle("active", imageFitMode === "crop");
  imageStretchButton.classList.toggle("active", imageFitMode === "stretch");
  imageManualButton.classList.toggle("active", imageFitMode === "manual");
  updateImagePanelState();
  if (showStatus) {
    setStatus(`Image fit: ${imageFitMode}.`);
    scheduleAutosave();
  }
  requestRender();
}

function updateImagePanelState() {
  if (imageOpacityInput) imageOpacityInput.value = String(Math.round(imageOpacity * 100));
  if (imageOpacityValue) imageOpacityValue.textContent = `${Math.round(imageOpacity * 100)}%`;
  if (imageKeepAspectInput) imageKeepAspectInput.checked = Boolean(imagePlacement.keepAspect);
  if (imageSummary) {
    imageSummary.textContent = background.image
      ? `${background.naturalWidth}×${background.naturalHeight} · ${imageFitMode} · ${Math.round(imageOpacity * 100)}%`
      : "No image added";
  }
  if (editImagePlacementButton) editImagePlacementButton.disabled = !background.image;
  if (removeBackgroundButton) removeBackgroundButton.disabled = !background.image;
  if (fitSurfaceToImageButton) fitSurfaceToImageButton.disabled = !background.image;
}

function setImageOpacityFromControl(showStatus = true) {
  imageOpacity = clamp((Number(imageOpacityInput.value) || 76) / 100, 0.15, 1);
  updateImagePanelState();
  if (showStatus) {
    setStatus(`Image opacity: ${Math.round(imageOpacity * 100)}%.`);
    scheduleAutosave();
  }
  requestRender();
}

function defaultManualPlacement() {
  return { ...DEFAULT_IMAGE_PLACEMENT };
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

function applySurface(next, message = "Surface updated.", confirmMessage = "Changing the surface clears the existing drawing so old strokes do not end up on the wrong torus/cylinder. Continue?") {
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
    const proceed = window.confirm(confirmMessage);

    if (!proceed) {
      writeSurfaceToControls(surface);
      setStatus("Surface unchanged.");
      return false;
    }

    clearForSurfaceChange();
  }

  surface = cloneSurface(next);
  writeSurfaceToControls(surface);
  resetShapeViewForSurface();
  centerView();
  setStatus(imageFitMode === "manual" && background.image ? `${message} Manual image placement may need adjustment.` : message);
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

function surfaceForImage() {
  if (!background.image) return null;
  const imageWidth = background.naturalWidth || background.image.naturalWidth || 1;
  const imageHeight = background.naturalHeight || background.image.naturalHeight || 1;
  const scaleFactor = FIT_IMAGE_LONG_SIDE / Math.max(imageWidth, imageHeight);
  const width = Math.max(80, Math.round(imageWidth * scaleFactor));
  const height = Math.max(80, Math.round(imageHeight * scaleFactor));
  return {
    v1: { x: width, y: 0 },
    v2: { x: 0, y: height },
    repeatV1: true,
    repeatV2: true
  };
}

function fitSurfaceToImage() {
  const next = surfaceForImage();
  if (!next) {
    setStatus("Upload an image first.");
    return;
  }

  applySurface(
    next,
    "Surface fitted to image.",
    "Fitting the surface to the image will clear the existing drawing because the surface dimensions are changing. Continue?"
  );
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
    imagePlacement = defaultManualPlacement();
    updateImagePanelState();
    imagePanel.classList.add("open");
    setStatus("Image added to cells.");
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
  stopImagePlacement(false);
  updateImagePanelState();
  if (!skipStatus) setStatus("Image removed.");
  scheduleAutosave();
  requestRender();
}

function serializeProject() {
  return {
    version: 6,
    surface: cloneSurface(surface),
    hideGrid: hideGridInput.checked,
    imageFitMode,
    imageOpacity,
    imagePlacement: { ...imagePlacement },
    view: { ...view },
    objects: cloneObjects(objects),
    nextObjectId,
    color: colorInput.value,
    size: String(drawingSize),
    drawingSize,
    eraserSize,
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
  drawingSize = normalizedSize(data.drawingSize ?? data.size, DEFAULT_DRAW_SIZE);
  eraserSize = normalizedSize(data.eraserSize, DEFAULT_ERASER_SIZE);
  if ((Number(data.version) || 0) < 5 && Math.round(eraserSize) === 36) {
    eraserSize = DEFAULT_ERASER_SIZE;
  }
  syncSizeInputForTool();
  hideGridInput.checked = Boolean(data.hideGrid);
  imageOpacity = clamp(Number(data.imageOpacity ?? DEFAULT_IMAGE_OPACITY), 0.15, 1);
  imagePlacement = { ...DEFAULT_IMAGE_PLACEMENT, ...(data.imagePlacement || {}) };
  setImageFitMode(data.imageFitMode || DEFAULT_IMAGE_FIT_MODE, false);
  updateImagePanelState();
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
  writeSurfaceToControls(surface);
  syncZoomSlider();
  await setBackgroundFromDataUrl(data.backgroundDataUrl || null);
  resetShapeViewForSurface();
  updateImagePanelState();
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



function shapeTypeLabel() {
  if (surface.repeatV1 && surface.repeatV2) return "Torus";
  if (surface.repeatV1 || surface.repeatV2) return "Cylinder";
  return "Plane";
}

function resizeShapeCanvas() {
  const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const rect = shapeCanvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width * ratio));
  const height = Math.max(220, Math.round(rect.height * ratio));
  if (shapeCanvas.width !== width || shapeCanvas.height !== height) {
    shapeCanvas.width = width;
    shapeCanvas.height = height;
  }
}

function surfaceAngleRadians() {
  return Math.acos(clamp(dot(surface.v1, surface.v2) / Math.max(1, length(surface.v1) * length(surface.v2)), -1, 1));
}

function perpendicularLength(vector, againstVector) {
  const againstLength = Math.max(1, length(againstVector));
  const unit = scale(againstVector, 1 / againstLength);
  const projection = dot(vector, unit);
  const perpendicularSquared = Math.max(0, dot(vector, vector) - projection * projection);
  return Math.sqrt(perpendicularSquared);
}

function signedSkewAlong(vector, againstVector) {
  const denominator = Math.max(1, dot(againstVector, againstVector));
  return clamp(dot(vector, againstVector) / denominator, -1.75, 1.75);
}

function wrapUnit(value) {
  return ((value % 1) + 1) % 1;
}

function rotated3D(point) {
  const cy = Math.cos(shapeView.yaw);
  const sy = Math.sin(shapeView.yaw);
  const cp = Math.cos(shapeView.pitch);
  const sp = Math.sin(shapeView.pitch);
  const x1 = point.x * cy + point.z * sy;
  const z1 = -point.x * sy + point.z * cy;
  const y1 = point.y * cp - z1 * sp;
  const z2 = point.y * sp + z1 * cp;
  return { x: x1, y: y1, z: z2 };
}

function project3D(point, size) {
  const rotated = rotated3D(point);
  const distance = 7.2;
  const denominator = Math.max(1.05, distance - rotated.z);
  const perspective = distance / denominator;
  return {
    x: size.width / 2 + rotated.x * perspective * size.scale * shapeView.zoom,
    y: size.height / 2 - rotated.y * perspective * size.scale * shapeView.zoom,
    z: rotated.z
  };
}

function normalFromPoints(a, b, c) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  return {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x
  };
}

function lightForNormal(normal, extra = 0) {
  const light = { x: -0.34, y: 0.74, z: 0.86 };
  const lightLen = Math.hypot(light.x, light.y, light.z);
  const normalLen = Math.max(0.001, Math.hypot(normal.x, normal.y, normal.z));
  const intensity = Math.max(0, (normal.x * light.x + normal.y * light.y + normal.z * light.z) / (normalLen * lightLen));
  const shade = clamp(190 + intensity * 54 + extra, 176, 246);
  return `rgb(${Math.round(shade)}, ${Math.round(shade)}, ${Math.round(clamp(shade + 8, 185, 255))})`;
}

function makeShapeQuad(points, fill = null) {
  const rotated = points.map(rotated3D);
  const depth = rotated.reduce((sum, point) => sum + point.z, 0) / rotated.length;
  const normal = normalFromPoints(points[0], points[1], points[2]);
  return {
    type: "quad",
    points,
    fill: fill || lightForNormal(normal),
    depth
  };
}

function makeShapeLine(points, color, width, alpha = 1, depthBias = 0) {
  const rotated = points.map(rotated3D);
  const depth = rotated.reduce((sum, point) => sum + point.z, 0) / rotated.length + depthBias;
  return { type: "line", points, color, width, alpha, depth };
}

function renderShapeQuad(item, size) {
  const projected = item.points.map(point => project3D(point, size));
  shapeCtx.beginPath();
  shapeCtx.moveTo(projected[0].x, projected[0].y);
  for (let i = 1; i < projected.length; i++) shapeCtx.lineTo(projected[i].x, projected[i].y);
  shapeCtx.closePath();
  shapeCtx.fillStyle = item.fill;
  shapeCtx.fill();
}

function renderShapeLine(item, size) {
  const projected = item.points.map(point => project3D(point, size));
  if (projected.length < 2) return;
  shapeCtx.save();
  shapeCtx.globalAlpha = item.alpha;
  shapeCtx.strokeStyle = item.color;
  shapeCtx.lineWidth = item.width;
  shapeCtx.lineCap = "round";
  shapeCtx.lineJoin = "round";
  shapeCtx.beginPath();
  shapeCtx.moveTo(projected[0].x, projected[0].y);
  for (let i = 1; i < projected.length; i++) shapeCtx.lineTo(projected[i].x, projected[i].y);
  shapeCtx.stroke();
  shapeCtx.restore();
}

function shapeModelParameters() {
  const l1 = Math.max(1, length(surface.v1));
  const l2 = Math.max(1, length(surface.v2));
  const angle = surfaceAngleRadians();
  const angleFactor = clamp(Math.sin(angle), 0.12, 1);
  const type = shapeTypeLabel();
  const skew12 = signedSkewAlong(surface.v2, surface.v1);
  const skew21 = signedSkewAlong(surface.v1, surface.v2);

  if (type === "Torus") {
    let R = l1 / (Math.PI * 2);
    let r = perpendicularLength(surface.v2, surface.v1) / (Math.PI * 2);
    if (!Number.isFinite(r) || r < 1) r = l2 * angleFactor / (Math.PI * 2);
    r = clamp(r, R * 0.11, R * 0.82);
    const normalizer = 1.72 / Math.max(1, R + r);
    return {
      type,
      l1,
      l2,
      angle,
      angleFactor,
      skew: skew12,
      twist: clamp(skew12, -1.35, 1.35) * 0.22,
      R: R * normalizer,
      r: r * normalizer,
      planeScale: 1
    };
  }

  if (type === "Cylinder") {
    const repeatIsV1 = surface.repeatV1;
    const repeatVector = repeatIsV1 ? surface.v1 : surface.v2;
    const openVector = repeatIsV1 ? surface.v2 : surface.v1;
    const repeatLength = Math.max(1, length(repeatVector));
    const openLength = Math.max(1, length(openVector));
    const perpendicularOpen = Math.max(openLength * 0.22, perpendicularLength(openVector, repeatVector));
    const skew = signedSkewAlong(openVector, repeatVector);
    let radius = repeatLength / (Math.PI * 2);
    let height = perpendicularOpen;
    const normalizer = 2.75 / Math.max(1, height, radius * 2.2);
    return {
      type,
      l1,
      l2,
      repeatIsV1,
      repeatVector,
      openVector,
      repeatLength,
      openLength,
      angle,
      angleFactor,
      skew,
      radius: radius * normalizer,
      height: height * normalizer,
      lean: clamp(skew * 0.34, -0.85, 0.85)
    };
  }

  const points2D = [
    { x: 0, y: 0 },
    surface.v1,
    add(surface.v1, surface.v2),
    surface.v2
  ];
  const center = scale(add(surface.v1, surface.v2), 0.5);
  const maxDistance = Math.max(1, ...points2D.map(point => Math.hypot(point.x - center.x, point.y - center.y)));
  return {
    type,
    l1,
    l2,
    angle,
    angleFactor,
    center,
    planeScale: 1.76 / maxDistance,
    skew: Math.abs(skew12) > Math.abs(skew21) ? skew12 : skew21
  };
}

function torusShapePoint(u, v, params) {
  const vWrapped = wrapUnit(v);
  // Periodic twist makes skewed/parallelogram domains read as a slanted
  // parameterization while keeping the torus closed and visually clean.
  const uTwist = u + params.twist * Math.sin(Math.PI * 2 * vWrapped);
  const theta = Math.PI * 2 * wrapUnit(uTwist);
  const phi = Math.PI * 2 * vWrapped;
  const squash = 0.82 + 0.18 * params.angleFactor;
  return {
    x: (params.R + params.r * Math.cos(phi)) * Math.cos(theta),
    y: params.r * Math.sin(phi) * squash,
    z: (params.R + params.r * Math.cos(phi)) * Math.sin(theta)
  };
}

function cylinderShapePoint(u, v, params) {
  const repeatCoord = params.repeatIsV1 ? u : v;
  const openCoord = params.repeatIsV1 ? v : u;
  const theta = Math.PI * 2 * wrapUnit(repeatCoord + params.skew * openCoord);
  const y = -params.height / 2 + openCoord * params.height;
  const x = params.radius * Math.cos(theta) + params.lean * y;
  const z = params.radius * Math.sin(theta);
  if (params.repeatIsV1) return { x, y, z };
  // Make v2-wrapped cylinders visibly different without changing the buttons.
  return { x: y, y: x * 0.98, z };
}

function planeShapePoint(u, v, params) {
  const p = add(scale(surface.v1, u), scale(surface.v2, v));
  return {
    x: (p.x - params.center.x) * params.planeScale,
    y: -(p.y - params.center.y) * params.planeScale,
    z: 0
  };
}

function shapePointFromBasis(u, v, params) {
  if (params.type === "Torus") return torusShapePoint(u, v, params);
  if (params.type === "Cylinder") return cylinderShapePoint(u, v, params);
  return planeShapePoint(u, v, params);
}

function addShapeSurface(items, params) {
  if (params.type === "Torus") {
    const uSteps = 96;
    const vSteps = 40;
    for (let i = 0; i < uSteps; i++) {
      const u0 = i / uSteps;
      const u1 = (i + 1) / uSteps;
      for (let j = 0; j < vSteps; j++) {
        const v0 = j / vSteps;
        const v1 = (j + 1) / vSteps;
        const pts = [
          shapePointFromBasis(u0, v0, params),
          shapePointFromBasis(u1, v0, params),
          shapePointFromBasis(u1, v1, params),
          shapePointFromBasis(u0, v1, params)
        ];
        items.push(makeShapeQuad(pts));
      }
    }
    return;
  }

  if (params.type === "Cylinder") {
    const wrapSteps = 96;
    const heightSteps = 34;
    for (let i = 0; i < wrapSteps; i++) {
      const a0 = i / wrapSteps;
      const a1 = (i + 1) / wrapSteps;
      for (let j = 0; j < heightSteps; j++) {
        const b0 = j / heightSteps;
        const b1 = (j + 1) / heightSteps;
        const pts = params.repeatIsV1
          ? [
              shapePointFromBasis(a0, b0, params),
              shapePointFromBasis(a1, b0, params),
              shapePointFromBasis(a1, b1, params),
              shapePointFromBasis(a0, b1, params)
            ]
          : [
              shapePointFromBasis(b0, a0, params),
              shapePointFromBasis(b1, a0, params),
              shapePointFromBasis(b1, a1, params),
              shapePointFromBasis(b0, a1, params)
            ];
        items.push(makeShapeQuad(pts));
      }
    }
    return;
  }

  const pts = [
    shapePointFromBasis(0, 0, params),
    shapePointFromBasis(1, 0, params),
    shapePointFromBasis(1, 1, params),
    shapePointFromBasis(0, 1, params)
  ];
  items.push(makeShapeQuad(pts, "rgb(235,235,242)"));
}

function addSegmentedParamLine(items, params, samples, color, width, alpha, depthBias = 0.018) {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const p1 = shapePointFromBasis(a.u, a.v, params);
    const p2 = shapePointFromBasis(b.u, b.v, params);
    items.push(makeShapeLine([p1, p2], color, width, alpha, depthBias));
  }
}

function addShapeGrid(items, params) {
  const majorColor = "rgba(28,28,28,0.58)";
  const minorColor = "rgba(28,28,28,0.34)";
  const majorWidth = Math.max(1.15, shapeCanvas.width / 520);
  const minorWidth = Math.max(0.75, shapeCanvas.width / 820);
  const samples = 96;
  const divisions = params.type === "Plane" ? 8 : 12;

  for (let k = 0; k <= divisions; k++) {
    const t = k / divisions;
    const isMajor = k === 0 || k === divisions || k === Math.floor(divisions / 2);
    const color = isMajor ? majorColor : minorColor;
    const width = isMajor ? majorWidth : minorWidth;
    const alpha = isMajor ? 0.96 : 0.82;

    const uLine = [];
    const vLine = [];
    for (let s = 0; s <= samples; s++) {
      const q = s / samples;
      uLine.push({ u: q, v: t });
      vLine.push({ u: t, v: q });
    }
    addSegmentedParamLine(items, params, uLine, color, width, alpha, 0.025);
    addSegmentedParamLine(items, params, vLine, color, width, alpha, 0.025);
  }
}

function basisFromWorldPoint(point) {
  const basis = worldToBasis(point);
  if (!basis || !Number.isFinite(basis.u) || !Number.isFinite(basis.v)) return null;
  return basis;
}

function lerpBasis(a, b, t) {
  return {
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t
  };
}

function splitBasisSegment(a, b, repeatU, repeatV) {
  const cuts = [0, 1];
  for (const key of ["u", "v"]) {
    const repeats = key === "u" ? repeatU : repeatV;
    if (!repeats) continue;
    const start = a[key];
    const end = b[key];
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    for (let boundary = Math.floor(low) + 1; boundary <= Math.floor(high); boundary++) {
      if (boundary <= low || boundary >= high) continue;
      const t = (boundary - start) / (end - start);
      if (t > 0.0001 && t < 0.9999) cuts.push(t);
    }
  }
  cuts.sort((x, y) => x - y);
  const pieces = [];
  for (let i = 1; i < cuts.length; i++) {
    const t0 = cuts[i - 1];
    const t1 = cuts[i];
    if (t1 - t0 < 0.0001) continue;
    pieces.push([lerpBasis(a, b, t0), lerpBasis(a, b, t1)]);
  }
  return pieces;
}

function basisVisibleOnShape(point, params) {
  if (params.type === "Torus") return true;
  if (params.type === "Cylinder") {
    const openValue = params.repeatIsV1 ? point.v : point.u;
    return openValue >= -0.002 && openValue <= 1.002;
  }
  return point.u >= -0.002 && point.u <= 1.002 && point.v >= -0.002 && point.v <= 1.002;
}

function drawingSegmentToShapeItems(items, params, a, b, object) {
  const repeatU = params.type === "Torus" || (params.type === "Cylinder" && params.repeatIsV1);
  const repeatV = params.type === "Torus" || (params.type === "Cylinder" && !params.repeatIsV1);
  const pieces = splitBasisSegment(a, b, repeatU, repeatV);
  const color = object.color || "#111111";
  const width = clamp((object.size || 4) * (shapeCanvas.width / 1400), 1.15, 7.5);

  for (const [start, end] of pieces) {
    const midpoint = lerpBasis(start, end, 0.5);
    if (!basisVisibleOnShape(midpoint, params)) continue;
    const s = {
      u: repeatU ? wrapUnit(start.u) : start.u,
      v: repeatV ? wrapUnit(start.v) : start.v
    };
    const e = {
      u: repeatU ? wrapUnit(end.u) : end.u,
      v: repeatV ? wrapUnit(end.v) : end.v
    };
    const p1 = shapePointFromBasis(s.u, s.v, params);
    const p2 = shapePointFromBasis(e.u, e.v, params);
    items.push(makeShapeLine([p1, p2], color, width, 0.98, 0.055));
  }
}

function addShapeDrawing(items, params) {
  if (Math.abs(determinant()) < DET_MIN) return;
  const maxSegments = 2600;
  let segments = 0;

  for (const object of objects) {
    if (!object.points || object.points.length < 2) continue;
    for (let i = 1; i < object.points.length; i++) {
      if (segments > maxSegments) return;
      const a = basisFromWorldPoint(object.points[i - 1]);
      const b = basisFromWorldPoint(object.points[i]);
      if (!a || !b) continue;
      drawingSegmentToShapeItems(items, params, a, b, object);
      segments++;
    }
  }
}

function renderShapeItem(item, size) {
  if (item.type === "quad") renderShapeQuad(item, size);
  else renderShapeLine(item, size);
}

function renderShapePreview() {
  resizeShapeCanvas();
  const w = shapeCanvas.width;
  const h = shapeCanvas.height;
  shapeCtx.clearRect(0, 0, w, h);

  const gradient = shapeCtx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "#fffefa");
  gradient.addColorStop(1, "#f1eee6");
  shapeCtx.fillStyle = gradient;
  shapeCtx.fillRect(0, 0, w, h);

  const params = shapeModelParameters();
  const items = [];
  const size = { width: w, height: h, scale: Math.min(w, h) * 0.31 };

  addShapeSurface(items, params);
  addShapeGrid(items, params);
  addShapeDrawing(items, params);

  // Larger rotated z values are closer to the camera. Draw far to near so
  // back-side grid/drawing is hidden by the near side of the surface.
  items.sort((a, b) => a.depth - b.depth).forEach(item => renderShapeItem(item, size));

  const l1 = Math.round(length(surface.v1));
  const l2 = Math.round(length(surface.v2));
  const angle = Math.round(surfaceAngleRadians() * 180 / Math.PI);
  let details = `${params.type} · |v1| ${l1} · |v2| ${l2} · angle ${angle}°`;
  if (params.type === "Cylinder") {
    const repeatVector = surface.repeatV1 ? surface.v1 : surface.v2;
    const openVector = surface.repeatV1 ? surface.v2 : surface.v1;
    details += ` · radius ${Math.round(length(repeatVector) / (Math.PI * 2))} · height ${Math.round(perpendicularLength(openVector, repeatVector))}`;
  }

  shapeCtx.fillStyle = "rgba(31,31,31,0.66)";
  shapeCtx.font = `${Math.max(12, Math.round(w / 34))}px system-ui, sans-serif`;
  shapeCtx.fillText(details, 16 * (w / Math.max(420, w)), h - 18 * (h / Math.max(300, h)));
  shapeSummary.textContent = `${params.type} preview · drawing projected on surface · drag to rotate`;
}

function resetShapeViewForSurface() {
  shapeView.zoom = 1.0;
  if (surface.repeatV1 && surface.repeatV2) {
    shapeView.yaw = -0.74;
    shapeView.pitch = 0.45;
  } else if (surface.repeatV1) {
    shapeView.yaw = -0.56;
    shapeView.pitch = 0.42;
  } else if (surface.repeatV2) {
    shapeView.yaw = 1.08;
    shapeView.pitch = 0.34;
  } else {
    shapeView.yaw = -0.62;
    shapeView.pitch = 0.62;
  }
}

function toggleShapePanel(forceOpen = null) {
  const shouldOpen = forceOpen === null ? !shapePanel.classList.contains("open") : forceOpen;
  shapePanel.classList.toggle("open", shouldOpen);
  if (shouldOpen) renderShapePreview();
}

function handleShapePointerDown(event) {
  event.preventDefault();
  shapeCanvas.setPointerCapture(event.pointerId);
  shapeDrag = { x: event.clientX, y: event.clientY, yaw: shapeView.yaw, pitch: shapeView.pitch };
  shapeCanvas.classList.add("dragging");
}

function handleShapePointerMove(event) {
  if (!shapeDrag) return;
  event.preventDefault();
  shapeView.yaw = shapeDrag.yaw + (event.clientX - shapeDrag.x) * 0.012;
  shapeView.pitch = clamp(shapeDrag.pitch + (event.clientY - shapeDrag.y) * 0.01, -1.25, 1.25);
  renderShapePreview();
}

function handleShapePointerEnd(event) {
  if (!shapeDrag) return;
  event.preventDefault();
  shapeDrag = null;
  shapeCanvas.classList.remove("dragging");
}

function handleShapeWheel(event) {
  event.preventDefault();
  shapeView.zoom = clamp(shapeView.zoom * Math.exp(-event.deltaY * 0.0012), 0.65, 2.8);
  renderShapePreview();
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
    if (key === "e" && event.shiftKey) {
      setEraserMode(eraserMode === "object" ? "rub" : "object");
    }
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
    imagePanel.classList.toggle("open");
  } else if (key === "?" || (event.shiftKey && key === "/")) {
    event.preventDefault();
    helpPanel.classList.toggle("open");
  } else if (key === "escape") {
    geometryPanel.classList.remove("open");
    imagePanel.classList.remove("open");
    helpPanel.classList.remove("open");
    shapePanel.classList.remove("open");
    if (placementEditor.active) stopImagePlacement(false);
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
eraseObjectButton.addEventListener("click", () => {
  setEraserMode("object");
  chooseTool("erase");
});
eraseRubButton.addEventListener("click", () => {
  setEraserMode("rub");
  chooseTool("erase");
});
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

imageButton.addEventListener("click", () => {
  imagePanel.classList.toggle("open");
  updateImagePanelState();
});

imageCloseButton.addEventListener("click", () => {
  imagePanel.classList.remove("open");
});

helpButton.addEventListener("click", () => {
  helpPanel.classList.toggle("open");
});

shapeButton.addEventListener("click", () => toggleShapePanel());
shapeCloseButton.addEventListener("click", () => toggleShapePanel(false));
shapeCanvas.addEventListener("pointerdown", handleShapePointerDown);
shapeCanvas.addEventListener("pointermove", handleShapePointerMove);
shapeCanvas.addEventListener("pointerup", handleShapePointerEnd);
shapeCanvas.addEventListener("pointercancel", handleShapePointerEnd);
shapeCanvas.addEventListener("wheel", handleShapeWheel, { passive: false });

sizeInput.addEventListener("input", () => {
  storeVisibleSize();
  scheduleAutosave();
});

resetGeometryButton.addEventListener("click", resetSurfaceFields);
centerViewButton.addEventListener("click", centerView);
fitCellButton.addEventListener("click", fitCellToView);
fitSurfaceToImageButton.addEventListener("click", fitSurfaceToImage);
imageCropButton.addEventListener("click", () => setImageFitMode("crop"));
imageStretchButton.addEventListener("click", () => setImageFitMode("stretch"));
imageManualButton.addEventListener("click", () => {
  setImageFitMode("manual");
  if (background.image) startImagePlacement();
});
imageOpacityInput.addEventListener("input", () => setImageOpacityFromControl(false));
imageOpacityInput.addEventListener("change", () => setImageOpacityFromControl(true));
imageKeepAspectInput.addEventListener("change", () => {
  if (placementEditor.active && placementEditor.draft) placementEditor.draft.keepAspect = imageKeepAspectInput.checked;
});
editImagePlacementButton.addEventListener("click", startImagePlacement);
cancelPlacementButton.addEventListener("click", () => stopImagePlacement(false));
donePlacementButton.addEventListener("click", () => stopImagePlacement(true));
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
drawingSize = DEFAULT_DRAW_SIZE;
eraserSize = DEFAULT_ERASER_SIZE;
hideGridInput.checked = DEFAULT_HIDE_GRID;
setImageFitMode(DEFAULT_IMAGE_FIT_MODE, false);
imageOpacity = DEFAULT_IMAGE_OPACITY;
imagePlacement = defaultManualPlacement();
updateImagePanelState();
syncZoomSlider();
updateHistoryButtons();
setDefaultStatus();
resizeCanvas();
chooseTool("pen");
setEraserMode("object");
restoreAutosave();
