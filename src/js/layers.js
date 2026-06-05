// Lightweight layer model and layer-panel behavior.
// Layers are stored back-to-front. The panel displays them front-to-back.
import { state } from "./state.js";
import { cloneObjects } from "./state.js";
import { scheduleAutosave } from "./storage.js";
import { requestRender } from "./render2d.js";
import { drawPreview3d } from "./preview3d.js";
import { showStatus } from "./dom.js";
import { cellPoint, length, pointUv } from "./math.js";

export const IMAGE_LAYER_ID = "image-background";
export const DEFAULT_DRAWING_LAYER_ID = "layer-1";

export function ensureLayerModel() {
  if (!Array.isArray(state.layers) || state.layers.length === 0) {
    state.layers = [
      createImageLayer(),
      createDrawingLayer("Layer 1", DEFAULT_DRAWING_LAYER_ID)
    ];
    state.activeLayerId = DEFAULT_DRAWING_LAYER_ID;
    state.nextLayerId = 2;
  }

  if (!state.layers.some(layer => layer.id === IMAGE_LAYER_ID)) {
    state.layers.unshift(createImageLayer());
  }

  normalizeImageLayerPosition();

  let firstDrawing = state.layers.find(layer => layer.type === "drawing");
  if (!firstDrawing) {
    const layer = createDrawingLayer("Layer 1", DEFAULT_DRAWING_LAYER_ID);
    state.layers.push(layer);
    firstDrawing = layer;
    state.activeLayerId = layer.id;
  }

  for (const object of state.objects) {
    if (!object.layerId || !state.layers.some(layer => layer.id === object.layerId && layer.type === "drawing")) {
      object.layerId = firstDrawing.id;
    }
  }

  if (!state.activeLayerId || !state.layers.some(layer => layer.id === state.activeLayerId && layer.type === "drawing")) {
    state.activeLayerId = (state.layers.findLast?.(layer => layer.type === "drawing") || firstDrawing).id;
  }

  syncImageLayerFromLegacyState();
}

function normalizeImageLayerPosition() {
  const image = state.layers.find(layer => layer.id === IMAGE_LAYER_ID) || createImageLayer();
  const drawings = state.layers.filter(layer => layer.id !== IMAGE_LAYER_ID && layer.type === "drawing");
  state.layers = [image, ...drawings];
}

export function createDrawingLayer(name = "Layer", id = null) {
  const layerId = id || `layer-${state.nextLayerId++}`;
  return { id: layerId, type: "drawing", name, opacity: 1, visible: true };
}

export function createImageLayer() {
  return {
    id: IMAGE_LAYER_ID,
    type: "image",
    name: "Image",
    opacity: Number.isFinite(state.imageOpacity) ? state.imageOpacity : 0.9,
    visible: true
  };
}

export function imageLayer() {
  ensureLayerModel();
  return state.layers.find(layer => layer.id === IMAGE_LAYER_ID);
}

export function activeLayer() {
  ensureLayerModel();
  return state.layers.find(layer => layer.id === state.activeLayerId);
}

export function activeDrawingLayer() {
  ensureLayerModel();
  let layer = activeLayer();
  if (layer?.type === "drawing" && layer.visible) return layer;
  layer = state.layers.findLast?.(candidate => candidate.type === "drawing" && candidate.visible)
    || state.layers.find(candidate => candidate.type === "drawing");
  if (!layer) layer = addDrawingLayer(false);
  state.activeLayerId = layer.id;
  renderLayerPanel();
  return layer;
}

export function addDrawingLayer(commit = true) {
  const before = snapshotLayers();
  const number = state.layers.filter(layer => layer.type === "drawing").length + 1;
  const layer = createDrawingLayer(`Layer ${number}`);
  state.layers.push(layer);
  state.activeLayerId = layer.id;
  if (commit) commitLayerSnapshot(before);
  renderLayerPanel();
  requestRender();
  drawPreview3d();
  return layer;
}

export function selectLayer(id) {
  if (!state.layers.some(layer => layer.id === id && layer.type === "drawing")) return;
  state.activeLayerId = id;
  renderLayerPanel();
}

export function toggleLayerVisibility(id) {
  const before = snapshotLayers();
  const layer = state.layers.find(item => item.id === id);
  if (!layer) return;
  layer.visible = !layer.visible;
  if (layer.type === "image") syncLegacyStateFromImageLayer();
  commitLayerSnapshot(before);
  renderLayerPanel();
  requestRender();
  drawPreview3d();
}

export function setSelectedLayerOpacity(value) {
  const layer = activeLayer();
  if (!layer) return;
  layer.opacity = Math.max(0, Math.min(1, Number(value) / 100 || 0));
  if (layer.type === "image") syncLegacyStateFromImageLayer();
  renderLayerPanel(false);
  scheduleAutosave();
  requestRender();
  drawPreview3d();
}

