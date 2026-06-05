// Surface and image settings. Typed surface edits apply only when Update is pressed.
import { DEFAULT_SURFACE, state } from "./state.js";
import { basisToWorld, clamp, cloneSurface, displacement, edgeTopology, length, normalizeEdgeLinks, scale, surfacesEqual, worldToBasis } from "./math.js";
import { analyzeSurfaceQuality, qualityMessage } from "./surfaceQuality.js";
import { requestRender, redraw } from "./render2d.js";
import { drawPreview3d } from "./preview3d.js";
import { openPanel, showStatus } from "./dom.js";
import { scheduleAutosave, setBackgroundFromDataUrl } from "./storage.js";
import { updateHistoryButtons } from "./history.js";
import { imageLayer, renderLayerPanel, syncLegacyStateFromImageLayer, ensureLayerModel } from "./layers.js";

const MIN_ZOOM = 0.16;
const MAX_ZOOM = 7.5;
const FIT_IMAGE_LONG_SIDE = 650;

export function writeSurfaceControls() {
  const { surface, ui } = state;
  // The UI uses mathematical direction: positive b is up.
  // Canvas internals use positive y downward, so display b as -internalY.
  ui.a1Input.value = Math.round(surface.v1.x);
  ui.b1Input.value = Math.round(-surface.v1.y);
  ui.a2Input.value = Math.round(surface.v2.x);
  ui.b2Input.value = Math.round(-surface.v2.y);
  const topo = edgeTopology(surface);
  ui.repeatV1Input.checked = topo.repeatV1;
  ui.repeatV2Input.checked = topo.repeatV2;
  ui.hideGridInput.checked = state.hideGrid;
  syncEdgeUi();
}

export function readSurfaceControls() {
  return {
    v1: { x: Number(state.ui.a1Input.value) || 0, y: -(Number(state.ui.b1Input.value) || 0) },
    v2: { x: Number(state.ui.a2Input.value) || 0, y: -(Number(state.ui.b2Input.value) || 0) },
    edgeLinks: normalizeEdgeLinks(state.surface.edgeLinks, state.surface)
  };
}

function anchorForCurrentView(surfaceValue = state.surface) {
  const basis = worldToBasis({ x: state.view.x, y: state.view.y }, surfaceValue);
  if (!basis) return { i: 0, j: 0, point: { x: 0, y: 0 } };

  const topo = edgeTopology(surfaceValue);
  const i = topo.repeatV1 ? Math.floor(basis.u) : 0;
  const j = topo.repeatV2 ? Math.floor(basis.v) : 0;
  return { i, j, point: displacement(surfaceValue, i, j) };
}

function validate(surface) {
  const topo = edgeTopology(surface);
  if (topo.repeatV1 && length(surface.v1) < 1) return "A links left/right, so v1 needs a non-zero displacement.";
  if (topo.repeatV2 && length(surface.v2) < 1) return "B links bottom/top, so v2 needs a non-zero displacement.";
  const quality = analyzeSurfaceQuality(surface);
  if (quality.invalid) return qualityMessage(quality);
  return null;
}

function clearForSurfaceChange() {
  state.objects = [];
  state.undoStack = [];
  state.redoStack = [];
  state.nextObjectId = 1;
  updateHistoryButtons();
}

function remapObjectsToSurface(oldSurface, newSurface) {
  for (const object of state.objects) {
    for (const point of object.points || []) {
      let uv = Number.isFinite(point.u) && Number.isFinite(point.v) ? { u: point.u, v: point.v } : worldToBasis(point, oldSurface);
      if (!uv) continue;
      point.u = uv.u;
      point.v = uv.v;
      const world = basisToWorld(uv, newSurface);
      point.x = world.x;
      point.y = world.y;
    }
  }
}

