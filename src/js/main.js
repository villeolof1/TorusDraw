// App bootstrap: wires modules together and keeps the UI behavior calm and predictable.
import { collectDom, closeFloatingPanelsOnly, closePanels, openPanel, showStatus } from "./dom.js";
import { state } from "./state.js";
import { addPathPoint, applySelectedColor, applySelectedSize, applySelectionDimensions, chooseTool, deleteSelectedPathPoint, deleteSelection, duplicateSelection, flipSelection, groupSelection, handleSpace, handleTemporaryDot, movePointer, saveCurrentSize, setEraserMode, setSelectMode, setShapeMode, startPointer, stopPointer, syncShapeControls, toggleSelectedPathPointMode, toggleTouchModifier, ungroupSelection } from "./drawing.js";
import { clearDrawing, redo, undo, updateHistoryButtons } from "./history.js";
import { drawPreview3d, initPreview3d, resetPreviewAngle } from "./preview3d.js";
import { requestRender, resizeCanvas } from "./render2d.js";
import { applySurface, applySurfacePreset, centerView, exportPNG, fitCellToView, fitSurfaceToImage, loadImageFile, readSurfaceControls, removeImage, resetSurface, setImageFitMode, setImageOpacity, setZoom, sliderToZoom, syncImageUi, syncZoomSlider, syncEdgeUi, toggleEdgePair, writeSurfaceControls } from "./surface.js";
import { openProjectFile, resetEverything, restoreAutosave, saveProject, scheduleAutosave } from "./storage.js";
import { addDrawingLayer, ensureLayerModel, moveSelectedLayer, renderLayerPanel, toggleLayerVisibility } from "./layers.js";

collectDom();
ensureLayerModel();
initPreview3d();

function syncResponsiveMode() {
  document.body.classList.toggle("compact-ui", window.matchMedia("(max-width: 760px)").matches);
  document.body.classList.toggle("touch-ui", window.matchMedia("(pointer: coarse)").matches);
}

function previewOpacityForMode(mode) {
  if (mode === "xray") return 0.34;
  if (mode === "transparent") return 0.72;
  return 1.0;
}

function setPreviewMode(mode) {
  state.preview.displayMode = ["transparent", "xray", "front"].includes(mode) ? mode : "solid";
  state.preview.transparent = state.preview.displayMode !== "solid" && state.preview.displayMode !== "front";
  state.preview.opacity = previewOpacityForMode(state.preview.displayMode);
  syncPreviewControls();
  drawPreview3d();
}

function syncPreviewControls() {
  const mode = state.preview.displayMode || (state.preview.transparent ? "transparent" : "solid");
  if (state.ui.preview3dTransparencyInput) state.ui.preview3dTransparencyInput.checked = mode === "transparent" || mode === "xray";
  if (state.ui.preview3dGridInput) state.ui.preview3dGridInput.checked = state.preview.showGrid !== false;
  if (state.ui.previewSilhouetteInput) state.ui.previewSilhouetteInput.checked = state.preview.silhouette === true;
  for (const [id, value] of [["previewModeSolidButton", "solid"], ["previewModeTransparentButton", "transparent"], ["previewModeXrayButton", "xray"], ["previewModeFrontButton", "front"]]) {
    if (state.ui[id]) state.ui[id].classList.toggle("active", mode === value);
  }
}

function refreshSizeInput() {
  state.ui.sizeInput.value = state.tool === "erase" ? state.eraserSize : state.tool === "dot" ? state.dotSize : state.penSize;
}
function blurSizeInput() { state.ui.sizeInput.blur(); saveCurrentSize(); }

function syncPreviewTransparencyUi() { syncPreviewControls(); }

