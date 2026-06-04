// App bootstrap: wires modules together and keeps the UI behavior calm and predictable.
import { collectDom, closeFloatingPanelsOnly, closePanels, openPanel, showStatus } from "./dom.js";
import { state } from "./state.js";
import { chooseTool, handleSpace, handleTemporaryDot, movePointer, saveCurrentSize, setEraserMode, startPointer, stopPointer } from "./drawing.js";
import { clearDrawing, redo, undo, updateHistoryButtons } from "./history.js";
import { drawPreview3d, initPreview3d, resetPreviewAngle } from "./preview3d.js";
import { requestRender, resizeCanvas } from "./render2d.js";
import { applySurface, applySurfacePreset, centerView, exportPNG, fitCellToView, fitSurfaceToImage, loadImageFile, readSurfaceControls, removeImage, resetSurface, setImageFitMode, setImageOpacity, setZoom, sliderToZoom, syncImageUi, syncZoomSlider, syncEdgeUi, toggleEdgePair, writeSurfaceControls } from "./surface.js";
import { openProjectFile, resetEverything, restoreAutosave, saveProject, scheduleAutosave } from "./storage.js";
import { addDrawingLayer, ensureLayerModel, moveSelectedLayer, renderLayerPanel, toggleLayerVisibility } from "./layers.js";

collectDom();
ensureLayerModel();
initPreview3d();

function refreshSizeInput() {
  state.ui.sizeInput.value = state.tool === "erase" ? state.eraserSize : state.tool === "dot" ? state.dotSize : state.penSize;
}
function blurSizeInput() { state.ui.sizeInput.blur(); saveCurrentSize(); }

function syncPreviewTransparencyUi() {
  if (!state.ui.preview3dTransparencyInput) return;
  state.ui.preview3dTransparencyInput.checked = state.preview.transparent !== false;
  state.preview.opacity = state.preview.transparent === false ? 1.0 : 0.8;
}

function setPreviewTransparency(enabled) {
  state.preview.transparent = Boolean(enabled);
  state.preview.opacity = state.preview.transparent ? 0.8 : 1.0;
  syncPreviewTransparencyUi();
  drawPreview3d();
}

function openPreview3dWithNoticeIfNeeded() {
  openPanel("preview");
  drawPreview3d();
}

function togglePreview3d() {

  if (state.ui.preview3dPanel.classList.contains("open")) {
    state.ui.preview3dPanel.classList.remove("open");
    return;
  }
  openPreview3dWithNoticeIfNeeded();
}

function togglePreviewTransparency() {
  setPreviewTransparency(!(state.preview.transparent !== false));
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase(), code = event.code, cmd = event.ctrlKey || event.metaKey;
  if (key === "enter" && document.activeElement === state.ui.sizeInput) return blurSizeInput();
  if (key === " " && !isTextField(event.target)) handleSpace(event, true);
  if (cmd && key === "s") { event.preventDefault(); return saveProject(); }
  if (cmd && key === "z" && event.shiftKey) { event.preventDefault(); return redo(); }
  if (cmd && key === "z") { event.preventDefault(); return undo(); }
  if (cmd && key === "y") { event.preventDefault(); return redo(); }
  if (isTextField(event.target) || cmd) return;
  if (key === "d") { handleTemporaryDot(event, true); return; }
  if (key === "m") { event.preventDefault(); return togglePreview3d(); }
  if (key === "t") { event.preventDefault(); return togglePreviewTransparency(); }

  if (code === "Digit1" || key === "1" || key === "p") chooseTool("pen");
  else if (code === "Digit2" || key === "2" || key === "l") chooseTool("line");
  else if (code === "Digit3" || key === "3" || key === "o") chooseTool("ellipse");
  else if (code === "Digit4" || key === "4" || key === "r") chooseTool("rectangle");
  else if (code === "Digit5" || key === "5") chooseTool("dot");
  else if (code === "Digit6" || key === "6") { if (event.shiftKey) setEraserMode(state.eraserMode === "object" ? "rub" : "object"); chooseTool("erase"); }
  else if (code === "Digit7" || key === "7" || key === "v") chooseTool("pan");
  else if (code === "Digit8" || key === "8") chooseTool("hom");
  else if (key === "e") { if (event.shiftKey) setEraserMode(state.eraserMode === "object" ? "rub" : "object"); chooseTool("erase"); }
  else if (key === "c" && event.shiftKey) resetEverything();
  else if (key === "c") clearDrawing();
  else if (key === "f") fitCellToView();
  else if (key === "g") openPanel("surface");
  else if (key === "u") { if (applySurface(readSurfaceControls())) resetPreviewAngle(); }
  else if (key === "h") { state.hideGrid = !state.hideGrid; state.ui.hideGridInput.checked = state.hideGrid; showStatus(state.hideGrid ? "Grid hidden." : "Grid shown."); requestRender(); }
  else if (key === "i") { renderLayerPanel(); openPanel("image"); }
  else if (key === "?") openPanel("help");
  else if (key === "escape") closePanels();
  else if (key === "+" || key === "=") setZoom(state.view.zoom * 1.18);
  else if (key === "-" || key === "_") setZoom(state.view.zoom / 1.18);
}
function isTextField(el) { return el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && el.type !== "checkbox" && el.type !== "color"; }