export function applySurface(next, message = "Surface updated.", confirmMessage = "Update surface and keep drawing attached to the cell?") {
  const error = validate(next);
  if (error) { showStatus(error); writeSurfaceControls(); return false; }
  if (surfacesEqual(next, state.surface)) {
    state.surface = cloneSurface(next);
    writeSurfaceControls();
    scheduleAutosave();
    showStatus("Edge links updated.");
    requestRender();
    drawPreview3d();
    return true;
  }

  const anchorBefore = anchorForCurrentView(state.surface);
  const oldSurface = cloneSurface(state.surface);
  let shouldClear = false;
  if (state.objects.length) {
    const keep = window.confirm(`${confirmMessage}

OK = keep drawings attached to their cell coordinates.
Cancel = choose clear/cancel.`);
    if (!keep) {
      shouldClear = window.confirm(`Clear the drawing and update the surface instead?

OK = clear drawing.
Cancel = leave surface unchanged.`);
      if (!shouldClear) { writeSurfaceControls(); showStatus("Surface unchanged."); return false; }
    }
  }

  if (shouldClear) clearForSurfaceChange();
  state.surface = cloneSurface(next);
  if (!shouldClear && state.objects.length) remapObjectsToSurface(oldSurface, state.surface);
  const quality = analyzeSurfaceQuality(state.surface);
  if (quality.extreme || quality.dense) showStatus(qualityMessage(quality));

  const anchorAfter = displacement(state.surface, anchorBefore.i, anchorBefore.j);
  state.view.x += anchorAfter.x - anchorBefore.point.x;
  state.view.y += anchorAfter.y - anchorBefore.point.y;

  writeSurfaceControls();
  scheduleAutosave();
  showStatus(shouldClear ? "Surface updated and drawing cleared." : message);
  requestRender();
  drawPreview3d();
  return true;
}

export function resetSurface() {
  const oldHidden = state.hideGrid;
  state.hideGrid = false;
  const ok = applySurface(cloneSurface(DEFAULT_SURFACE), "Surface reset.");
  if (!ok) state.hideGrid = oldHidden;
  if (ok) centerView();
  writeSurfaceControls();
}

export function centerView() {
  state.view.x = (state.surface.v1.x + state.surface.v2.x) / 2;
  state.view.y = (state.surface.v1.y + state.surface.v2.y) / 2;
  requestRender();
}

export function fitCellToView() {
  const corners = [{ x: 0, y: 0 }, state.surface.v1, state.surface.v2, { x: state.surface.v1.x + state.surface.v2.x, y: state.surface.v1.y + state.surface.v2.y }];
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  const w = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(1, Math.max(...ys) - Math.min(...ys));
  state.view.x = (Math.min(...xs) + Math.max(...xs)) / 2;
  state.view.y = (Math.min(...ys) + Math.max(...ys)) / 2;
  state.view.zoom = clamp(Math.min(state.cssWidth / (w * 1.18), state.cssHeight / (h * 1.18)), MIN_ZOOM, MAX_ZOOM);
  syncZoomSlider();
  showStatus("Cell fitted.");
  requestRender();
}

export function setZoom(nextZoom, anchor = { x: state.cssWidth / 2, y: state.cssHeight / 2 }) {
  const oldWorld = { x: (anchor.x - state.cssWidth / 2) / state.view.zoom + state.view.x, y: (anchor.y - state.cssHeight / 2) / state.view.zoom + state.view.y };
  state.view.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const newWorld = { x: (anchor.x - state.cssWidth / 2) / state.view.zoom + state.view.x, y: (anchor.y - state.cssHeight / 2) / state.view.zoom + state.view.y };
  state.view.x += oldWorld.x - newWorld.x;
  state.view.y += oldWorld.y - newWorld.y;
  syncZoomSlider();
  requestRender();
}

export function syncZoomSlider() {
  const t = (Math.log(state.view.zoom) - Math.log(MIN_ZOOM)) / (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM));
  state.ui.zoomSlider.value = String(Math.round(clamp(t, 0, 1) * 100));
}
export function sliderToZoom(value) {
  const t = clamp(Number(value) / 100, 0, 1);
  return Math.exp(Math.log(MIN_ZOOM) + t * (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM)));
}

export function syncImageUi() {
  ensureLayerModel();
  syncLegacyStateFromImageLayer();
  state.ui.imageCropButton.classList.toggle("active", state.imageFitMode === "crop");
  state.ui.imageStretchButton.classList.toggle("active", state.imageFitMode === "stretch");
  if (state.ui.imageOpacityInput) state.ui.imageOpacityInput.value = String(Math.round(state.imageOpacity * 100));
  if (state.ui.opacityValue) state.ui.opacityValue.textContent = `${Math.round(state.imageOpacity * 100)}%`;
  if (state.ui.imageSummary) {
    state.ui.imageSummary.textContent = state.background.image
      ? `${state.background.naturalWidth}×${state.background.naturalHeight} · ${state.imageFitMode} · ${Math.round(state.imageOpacity * 100)}%`
      : "No image added";
  }
  if (state.ui.removeImageButton) state.ui.removeImageButton.disabled = !state.background.image;
  if (state.ui.fitSurfaceToImageButton) state.ui.fitSurfaceToImageButton.disabled = !state.background.image;
}

