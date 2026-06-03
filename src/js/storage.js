// Project save/load and small autosave. The project file is human-readable JSON.
import { DEFAULT_SURFACE, state, cloneObjects } from "./state.js";
import { cloneSurface } from "./math.js";
import { centerView, writeSurfaceControls, syncImageUi, syncZoomSlider } from "./surface.js";
import { requestRender } from "./render2d.js";
import { drawPreview3d, resetPreviewAngle } from "./preview3d.js";
import { closePanels, showStatus } from "./dom.js";

const STORAGE_KEY = "torus-drawing-app.autosave.v9";

export function serializeProject() {
  return {
    version: 9,
    surface: cloneSurface(state.surface),
    hideGrid: state.hideGrid,
    view: { ...state.view },
    objects: cloneObjects(state.objects),
    nextObjectId: state.nextObjectId,
    color: state.ui.colorInput.value,
    penSize: state.penSize,
    eraserSize: state.eraserSize,
    backgroundDataUrl: state.background.dataUrl,
    imageFitMode: state.imageFitMode,
    imageOpacity: state.imageOpacity
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
  state.eraserSize = Number(data.eraserSize || 20);
  if ((Number(data.version) || 0) < 6 && Math.round(state.eraserSize) === 10) state.eraserSize = 20;
  state.ui.colorInput.value = data.color || "#111111";
  state.imageFitMode = data.imageFitMode === "stretch" ? "stretch" : "crop";
  state.imageOpacity = Number.isFinite(data.imageOpacity) ? data.imageOpacity : 0.9;
  state.preview.enhanced = true;
  state.undoStack = [];
  state.redoStack = [];
  await setBackgroundFromDataUrl(data.backgroundDataUrl || null);
  writeSurfaceControls();
  syncImageUi();
  syncZoomSlider();
  state.ui.undoButton.disabled = true;
  state.ui.redoButton.disabled = true;
  requestRender();
  if (!silent) showStatus("Project opened.");
}

export function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject())); } catch { /* Large images may exceed storage. */ }
  }, 250);
}

export async function restoreAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    await restoreProject(JSON.parse(raw), true);
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
  state.eraserSize = 20;
  state.tool = "pen";
  state.eraserMode = "object";
  state.imageFitMode = "crop";
  state.imageOpacity = 0.9;
  state.preview.enhanced = true;
  state.background = { image: null, dataUrl: null, naturalWidth: 1, naturalHeight: 1 };

  // Reset visible form controls.
  state.ui.colorInput.value = "#111111";
  state.ui.sizeInput.value = "4";
  state.ui.backgroundInput.value = "";
  state.ui.projectInput.value = "";
  writeSurfaceControls();
  syncImageUi();
  syncZoomSlider();
  state.ui.undoButton.disabled = true;
  state.ui.redoButton.disabled = true;
  state.ui.penButton.classList.add("active");
  state.ui.lineButton.classList.remove("active");
  state.ui.eraseButton.classList.remove("active");
  state.ui.homButton.classList.remove("active");
  state.ui.panButton.classList.remove("active");
  state.ui.eraseObjectButton.classList.add("active");
  state.ui.eraseRubButton.classList.remove("active");
  state.ui.eraserOptions.hidden = true;
  state.homHoverId = null;
  state.homHoverOffset = { i: 0, j: 0 };
  state.homSelectedId = null;
  state.homSelectedOffset = { i: 0, j: 0 };
  state.canvas.classList.remove("panning", "active-pan", "homing");
  closePanels();

  // Remove saved browser state so a reload comes back completely clean.
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage can be unavailable in some browser modes. */ }

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
      resolve();
      return;
    }
    const image = new Image();
    image.onload = () => {
      state.background = { image, dataUrl, naturalWidth: image.naturalWidth || 1, naturalHeight: image.naturalHeight || 1 };
      resolve();
    };
    image.onerror = resolve;
    image.src = dataUrl;
  });
}