function setPreviewTransparency(enabled) {
  setPreviewMode(enabled ? "transparent" : "solid");
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
  else if (code === "Digit6" || key === "6" || key === "s") chooseTool("select");
  else if (code === "Digit7" || key === "7") { if (event.shiftKey) setEraserMode(state.eraserMode === "object" ? "rub" : "object"); chooseTool("erase"); }
  else if (code === "Digit8" || key === "8" || key === "v") chooseTool("pan");
  else if (code === "Digit9" || key === "9") chooseTool("hom");
  else if (key === "e") { if (event.shiftKey) setEraserMode(state.eraserMode === "object" ? "rub" : "object"); chooseTool("erase"); }
  else if (key === "delete" || key === "backspace") { if (!deleteSelectedPathPoint()) deleteSelection(); }
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
  if (state.ui.selectButton) state.ui.selectButton.onclick = () => chooseTool("select");
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
  if (state.ui.preview3dTransparencyInput) state.ui.preview3dTransparencyInput.onchange = e => setPreviewTransparency(e.target.checked);
  if (state.ui.preview3dGridInput) state.ui.preview3dGridInput.onchange = e => { state.preview.showGrid = e.target.checked; drawPreview3d(); };
  if (state.ui.previewSilhouetteInput) state.ui.previewSilhouetteInput.onchange = e => { state.preview.silhouette = e.target.checked; drawPreview3d(); };
  if (state.ui.preview3dResetViewButton) state.ui.preview3dResetViewButton.onclick = resetPreviewAngle;
  if (state.ui.preview3dExportButton) state.ui.preview3dExportButton.onclick = () => {
    const link = Object.assign(document.createElement("a"), { href: state.ui.preview3dCanvas.toDataURL("image/png"), download: "torus-3d-preview.png" });
    link.click();
  };
  if (state.ui.previewModeSolidButton) state.ui.previewModeSolidButton.onclick = () => setPreviewMode("solid");
  if (state.ui.previewModeTransparentButton) state.ui.previewModeTransparentButton.onclick = () => setPreviewMode("transparent");
  if (state.ui.previewModeXrayButton) state.ui.previewModeXrayButton.onclick = () => setPreviewMode("xray");
  if (state.ui.previewModeFrontButton) state.ui.previewModeFrontButton.onclick = () => setPreviewMode("front");
  if (state.ui.previewTwistInput) state.ui.previewTwistInput.oninput = e => { state.preview.twist = Number(e.target.value) || 0; drawPreview3d(); };
  if (state.ui.previewTwistResetButton) state.ui.previewTwistResetButton.onclick = () => { state.preview.twist = 0; state.ui.previewTwistInput.value = "0"; drawPreview3d(); };
  if (state.ui.shapeOutlineButton) state.ui.shapeOutlineButton.onclick = () => setShapeMode("outline");
  if (state.ui.shapeFillButton) state.ui.shapeFillButton.onclick = () => setShapeMode("fill");
  if (state.ui.selectTransformButton) state.ui.selectTransformButton.onclick = () => setSelectMode("transform");
  if (state.ui.selectPointsButton) state.ui.selectPointsButton.onclick = () => setSelectMode("points");
  if (state.ui.touchConstrainButton) state.ui.touchConstrainButton.onclick = () => toggleTouchModifier("constrain");
  if (state.ui.touchCenterButton) state.ui.touchCenterButton.onclick = () => toggleTouchModifier("center");
  if (state.ui.touchSnapButton) state.ui.touchSnapButton.onclick = () => toggleTouchModifier("snap");
  if (state.ui.duplicateSelectionButton) state.ui.duplicateSelectionButton.onclick = duplicateSelection;
  if (state.ui.deleteSelectionButton) state.ui.deleteSelectionButton.onclick = deleteSelection;
  if (state.ui.flipSelectionHButton) state.ui.flipSelectionHButton.onclick = () => flipSelection("h");
  if (state.ui.flipSelectionVButton) state.ui.flipSelectionVButton.onclick = () => flipSelection("v");
  if (state.ui.groupSelectionButton) state.ui.groupSelectionButton.onclick = groupSelection;
  if (state.ui.ungroupSelectionButton) state.ui.ungroupSelectionButton.onclick = ungroupSelection;
  if (state.ui.addPathPointButton) state.ui.addPathPointButton.onclick = addPathPoint;
  if (state.ui.togglePathPointModeButton) state.ui.togglePathPointModeButton.onclick = toggleSelectedPathPointMode;
  if (state.ui.deletePathPointButton) state.ui.deletePathPointButton.onclick = deleteSelectedPathPoint;
  if (state.ui.applySelectionSizeButton) state.ui.applySelectionSizeButton.onclick = () => applySelectionDimensions(state.ui.selectionWidthInput.value, state.ui.selectionHeightInput.value);
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
  state.ui.sizeInput.addEventListener("change", () => { saveCurrentSize(); applySelectedSize(state.ui.sizeInput.value); refreshSizeInput(); });
  state.ui.sizeInput.addEventListener("input", () => { if (state.tool === "select") applySelectedSize(state.ui.sizeInput.value); });
  state.ui.colorInput.addEventListener("input", () => { if (state.tool === "select") applySelectedColor(state.ui.colorInput.value); });
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
window.addEventListener("resize", () => { syncResponsiveMode(); syncShapeControls(); resizeCanvas(); drawPreview3d(); });
// Leaving the Size block commits the number, so shortcuts immediately work again.
document.addEventListener("pointerdown", event => {
  if (!state.ui.sizeBlock.contains(event.target)) blurSizeInput();
}, { capture: true });

syncResponsiveMode(); writeSurfaceControls(); syncEdgeUi(); syncImageUi(); renderLayerPanel(); syncPreviewTransparencyUi(); syncZoomSlider(); updateHistoryButtons(); resizeCanvas(); syncShapeControls();
chooseTool("pen"); setEraserMode("object");
restoreAutosave().then(() => { refreshSizeInput(); syncPreviewControls(); requestRender(); drawPreview3d(); });
