// Project save/load and small autosave. The project file is human-readable JSON.
import { DEFAULT_SURFACE, state, cloneObjects } from "./state.js";
import { cloneSurface } from "./math.js";
import { centerView, writeSurfaceControls, syncImageUi, syncZoomSlider } from "./surface.js";
import { requestRender } from "./render2d.js";
import { drawPreview3d, resetPreviewAngle } from "./preview3d.js";
import { closePanels, showStatus } from "./dom.js";
import { ensureLayerModel, serializableLayers, restoreLayersFromData, renderLayerPanel, imageLayer, syncImageLayerFromLegacyState } from "./layers.js";
import { clearAutosave, loadAutosave, saveAutosave } from "./projectStore.js";

const STORAGE_KEY = "torus-drawing-app.autosave.v10"; // small legacy fallback only

function previewOpacityForMode(mode) {
  if (mode === "xray") return 0.34;
  if (mode === "front") return 1.0;
  if (mode === "transparent") return 0.72;
  return 1.0;
}

export function serializeProject() {
  return {
    version: 10,
    surface: cloneSurface(state.surface),
    hideGrid: state.hideGrid,
    view: { ...state.view },
    objects: cloneObjects(state.objects),
    nextObjectId: state.nextObjectId,
    color: state.ui.colorInput.value,
    penSize: state.penSize,
    dotSize: state.dotSize,
    eraserSize: state.eraserSize,
    backgroundDataUrl: state.background.dataUrl,
    imageFitMode: state.imageFitMode,
    imageOpacity: state.imageOpacity,
    layers: serializableLayers(),
    activeLayerId: state.activeLayerId,
    nextLayerId: state.nextLayerId,
    previewTransparent: state.preview.transparent === true,
    previewTwist: state.preview.twist || 0,
    previewShowGrid: state.preview.showGrid !== false,
    previewDisplayMode: state.preview.displayMode || "solid",
    previewSilhouette: state.preview.silhouette === true
  };
}

export async function restoreProject(data, silent = false) {
  if (!data || !data.surface || !Array.isArray(data.objects)) return showStatus("Could not open project file.");
  state.surface = cloneSurface(data.surface);
  state.hideGrid = !!data.hideGrid;
  state.view = data.view?.zoom ? { ...data.view } : { x: 300, y: -210, zoom: 0.9 };
  state.objects = cloneObjects(data.objects);
  state.nextObjectId = data.nextObjectId || state.objects.reduce((m, o) => Math.max(m, o.id || 0), 0) + 1;
  state.penSize = Number(data.penSize || data.size || 4);
  state.dotSize = Number(data.dotSize || 20);
  state.eraserSize = Number(data.eraserSize || 20);
  if ((Number(data.version) || 0) < 6 && Math.round(state.eraserSize) === 10) state.eraserSize = 20;
  state.ui.colorInput.value = data.color || "#111111";
  state.imageFitMode = data.imageFitMode === "stretch" ? "stretch" : "crop";
  state.imageOpacity = Number.isFinite(data.imageOpacity) ? data.imageOpacity : 0.9;
  state.preview.enhanced = true;
  state.preview.transparent = data.previewTransparent === true;
  state.preview.displayMode = data.previewDisplayMode || (state.preview.transparent ? "transparent" : "solid");
  state.preview.opacity = previewOpacityForMode(state.preview.displayMode);
  state.preview.twist = Math.max(0, Math.min(540, Number(data.previewTwist || 0)));
  state.preview.showGrid = data.previewShowGrid !== false;
  state.preview.silhouette = data.previewSilhouette === true;
  state.undoStack = [];
  state.redoStack = [];

  // Restore the saved layer list BEFORE loading the image. Loading the image
  // calls ensureLayerModel(), and if the saved layers are not present yet,
  // that normalization step can incorrectly move every object into the current
  // default layer. Restoring layers first preserves each object's saved layerId.
  restoreLayersFromData(data);
  await setBackgroundFromDataUrl(data.backgroundDataUrl || null);

  writeSurfaceControls();
  ensureLayerModel();
  renderLayerPanel();
  syncImageUi();
  syncZoomSlider();
  if (state.ui.previewTwistInput) state.ui.previewTwistInput.value = String(state.preview.twist || 0);
  if (state.ui.preview3dGridInput) state.ui.preview3dGridInput.checked = state.preview.showGrid !== false;
  if (state.ui.previewSilhouetteInput) state.ui.previewSilhouetteInput.checked = state.preview.silhouette === true;
  state.ui.undoButton.disabled = true;
  state.ui.redoButton.disabled = true;
  requestRender();
  if (!silent) showStatus("Project opened.");
}

export function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(async () => {
    const project = serializeProject();
    try {
      await saveAutosave(project);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: project.version, indexedDb: true, savedAt: Date.now() })); } catch {}
    } catch {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch { /* Large images may exceed legacy storage. */ }
    }
  }, 250);
}