function wireToolbar() {
  state.ui.penButton.onclick = () => chooseTool("pen");
  state.ui.lineButton.onclick = () => chooseTool("line");
  state.ui.ellipseButton.onclick = () => chooseTool("ellipse");
  state.ui.rectangleButton.onclick = () => chooseTool("rectangle");
  state.ui.dotButton.onclick = () => chooseTool("dot");
  state.ui.eraseButton.onclick = () => chooseTool("erase");
  state.ui.homButton.onclick = () => chooseTool("hom");
  state.ui.panButton.onclick = () => chooseTool("pan");
  state.ui.eraseObjectButton.onclick = () => { setEraserMode("object"); chooseTool("erase"); };
  state.ui.eraseRubButton.onclick = () => { setEraserMode("rub"); chooseTool("erase"); };
  state.ui.undoButton.onclick = undo;
  state.ui.redoButton.onclick = redo;
  state.ui.clearButton.onclick = clearDrawing;
  state.ui.surfaceButton.onclick = () => openPanel("surface");
  state.ui.imageButton.onclick = () => { renderLayerPanel(); openPanel("image"); };
  state.ui.preview3dButton.onclick = openPreview3dWithNoticeIfNeeded;
  state.ui.preview3dCloseButton.onclick = () => state.ui.preview3dPanel.classList.remove("open");
  if (state.ui.preview3dWarningCloseButton) state.ui.preview3dWarningCloseButton.onclick = () => state.ui.preview3dWarningPanel.classList.remove("open");
  if (state.ui.preview3dWarningCancelButton) state.ui.preview3dWarningCancelButton.onclick = () => state.ui.preview3dWarningPanel.classList.remove("open");
  if (state.ui.preview3dWarningViewButton) state.ui.preview3dWarningViewButton.onclick = openPreview3dWithNoticeIfNeeded;
  if (state.ui.preview3dTransparencyInput) state.ui.preview3dTransparencyInput.onchange = e => setPreviewTransparency(e.target.checked);
  if (state.ui.previewTwistInput) state.ui.previewTwistInput.oninput = e => { state.preview.twist = Number(e.target.value) || 0; drawPreview3d(); };
  if (state.ui.previewTwistResetButton) state.ui.previewTwistResetButton.onclick = () => { state.preview.twist = 0; state.ui.previewTwistInput.value = "0"; drawPreview3d(); };
  state.ui.helpButton.onclick = () => openPanel("help");
  if (state.ui.helpCloseButton) state.ui.helpCloseButton.onclick = () => state.ui.helpPanel.classList.remove("open");
  if (state.ui.surfaceCloseButton) state.ui.surfaceCloseButton.onclick = () => state.ui.surfacePanel.classList.remove("open");
  state.ui.imageCloseButton.onclick = () => state.ui.imagePanel.classList.remove("open");
  if (state.ui.imageLayerVisibilityButton) state.ui.imageLayerVisibilityButton.onclick = () => toggleLayerVisibility("image-background");
  state.ui.addLayerButton.onclick = () => addDrawingLayer();
  state.ui.moveLayerUpButton.onclick = () => moveSelectedLayer(1);
  state.ui.moveLayerDownButton.onclick = () => moveSelectedLayer(-1);
  state.ui.exportButton.onclick = exportPNG;
  state.ui.saveProjectButton.onclick = saveProject;
  state.ui.projectInput.onchange = e => openProjectFile(e.target.files[0]);
}