export function setImageFitMode(mode) {
  state.imageFitMode = mode === "stretch" ? "stretch" : "crop";
  syncImageUi();
  renderLayerPanel();
  scheduleAutosave();
  requestRender();
}

export function setImageOpacity(value) {
  const nextOpacity = clamp(Number(value) / 100, 0.15, 1);
  state.imageOpacity = nextOpacity;

  const layer = imageLayer();
  if (layer) {
    layer.opacity = nextOpacity;
    layer.visible = state.background.image ? layer.visible !== false : layer.visible;
  }

  const percent = Math.round(nextOpacity * 100);
  if (state.ui.imageOpacityInput && Number(state.ui.imageOpacityInput.value) !== percent) {
    state.ui.imageOpacityInput.value = String(percent);
  }
  if (state.ui.opacityValue) state.ui.opacityValue.textContent = `${percent}%`;
  if (state.ui.imageSummary) {
    state.ui.imageSummary.textContent = state.background.image
      ? `${state.background.naturalWidth}×${state.background.naturalHeight} · ${state.imageFitMode} · ${percent}%`
      : "No image added";
  }
  if (state.ui.imageLayerStatus) {
    state.ui.imageLayerStatus.textContent = state.background.image
      ? `Image · fixed behind drawings · ${percent}%`
      : "No image · fixed behind drawings";
  }

  scheduleAutosave();
  requestRender();
  drawPreview3d();
}

function surfaceForImage() {
  const img = state.background;
  const factor = FIT_IMAGE_LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  return {
    v1: { x: Math.max(80, Math.round(img.naturalWidth * factor)), y: 0 },
    v2: { x: 0, y: -Math.max(80, Math.round(img.naturalHeight * factor)) },
    edgeLinks: normalizeEdgeLinks(state.surface.edgeLinks, state.surface)
  };
}

export function fitSurfaceToImage() {
  if (!state.background.image) return showStatus("Upload an image first.");
  applySurface(surfaceForImage(), "Surface fitted to image.", "Fit the surface to the image and keep drawings attached to their cell coordinates?");
}

export function loadImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    await setBackgroundFromDataUrl(reader.result);
    state.imageOpacity = 0.9;
    const layer = imageLayer();
    if (layer) { layer.visible = true; layer.opacity = state.imageOpacity; }
    syncImageUi();
    renderLayerPanel();
    state.ui.imagePanel.classList.add("open");
    requestRender();
    scheduleAutosave();
    if (window.confirm("Set the surface dimensions to match this image's aspect ratio?")) fitSurfaceToImage();
    else showStatus("Image added.");
  };
  reader.readAsDataURL(file);
}

export function removeImage() {
  state.background = { image: null, dataUrl: null, naturalWidth: 1, naturalHeight: 1 };
  state.ui.backgroundInput.value = "";
  const layer = imageLayer();
  if (layer) layer.visible = false;
  syncImageUi();
  renderLayerPanel();
  scheduleAutosave();
  showStatus("Image removed.");
  requestRender();
}

const EDGE_COLORS = { v1: "#2f68d8", v2: "#c46a22" };
const EDGE_GEOMETRY = {
  left: { x1: 50, y1: 115, x2: 50, y2: 35, pair: "v1" },
  right: { x1: 170, y1: 115, x2: 170, y2: 35, pair: "v1" },
  bottom: { x1: 50, y1: 115, x2: 170, y2: 115, pair: "v2" },
  top: { x1: 50, y1: 35, x2: 170, y2: 35, pair: "v2" }
};

