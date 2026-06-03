// One shared state object. Modules update this object, then ask the renderer to redraw.
export const DEFAULT_SURFACE = {
  v1: { x: 600, y: 0 },
  v2: { x: 0, y: -420 },
  repeatV1: true,
  repeatV2: true
};

export const state = {
  canvas: null,
  ctx: null,
  cssWidth: 1,
  cssHeight: 1,
  dpr: 1,

  objects: [],
  undoStack: [],
  redoStack: [],
  nextObjectId: 1,

  tool: "pen",
  eraserMode: "object",
  penSize: 4,
  eraserSize: 20,

  view: { x: 300, y: -210, zoom: 0.9 },
  surface: structuredClone(DEFAULT_SURFACE),
  hideGrid: false,

  background: { image: null, dataUrl: null, naturalWidth: 1, naturalHeight: 1 },
  imageFitMode: "crop",
  imageOpacity: 0.9,

  preview: { yaw: -0.74, pitch: 0.45, zoom: 1.0, dragging: false, last: null, enhanced: true },
  renderQueued: false,
  statusTimer: null,
  autosaveTimer: null,
  previewObject: null,
  homHoverId: null,
  homHoverOffset: { i: 0, j: 0 },
  homSelectedId: null,
  homSelectedOffset: { i: 0, j: 0 },

  ui: {}
};

export function cloneObject(object) {
  return { ...object, points: object.points.map(point => ({ ...point })) };
}
export function cloneObjects(objects) { return objects.map(cloneObject); }