function wireSurfaceAndImage() {
  state.ui.updateSurfaceButton.onclick = () => { if (applySurface(readSurfaceControls())) resetPreviewAngle(); };
  state.ui.presetDefaultButton.onclick = () => { if (applySurfacePreset("default")) resetPreviewAngle(); };
  state.ui.presetSquareButton.onclick = () => { if (applySurfacePreset("square")) resetPreviewAngle(); };
  state.ui.presetRhombusButton.onclick = () => { if (applySurfacePreset("rhombus")) resetPreviewAngle(); };
  state.ui.presetGoldenButton.onclick = () => { if (applySurfacePreset("golden")) resetPreviewAngle(); };
  state.ui.resetSurfaceButton.onclick = () => { resetSurface(); resetPreviewAngle(); };
  state.ui.centerViewButton.onclick = centerView;
  state.ui.fitCellButton.onclick = fitCellToView;
  state.ui.hideGridInput.onchange = () => { state.hideGrid = state.ui.hideGridInput.checked; scheduleAutosave(); requestRender(); };
  state.ui.removeV1LinkButton.onclick = () => toggleEdgePair("v1");
  state.ui.removeV2LinkButton.onclick = () => toggleEdgePair("v2");
  state.ui.backgroundInput.onchange = e => loadImageFile(e.target.files[0]);
  state.ui.removeImageButton.onclick = removeImage;
  state.ui.imageCropButton.onclick = () => setImageFitMode("crop");
  state.ui.imageStretchButton.onclick = () => setImageFitMode("stretch");
  if (state.ui.imageOpacityInput) {
    const updateImageOpacity = e => setImageOpacity(e.target.value);
    state.ui.imageOpacityInput.addEventListener("input", updateImageOpacity);
    state.ui.imageOpacityInput.addEventListener("change", updateImageOpacity);
    state.ui.imageOpacityInput.addEventListener("pointerdown", e => e.stopPropagation(), { capture: true });
    state.ui.imageOpacityInput.addEventListener("pointermove", e => e.stopPropagation(), { capture: true });
    state.ui.imageOpacityInput.addEventListener("click", e => e.stopPropagation(), { capture: true });
  }
  state.ui.fitSurfaceToImageButton.onclick = () => { fitSurfaceToImage(); resetPreviewAngle(); };
}

function wireCanvas() {
  state.canvas.addEventListener("pointerdown", startPointer);
  state.canvas.addEventListener("pointermove", movePointer);
  state.canvas.addEventListener("pointerup", stopPointer);
  state.canvas.addEventListener("pointercancel", stopPointer);
  state.canvas.addEventListener("wheel", e => { e.preventDefault(); setZoom(state.view.zoom * Math.exp(-e.deltaY * 0.0018), pointerFromEvent(e)); }, { passive: false });
  state.canvas.addEventListener("pointerdown", blurSizeInput, { capture: true });
  state.ui.sizeInput.addEventListener("change", () => { saveCurrentSize(); refreshSizeInput(); });
}
function pointerFromEvent(event) {
  const box = state.canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

wireToolbar(); wireSurfaceAndImage(); wireCanvas();
state.ui.zoomSlider.oninput = () => setZoom(sliderToZoom(state.ui.zoomSlider.value));
state.ui.zoomInButton.onclick = () => setZoom(state.view.zoom * 1.18);
state.ui.zoomOutButton.onclick = () => setZoom(state.view.zoom / 1.18);
document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", event => {
  handleSpace(event, false);
  handleTemporaryDot(event, false);
});
window.addEventListener("resize", () => { resizeCanvas(); drawPreview3d(); });
// Leaving the Size block commits the number, so shortcuts immediately work again.
document.addEventListener("pointerdown", event => {
  if (!state.ui.sizeBlock.contains(event.target)) blurSizeInput();
}, { capture: true });

writeSurfaceControls(); syncEdgeUi(); syncImageUi(); renderLayerPanel(); syncPreviewTransparencyUi(); syncZoomSlider(); updateHistoryButtons(); resizeCanvas();
chooseTool("pen"); setEraserMode("object");
restoreAutosave().then(() => { refreshSizeInput(); requestRender(); drawPreview3d(); });
