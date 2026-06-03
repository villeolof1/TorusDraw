// DOM lookup and small UI helpers. Keeping this separate avoids repeated getElementById calls.
import { state } from "./state.js";

export function collectDom() {
  const ids = [
    "drawingCanvas", "penButton", "lineButton", "eraseButton", "panButton", "eraserOptions",
    "eraseObjectButton", "eraseRubButton", "homButton", "undoButton", "redoButton", "clearButton", "colorInput",
    "sizeInput", "sizeBlock", "surfaceButton", "imageButton", "preview3dButton", "exportButton",
    "saveProjectButton", "projectInput", "surfacePanel", "imagePanel", "imageCloseButton", "imageSummary",
    "preview3dPanel", "preview3dCloseButton", "preview3dSummary", "helpPanel", "helpButton",
    "a1Input", "b1Input", "a2Input", "b2Input", "repeatV1Input", "repeatV2Input",
    "hideGridInput", "resetSurfaceButton", "centerViewButton", "fitCellButton", "updateSurfaceButton",
    "backgroundInput", "removeImageButton", "imageCropButton", "imageStretchButton", "imageOpacityInput",
    "opacityValue", "fitSurfaceToImageButton", "preview3dCanvas", "previewEnhancedInput", "zoomSlider", "zoomInButton",
    "zoomOutButton", "angleHint", "status"
  ];
  for (const id of ids) state.ui[id] = document.getElementById(id);
  state.canvas = state.ui.drawingCanvas;
  state.ctx = state.canvas.getContext("2d", { alpha: false });
}

export function openPanel(name) {
  // Surface is independent: users often keep it open while checking Image/3D/help.
  // Image, 3D, and help are mutually exclusive with each other so they never stack.
  const independentSurface = state.ui.surfacePanel;
  const floatingPanels = { image: state.ui.imagePanel, preview: state.ui.preview3dPanel, help: state.ui.helpPanel };

  if (name === "surface") {
    independentSurface.classList.toggle("open");
    return;
  }

  const target = floatingPanels[name];
  const shouldOpen = target && !target.classList.contains("open");
  for (const panel of Object.values(floatingPanels)) panel.classList.remove("open");
  if (target && shouldOpen) target.classList.add("open");
}

export function closePanels() {
  for (const panel of [state.ui.surfacePanel, state.ui.imagePanel, state.ui.preview3dPanel, state.ui.helpPanel]) panel.classList.remove("open");
}

export function closeFloatingPanelsOnly() {
  for (const panel of [state.ui.imagePanel, state.ui.preview3dPanel, state.ui.helpPanel]) panel.classList.remove("open");
}

export function showStatus(message, persistent = false) {
  if (state.statusTimer) clearTimeout(state.statusTimer);
  const status = state.ui.status;
  status.textContent = message || "";
  status.classList.toggle("visible", !!message);
  if (message && !persistent) state.statusTimer = setTimeout(() => status.classList.remove("visible"), 2200);
}

export function showAngleHint(point, degrees) {
  const hint = state.ui.angleHint;
  if (degrees == null) return hideAngleHint();
  hint.textContent = `${degrees}°`;
  hint.style.left = `${point.x}px`;
  hint.style.top = `${point.y}px`;
  hint.classList.add("visible");
}

export function hideAngleHint() { state.ui.angleHint.classList.remove("visible"); }