export async function restoreAutosave() {
  try {
    const stored = await loadAutosave();
    if (stored) {
      await restoreProject(stored, true);
      showStatus("Restored previous drawing.");
      return;
    }
  } catch { /* Fall back to legacy localStorage. */ }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.indexedDb) return;
    await restoreProject(parsed, true);
    showStatus("Restored previous drawing.");
  } catch { /* Ignore invalid autosave. */ }
}

export function resetEverything() {
  const proceed = window.confirm(
    "Reset everything to the default blank app? This clears the drawing, image, surface, history, and autosave. This cannot be undone."
  );
  if (!proceed) return;

  // Reset document content. This is intentionally not pushed onto undo/redo.
  state.objects = [];
  state.undoStack = [];
  state.redoStack = [];
  state.nextObjectId = 1;

  // Reset surface, view, tools, and image settings to the app defaults.
  state.surface = cloneSurface(DEFAULT_SURFACE);
  state.hideGrid = false;
  state.view = { x: 300, y: -210, zoom: 0.9 };
  state.penSize = 4;
  state.dotSize = 20;
  state.eraserSize = 20;
  state.tool = "pen";
  state.eraserMode = "object";
  state.shapeMode = "outline";
  state.selectedObjectId = null;
  state.imageFitMode = "crop";
  state.imageOpacity = 0.9;
  state.preview.enhanced = true;
  state.preview.transparent = false;
  state.preview.opacity = 1.0;
  state.preview.displayMode = "solid";
  state.preview.showGrid = true;
  state.preview.silhouette = false;
  state.preview.twist = 0;
  state.background = { image: null, dataUrl: null, naturalWidth: 1, naturalHeight: 1 };
  state.layers = [
    { id: "image-background", type: "image", name: "Image", opacity: 0.9, visible: true },
    { id: "layer-1", type: "drawing", name: "Layer 1", opacity: 1, visible: true }
  ];
  state.activeLayerId = "layer-1";
  state.nextLayerId = 2;

  // Reset visible form controls.
  state.ui.colorInput.value = "#111111";
  state.ui.sizeInput.value = "4";
  state.ui.backgroundInput.value = "";
  state.ui.projectInput.value = "";
  writeSurfaceControls();
  ensureLayerModel();
  renderLayerPanel();
  syncImageUi();
  syncZoomSlider();
  if (state.ui.previewTwistInput) state.ui.previewTwistInput.value = "0";
  if (state.ui.preview3dGridInput) state.ui.preview3dGridInput.checked = true;
  if (state.ui.previewSilhouetteInput) state.ui.previewSilhouetteInput.checked = false;
  state.ui.undoButton.disabled = true;
  state.ui.redoButton.disabled = true;
  state.ui.penButton.classList.add("active");
  state.ui.lineButton.classList.remove("active");
  if (state.ui.ellipseButton) state.ui.ellipseButton.classList.remove("active");
  if (state.ui.rectangleButton) state.ui.rectangleButton.classList.remove("active");
  state.ui.dotButton.classList.remove("active");
  if (state.ui.selectButton) state.ui.selectButton.classList.remove("active");
  state.ui.eraseButton.classList.remove("active");
  state.ui.homButton.classList.remove("active");
  state.ui.panButton.classList.remove("active");
  state.ui.eraseObjectButton.classList.add("active");
  state.ui.eraseRubButton.classList.remove("active");
  state.ui.eraserOptions.classList.remove("visible");
  state.ui.eraserOptions.hidden = true;
  state.homHoverId = null;
  state.homHoverOffset = { i: 0, j: 0 };
  state.homSelectedId = null;
  state.homSelectedOffset = { i: 0, j: 0 };
  state.canvas.classList.remove("panning", "active-pan", "homing");
  closePanels();

  // Remove saved browser state so a reload comes back completely clean.
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage can be unavailable in some browser modes. */ }
  clearAutosave().catch(() => {});

  centerView();
  resetPreviewAngle();
  requestRender();
  drawPreview3d();
  showStatus("Everything reset.");
}

export function saveProject() {
  const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: "torus-drawing.torusdraw" });
  link.click();
  URL.revokeObjectURL(url);
  showStatus("Project saved.");
}

export function openProjectFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try { await restoreProject(JSON.parse(reader.result)); scheduleAutosave(); }
    catch { showStatus("Could not open project file."); }
    state.ui.projectInput.value = "";
  };
  reader.readAsText(file);
}

export function setBackgroundFromDataUrl(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) {
      state.background = { image: null, dataUrl: null, naturalWidth: 1, naturalHeight: 1 };
      ensureLayerModel();
      renderLayerPanel();
      resolve();
      return;
    }
    const image = new Image();
    image.onload = () => {
      state.background = { image, dataUrl, naturalWidth: image.naturalWidth || 1, naturalHeight: image.naturalHeight || 1 };
      ensureLayerModel();
      const layer = imageLayer();
      if (layer) { layer.visible = true; layer.opacity = state.imageOpacity; }
      renderLayerPanel();
      resolve();
    };
    image.onerror = resolve;
    image.src = dataUrl;
  });
}
