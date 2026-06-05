// DOM lookup and small UI helpers. Keeping this separate avoids repeated getElementById calls.
import { state } from "./state.js";

export function collectDom() {
  const ids = [
    "drawingCanvas", "penButton", "lineButton", "ellipseButton", "rectangleButton", "dotButton", "selectButton", "eraseButton", "panButton", "eraserOptions",
    "eraseObjectButton", "eraseRubButton", "homButton", "undoButton", "redoButton", "clearButton", "colorInput",
    "sizeInput", "sizeBlock", "shapeModeControls", "shapeOutlineButton", "shapeFillButton", "selectModeControls", "selectTransformButton", "selectPointsButton",
    "selectionActions", "duplicateSelectionButton", "deleteSelectionButton", "flipSelectionHButton", "flipSelectionVButton", "groupSelectionButton", "ungroupSelectionButton", "addPathPointButton", "togglePathPointModeButton", "deletePathPointButton", "selectionWidthInput", "selectionHeightInput", "applySelectionSizeButton", "touchConstrainButton", "touchCenterButton", "touchSnapButton", "mobileModifierBar",
    "surfaceButton", "imageButton", "preview3dButton", "exportButton", "saveProjectButton", "projectInput",
    "surfacePanel", "surfaceCloseButton", "imagePanel", "imageCloseButton", "imageSummary", "addLayerButton", "layerList", "imageLayerCard", "imageLayerThumb", "imageLayerStatus", "imageLayerVisibilityButton", "moveLayerUpButton", "moveLayerDownButton",
    "preview3dPanel", "preview3dCloseButton", "preview3dSummary", "preview3dTransparencyInput", "preview3dGridInput", "preview3dResetViewButton", "preview3dExportButton", "previewModeSolidButton", "previewModeTransparentButton", "previewModeXrayButton", "previewModeFrontButton", "previewSilhouetteInput", "surfaceAccuracyText",
    "helpPanel", "helpCloseButton", "helpButton",
    "a1Input", "b1Input", "a2Input", "b2Input", "repeatV1Input", "repeatV2Input",
    "edgeDiagram", "edgeStatus", "removeV1LinkButton", "removeV2LinkButton", "hideGridInput", "resetSurfaceButton", "centerViewButton", "fitCellButton", "updateSurfaceButton", "presetDefaultButton", "presetSquareButton", "presetRhombusButton", "presetGoldenButton",
    "backgroundInput", "removeImageButton", "imageCropButton", "imageStretchButton", "imageOpacityInput",
    "opacityValue", "fitSurfaceToImageButton", "preview3dCanvas", "previewTwistInput", "previewTwistResetButton", "zoomSlider", "zoomInButton",
    "zoomOutButton", "angleHint", "status"
  ];
  for (const id of ids) state.ui[id] = document.getElementById(id);
  state.canvas = state.ui.drawingCanvas;
  state.ctx = state.canvas.getContext("2d", { alpha: false });
}

export function openPanel(name) {
  // Keep the interface split into two non-overlapping stacks:
  // right side: Image/Surface, bottom-left: Help/3D.
  const rightPanels = { image: state.ui.imagePanel, surface: state.ui.surfacePanel };
  const leftPanels = { preview: state.ui.preview3dPanel, help: state.ui.helpPanel };
  const group = rightPanels[name] ? rightPanels : leftPanels[name] ? leftPanels : null;
  if (!group) return;

  const target = group[name];
  const shouldOpen = target && !target.classList.contains("open");
  for (const panel of Object.values(group).filter(Boolean)) panel.classList.remove("open");
  if (target && shouldOpen) target.classList.add("open");
}

export function closePanels() {
  for (const panel of [state.ui.surfacePanel, state.ui.imagePanel, state.ui.preview3dPanel, state.ui.helpPanel].filter(Boolean)) panel.classList.remove("open");
}

export function closeFloatingPanelsOnly() {
  for (const panel of [state.ui.imagePanel, state.ui.surfacePanel, state.ui.preview3dPanel, state.ui.helpPanel].filter(Boolean)) panel.classList.remove("open");
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