export function setLayerOpacity(layerId, value) {
  const layer = state.layers.find(item => item.id === layerId && item.type === "drawing");
  if (!layer) return;
  layer.opacity = Math.max(0, Math.min(1, Number(value) / 100 || 0));
  const row = [...(state.ui.layerList?.querySelectorAll(".layer-row") || [])].find(item => item.dataset.layerId === layerId);
  if (row) {
    const percent = row.querySelector(".layer-percent");
    if (percent) percent.textContent = `${Math.round(layer.opacity * 100)}%`;
  }
  scheduleAutosave();
  requestRender();
  drawPreview3d();
}

export function removeLayer(layerId) {
  const layer = state.layers.find(item => item.id === layerId && item.type === "drawing");
  if (!layer) return;
  const drawingLayers = state.layers.filter(item => item.type === "drawing");
  if (drawingLayers.length <= 1) {
    showStatus("Keep at least one drawing layer.");
    return;
  }

  const before = snapshotLayers();
  state.layers = state.layers.filter(item => item.id !== layerId);
  state.objects = state.objects.filter(object => object.layerId !== layerId);
  if (state.activeLayerId === layerId) {
    state.activeLayerId = (state.layers.findLast?.(item => item.type === "drawing") || state.layers.find(item => item.type === "drawing"))?.id;
  }

  commitLayerSnapshot(before);
  renderLayerPanel();
  requestRender();
  drawPreview3d();
}

export function removeSelectedLayer() {
  const layer = activeLayer();
  if (!layer || layer.type !== "drawing") return;
  removeLayer(layer.id);
}

export function removeImageLayer() {
  const before = snapshotLayers();
  state.background = { image: null, dataUrl: null, naturalWidth: 1, naturalHeight: 1 };
  const layer = state.layers.find(item => item.id === IMAGE_LAYER_ID);
  if (layer) layer.visible = false;
  syncLegacyStateFromImageLayer();
  commitLayerSnapshot(before);
  renderLayerPanel();
  requestRender();
  drawPreview3d();
}

export function moveSelectedLayer(direction) {
  const layer = activeLayer();
  if (!layer || layer.type !== "drawing") return;
  const drawingLayers = state.layers.filter(item => item.type === "drawing");
  const visual = [...drawingLayers].reverse();
  const visualIndex = visual.findIndex(item => item.id === layer.id);
  const targetVisual = visualIndex - direction;
  if (targetVisual < 0 || targetVisual >= visual.length) return;
  moveDrawingLayerToVisualIndex(layer.id, targetVisual);
}

export function moveLayerToVisualIndex(layerId, visualIndex) {
  moveDrawingLayerToVisualIndex(layerId, visualIndex);
}

function moveDrawingLayerToVisualIndex(layerId, visualIndex) {
  const drawingLayers = state.layers.filter(layer => layer.type === "drawing");
  const currentVisual = [...drawingLayers].reverse().findIndex(layer => layer.id === layerId);
  if (currentVisual < 0) return;
  const clampedVisual = Math.max(0, Math.min(drawingLayers.length - 1, visualIndex));
  if (clampedVisual === currentVisual) return;

  const before = snapshotLayers();
  const visual = [...drawingLayers].reverse();
  const [moved] = visual.splice(currentVisual, 1);
  visual.splice(clampedVisual, 0, moved);
  const image = state.layers.find(layer => layer.id === IMAGE_LAYER_ID) || createImageLayer();
  state.layers = [image, ...visual.reverse()];
  commitLayerSnapshot(before);
  renderLayerPanel();
  requestRender();
  drawPreview3d();
}

function commitLayerSnapshot(before) {
  state.undoStack.push({ type: "layerSnapshot", before, after: snapshotLayers() });
  state.redoStack = [];
  scheduleAutosave();
  if (state.ui.undoButton) {
    state.ui.undoButton.disabled = state.undoStack.length === 0;
    state.ui.redoButton.disabled = state.redoStack.length === 0;
  }
}

export function snapshotLayers() {
  return {
    layers: cloneLayers(state.layers),
    activeLayerId: state.activeLayerId,
    objects: cloneObjects(state.objects),
    background: { ...state.background, image: null },
    imageFitMode: state.imageFitMode,
    imageOpacity: state.imageOpacity,
    nextLayerId: state.nextLayerId
  };
}

export function restoreLayerSnapshot(snapshot) {
  state.layers = cloneLayers(snapshot.layers);
  state.activeLayerId = snapshot.activeLayerId;
  state.objects = cloneObjects(snapshot.objects);
  state.imageFitMode = snapshot.imageFitMode;
  state.imageOpacity = snapshot.imageOpacity;
  state.nextLayerId = snapshot.nextLayerId || state.nextLayerId || 2;
  syncLegacyStateFromImageLayer();
}