export function syncEdgeUi() {
  const svg = state.ui.edgeDiagram;
  if (!svg) return;
  const links = normalizeEdgeLinks(state.surface.edgeLinks, state.surface);
  state.surface.edgeLinks = links;
  const arrow = (edge, pair) => {
    const g = EDGE_GEOMETRY[edge];
    const dir = links[pair].direction[edge] || 1;
    const color = links[pair].active ? EDGE_COLORS[pair] : "rgba(31,31,31,.22)";
    const sx = dir === 1 ? g.x1 : g.x2, sy = dir === 1 ? g.y1 : g.y2;
    const ex = dir === 1 ? g.x2 : g.x1, ey = dir === 1 ? g.y2 : g.y1;
    const x1 = sx + (ex - sx) * 0.39, y1 = sy + (ey - sy) * 0.39;
    const x2 = sx + (ex - sx) * 0.61, y2 = sy + (ey - sy) * 0.61;
    const label = links[pair].active ? links[pair].label : "";
    const lx = (g.x1 + g.x2) / 2, ly = (g.y1 + g.y2) / 2;
    const dy = edge === "top" ? -14 : edge === "bottom" ? 22 : 4;
    const dx = edge === "left" ? -20 : edge === "right" ? 20 : 0;
    return `<line class="edge-arrow ${links[pair].active ? "" : "edge-open"}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" marker-end="url(#arrow-${pair})"/>${label ? `<text class="edge-label" x="${lx + dx}" y="${ly + dy}" text-anchor="middle">${label}</text>` : ""}`;
  };
  svg.innerHTML = `
    <defs>
      <marker id="arrow-v1" markerWidth="5" markerHeight="5" refX="4.4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="${EDGE_COLORS.v1}"/></marker>
      <marker id="arrow-v2" markerWidth="5" markerHeight="5" refX="4.4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="${EDGE_COLORS.v2}"/></marker>
    </defs>
    <path class="cell-edge" d="M50 35 H170 V115 H50 Z"/>
    ${arrow("left", "v1")}${arrow("right", "v1")}${arrow("bottom", "v2")}${arrow("top", "v2")}
    ${Object.keys(EDGE_GEOMETRY).map(edge => { const g = EDGE_GEOMETRY[edge]; return `<line class="edge-hit" data-edge="${edge}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`; }).join("")}
  `;
  svg.querySelectorAll(".edge-hit").forEach(line => line.addEventListener("click", () => flipOrActivateEdge(line.dataset.edge)));
  state.ui.removeV1LinkButton.textContent = links.v1.active ? "Remove A" : "Add A";
  state.ui.removeV2LinkButton.textContent = links.v2.active ? "Remove B" : "Add B";
  const topo = edgeTopology(state.surface);
  const type = !topo.repeatV1 && !topo.repeatV2 ? "Plane" : topo.repeatV1 && topo.repeatV2 ? (topo.flipU || topo.flipV ? "Klein-style" : "Torus") : (topo.flipU || topo.flipV ? "Möbius-style" : "Cylinder");
  state.ui.edgeStatus.textContent = `${type}. Click a colored side to flip its arrow; remove a pair to leave that direction open.`;
  state.ui.repeatV1Input.checked = topo.repeatV1;
  state.ui.repeatV2Input.checked = topo.repeatV2;
}

function flipOrActivateEdge(edge) {
  const pair = EDGE_GEOMETRY[edge].pair;
  const links = normalizeEdgeLinks(state.surface.edgeLinks, state.surface);
  if (!links[pair].active) links[pair].active = true;
  else links[pair].direction[edge] *= -1;
  applyTopologyLinks(links, "Edge direction updated.");
}

export function toggleEdgePair(pair) {
  const links = normalizeEdgeLinks(state.surface.edgeLinks, state.surface);
  links[pair].active = !links[pair].active;
  applyTopologyLinks(links, links[pair].active ? "Edge pair linked." : "Edge pair removed.");
}

function applyTopologyLinks(links, message) {
  state.surface = cloneSurface({ ...state.surface, edgeLinks: links });
  writeSurfaceControls();
  scheduleAutosave();
  showStatus(message);
  requestRender();
}


export function applySurfacePreset(name) {
  const side = 520;
  const goldenHeight = 420;
  const presets = {
    default: {
      v1: { x: 600, y: 0 },
      v2: { x: 0, y: -420 }
    },
    square: {
      v1: { x: side, y: 0 },
      v2: { x: 0, y: -side }
    },
    rhombus: {
      v1: { x: side, y: 0 },
      v2: { x: Math.round(side / 2), y: -Math.round(side * Math.sqrt(3) / 2) }
    },
    golden: {
      v1: { x: Math.round(goldenHeight * 1.61803398875), y: 0 },
      v2: { x: 0, y: -goldenHeight }
    }
  };
  const preset = presets[name];
  if (!preset) return false;
  return applySurface({
    ...state.surface,
    v1: { ...preset.v1 },
    v2: { ...preset.v2 },
    edgeLinks: normalizeEdgeLinks(state.surface.edgeLinks, state.surface)
  }, `${name === "rhombus" ? "60° rhombus" : name.charAt(0).toUpperCase() + name.slice(1)} preset applied.`);
}

export function exportPNG() {
  redraw();
  state.canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: "torus-drawing.png" });
    link.click();
    URL.revokeObjectURL(url);
    showStatus("PNG exported.");
  }, "image/png");
}
