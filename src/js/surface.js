// Surface and image settings. Typed surface edits apply only when Update is pressed.
import { DEFAULT_SURFACE, state } from "./state.js";
import { clamp, cloneSurface, determinant, displacement, length, scale, surfacesEqual, worldToBasis } from "./math.js";
import { requestRender, redraw } from "./render2d.js";
import { showStatus } from "./dom.js";
import { scheduleAutosave, setBackgroundFromDataUrl } from "./storage.js";
import { updateHistoryButtons } from "./history.js";

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
  ui.repeatV1Input.checked = surface.repeatV1;
  ui.repeatV2Input.checked = surface.repeatV2;
  ui.hideGridInput.checked = state.hideGrid;
}

export function readSurfaceControls() {
  return {
    v1: { x: Number(state.ui.a1Input.value) || 0, y: -(Number(state.ui.b1Input.value) || 0) },
    v2: { x: Number(state.ui.a2Input.value) || 0, y: -(Number(state.ui.b2Input.value) || 0) },
    repeatV1: state.ui.repeatV1Input.checked,
    repeatV2: state.ui.repeatV2Input.checked
  };
}

function anchorForCurrentView(surfaceValue = state.surface) {
  const basis = worldToBasis({ x: state.view.x, y: state.view.y }, surfaceValue);
  if (!basis) return { i: 0, j: 0, point: { x: 0, y: 0 } };

  const i = surfaceValue.repeatV1 ? Math.floor(basis.u) : 0;
  const j = surfaceValue.repeatV2 ? Math.floor(basis.v) : 0;
  return { i, j, point: displacement(surfaceValue, i, j) };
}

function validate(surface) {
  if (surface.repeatV1 && length(surface.v1) < 1) return "v1 is enabled, so it needs a non-zero displacement.";
  if (surface.repeatV2 && length(surface.v2) < 1) return "v2 is enabled, so it needs a non-zero displacement.";
  if (surface.repeatV1 && surface.repeatV2 && Math.abs(determinant(surface)) < 0.001) return "For a torus, v1 and v2 cannot be parallel.";
  return null;
}

function clearForSurfaceChange() {
  state.objects = [];
  state.undoStack = [];
  state.redoStack = [];
  state.nextObjectId = 1;
  updateHistoryButtons();
}

export function applySurface(next, message = "Surface updated.", confirmMessage = "Changing the surface clears the existing drawing. Continue?") {
  const error = validate(next);
  if (error) { showStatus(error); writeSurfaceControls(); return false; }
  if (surfacesEqual(next, state.surface)) { writeSurfaceControls(); return true; }
  if (state.objects.length && !window.confirm(confirmMessage)) { writeSurfaceControls(); showStatus("Surface unchanged."); return false; }
  const anchorBefore = anchorForCurrentView(state.surface);
  if (state.objects.length) clearForSurfaceChange();
  state.surface = cloneSurface(next);

  // Keep the currently viewed cell's origin anchored on screen. This makes
  // edits to a2/b2 feel like the cell grows from its visible lower-left
  // origin, even when the user has panned far away from the home cell.
  const anchorAfter = displacement(state.surface, anchorBefore.i, anchorBefore.j);
  state.view.x += anchorAfter.x - anchorBefore.point.x;
  state.view.y += anchorAfter.y - anchorBefore.point.y;

  writeSurfaceControls();
  scheduleAutosave();
  showStatus(message);
  requestRender();
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
  state.ui.imageCropButton.classList.toggle("active", state.imageFitMode === "crop");
  state.ui.imageStretchButton.classList.toggle("active", state.imageFitMode === "stretch");
  state.ui.imageOpacityInput.value = String(Math.round(state.imageOpacity * 100));
  state.ui.opacityValue.textContent = `${Math.round(state.imageOpacity * 100)}%`;
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
  scheduleAutosave();
  requestRender();
}

export function setImageOpacity(value) {
  state.imageOpacity = clamp(Number(value) / 100, 0.15, 1);
  syncImageUi();
  scheduleAutosave();
  requestRender();
}

function surfaceForImage() {
  const img = state.background;
  const factor = FIT_IMAGE_LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  return {
    v1: { x: Math.max(80, Math.round(img.naturalWidth * factor)), y: 0 },
    v2: { x: 0, y: -Math.max(80, Math.round(img.naturalHeight * factor)) },
    repeatV1: true,
    repeatV2: true
  };
}

export function fitSurfaceToImage() {
  if (!state.background.image) return showStatus("Upload an image first.");
  applySurface(surfaceForImage(), "Surface fitted to image.", "Fitting the surface to the image will clear the existing drawing. Continue?");
}

export function loadImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    await setBackgroundFromDataUrl(reader.result);
    state.imageOpacity = 0.9;
    syncImageUi();
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
  syncImageUi();
  scheduleAutosave();
  showStatus("Image removed.");
  requestRender();
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