export function cloneLayers(layers = []) {
  return layers.map(layer => ({ ...layer }));
}

export function serializableLayers() {
  ensureLayerModel();
  return cloneLayers(state.layers);
}

export function restoreLayersFromData(data) {
  if (Array.isArray(data.layers) && data.layers.length) {
    state.layers = cloneLayers(data.layers);
    state.activeLayerId = data.activeLayerId || state.layers.find(layer => layer.type === "drawing")?.id;
    state.nextLayerId = data.nextLayerId || inferNextLayerId();
  } else {
    state.layers = [
      createImageLayer(),
      createDrawingLayer("Layer 1", DEFAULT_DRAWING_LAYER_ID)
    ];
    state.activeLayerId = DEFAULT_DRAWING_LAYER_ID;
    state.nextLayerId = 2;
  }
  ensureLayerModel();
}

function inferNextLayerId() {
  let max = 1;
  for (const layer of state.layers || []) {
    const match = /^layer-(\d+)$/.exec(layer.id || "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function syncImageLayerFromLegacyState() {
  const layer = state.layers?.find(item => item.id === IMAGE_LAYER_ID);
  if (!layer) return;
  layer.opacity = Number.isFinite(layer.opacity) ? layer.opacity : (Number.isFinite(state.imageOpacity) ? state.imageOpacity : 0.9);
  state.imageOpacity = layer.opacity;
  layer.visible = layer.visible !== false;
}

export function syncLegacyStateFromImageLayer() {
  const layer = state.layers?.find(item => item.id === IMAGE_LAYER_ID);
  if (!layer) return;
  state.imageOpacity = Number.isFinite(layer.opacity) ? layer.opacity : state.imageOpacity;
}

export function visibleLayerOpacity(layerId) {
  const layer = state.layers?.find(item => item.id === layerId);
  return layer && layer.visible !== false ? (Number.isFinite(layer.opacity) ? layer.opacity : 1) : 0;
}

export function layerForObject(object) {
  return state.layers?.find(layer => layer.id === object.layerId) || state.layers?.find(layer => layer.type === "drawing");
}

export function renderLayerPanel(updateThumbnails = true) {
  if (!state.ui.layerList) return;
  ensureLayerModel();

  state.ui.layerList.innerHTML = "";
  const visualLayers = state.layers.filter(layer => layer.type === "drawing").reverse();

  renderImageLayerCard();

  visualLayers.forEach((layer, visualIndex) => {
    const row = document.createElement("div");
    row.className = `layer-row ${layer.id === state.activeLayerId ? "active" : ""} ${layer.visible === false ? "hidden-layer" : ""}`;
    row.dataset.layerId = layer.id;
    row.dataset.visualIndex = String(visualIndex);
    const percent = Math.round((layer.opacity ?? 1) * 100);
    const main = document.createElement("div");
    main.className = "layer-card-main";

    const thumb = document.createElement("span");
    thumb.className = "layer-thumb";

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name || "Layer";

    const percentEl = document.createElement("span");
    percentEl.className = "layer-percent";
    percentEl.textContent = `${percent}%`;

    const eye = document.createElement("button");
    eye.className = `layer-eye ${layer.visible === false ? "is-hidden" : "is-visible"}`;
    eye.type = "button";
    eye.title = layer.visible === false ? "Show layer" : "Hide layer";
    eye.setAttribute("aria-label", eye.title);
    const eyeIcon = document.createElement("span");
    eyeIcon.className = "eye-icon";
    eye.appendChild(eyeIcon);

    const del = document.createElement("button");
    del.className = "layer-delete";
    del.type = "button";
    del.title = "Delete layer";
    del.setAttribute("aria-label", "Delete layer");
    del.textContent = "🗑";

    main.append(thumb, name, percentEl, eye, del);

    const slider = document.createElement("input");
    slider.className = "layer-opacity-slider";
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(percent);
    slider.setAttribute("aria-label", "Layer opacity");

    row.append(main, slider);
    state.ui.layerList.appendChild(row);
    if (updateThumbnails) renderThumbnailInto(thumb, layer);
  });
}

function renderImageLayerCard() {
  if (!state.ui.imageLayerCard) return;
  const layer = state.layers.find(item => item.id === IMAGE_LAYER_ID) || createImageLayer();
  state.ui.imageLayerCard.classList.toggle("hidden-layer", layer.visible === false || !state.background.image);
  if (state.ui.imageLayerStatus) {
    state.ui.imageLayerStatus.textContent = state.background.image
      ? `Image · fixed behind drawings · ${Math.round((layer.opacity ?? 1) * 100)}%`
      : "No image · fixed behind drawings";
  }
  if (state.ui.imageLayerVisibilityButton) {
    state.ui.imageLayerVisibilityButton.textContent = layer.visible === false ? "Show" : "Hide";
    state.ui.imageLayerVisibilityButton.title = layer.visible === false ? "Show image layer" : "Hide image layer";
  }
  if (state.ui.imageLayerThumb) renderThumbnailInto(state.ui.imageLayerThumb, layer);
}

function startLayerPress(event, layerId) {
  if (event.button !== 0 || event.target.closest(".layer-control, .layer-eye, .layer-delete, .layer-opacity-slider")) return;
  const row = event.currentTarget;
  const list = state.ui.layerList;
  if (!list || !row) return;
  event.preventDefault();

  // Mark it active without re-rendering the list. Re-rendering here would
  // destroy the DOM node that is being dragged.
  state.activeLayerId = layerId;
  [...list.querySelectorAll(".layer-row")].forEach(item => item.classList.toggle("active", item.dataset.layerId === layerId));

  const start = { x: event.clientX, y: event.clientY };
  let dragging = false;
  let ghost = null;
  let placeholder = null;
  let currentTarget = Number(row.dataset.visualIndex) || 0;
  let grabOffset = { x: 0, y: 0 };

  const rowsWithoutSource = () => [...list.querySelectorAll(".layer-row")].filter(item => item !== row);

  const movePlaceholder = y => {
    const rows = rowsWithoutSource();
    let target = rows.length;
    for (let index = 0; index < rows.length; index++) {
      const rect = rows[index].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { target = index; break; }
    }
    const reference = rows[target] || null;
    if (reference) list.insertBefore(placeholder, reference);
    else list.appendChild(placeholder);
    currentTarget = target;
  };

  const beginDrag = e => {
    dragging = true;
    const rect = row.getBoundingClientRect();
    grabOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    ghost = row.cloneNode(true);
    ghost.classList.add("layer-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${e.clientX - grabOffset.x}px`;
    ghost.style.top = `${e.clientY - grabOffset.y}px`;
    document.body.appendChild(ghost);

    placeholder = document.createElement("div");
    placeholder.className = "layer-drop-placeholder";
    placeholder.style.height = `${rect.height}px`;
    row.classList.add("drag-source");
    list.insertBefore(placeholder, row);
    row.style.display = "none";
    movePlaceholder(e.clientY);
  };

  const move = e => {
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragging && Math.hypot(dx, dy) > 4) beginDrag(e);
    if (!dragging) return;
    ghost.style.left = `${e.clientX - grabOffset.x}px`;
    ghost.style.top = `${e.clientY - grabOffset.y}px`;
    movePlaceholder(e.clientY);
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!dragging) {
      selectLayer(layerId);
      return;
    }
    ghost?.remove();
    placeholder?.remove();
    row.style.display = "";
    row.classList.remove("drag-source");
    moveDrawingLayerToVisualIndex(layerId, currentTarget);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

function renderThumbnailInto(container, layer) {
  const canvas = document.createElement("canvas");
  canvas.width = 80;
  canvas.height = 52;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(0,0,0,.09)";
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

  if (layer.type === "image" && state.background.image) {
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(state.background.image, 0, 0, canvas.width, canvas.height);
  }

  if (layer.type === "drawing") {
    const objects = state.objects.filter(object => object.layerId === layer.id);
    renderObjectsThumbnail(ctx, objects, canvas.width, canvas.height);
  }

  container.innerHTML = "";
  container.appendChild(canvas);
}

function renderObjectsThumbnail(ctx, objects, width, height) {
  if (!objects.length) return;
  const corners = [
    { u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }
  ].map(uv => cellPoint(state.surface, { i: 0, j: 0 }, uv));
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 10) / Math.max(1, maxX - minX), (height - 10) / Math.max(1, maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (height - (maxY - minY) * scale) / 2 - minY * scale;

  for (const object of objects) {
    if (!object.points?.length) continue;
    const points = object.points.map(point => pointUv(point, state.surface)).filter(Boolean).map(uv => cellPoint(state.surface, { i: 0, j: 0 }, uv));
    if (!points.length) continue;
    ctx.save();
    ctx.strokeStyle = object.color || "#111111";
    ctx.lineWidth = object.type === "dot" ? Math.max(1, (object.size || 8) * scale * 0.13) : Math.max(1.2, (object.size || 1) * scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (object.type === "dot") {
      const radius = Math.max(0.8, (object.size || 8) * scale / 2);
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x * scale + ox, point.y * scale + oy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    if (points.length < 2) { ctx.restore(); continue; }
    ctx.beginPath();
    ctx.moveTo(points[0].x * scale + ox, points[0].y * scale + oy);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x * scale + ox, points[i].y * scale + oy);
    ctx.stroke();
    ctx.restore();
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
