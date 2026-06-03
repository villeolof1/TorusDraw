// Undo/redo stores semantic actions, not canvas pixels.
import { state, cloneObject, cloneObjects } from "./state.js";
import { requestRender } from "./render2d.js";
import { scheduleAutosave } from "./storage.js";
import { drawPreview3d } from "./preview3d.js";

export function updateHistoryButtons() {
  state.ui.undoButton.disabled = state.undoStack.length === 0;
  state.ui.redoButton.disabled = state.redoStack.length === 0;
}

export function addObject(object) {
  const saved = cloneObject(object);
  state.objects.push(saved);
  state.undoStack.push({ type: "add", object: cloneObject(saved) });
  state.redoStack = [];
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
  drawPreview3d();
}

export function replaceAll(before, after) {
  state.undoStack.push({ type: "replaceAll", before: cloneObjects(before), after: cloneObjects(after) });
  state.redoStack = [];
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
  drawPreview3d();
}

export function clearDrawing() {
  if (!state.objects.length) return;
  state.undoStack.push({ type: "clear", before: cloneObjects(state.objects) });
  state.objects = [];
  state.redoStack = [];
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
  drawPreview3d();
}

export function undo() {
  const action = state.undoStack.pop();
  if (!action) return;
  if (action.type === "add") state.objects = state.objects.filter(o => o.id !== action.object.id);
  if (action.type === "clear") state.objects = cloneObjects(action.before);
  if (action.type === "replaceAll") state.objects = cloneObjects(action.before);
  state.redoStack.push(action);
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
  drawPreview3d();
}

export function redo() {
  const action = state.redoStack.pop();
  if (!action) return;
  if (action.type === "add") state.objects.push(cloneObject(action.object));
  if (action.type === "clear") state.objects = [];
  if (action.type === "replaceAll") state.objects = cloneObjects(action.after);
  state.undoStack.push(action);
  updateHistoryButtons();
  scheduleAutosave();
  requestRender();
  drawPreview3d();
}
