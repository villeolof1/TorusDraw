// One shared state object. Modules update this object, then ask the renderer to redraw.
export const DEFAULT_SURFACE = {
  v1: { x: 600, y: 0 },
  v2: { x: 0, y: -420 },
  repeatV1: true,
  repeatV2: true,
  edgeLinks: {
    v1: { active: true, label: "A", edges: ["left", "right"], direction: { left: 1, right: 1 } },
    v2: { active: true, label: "B", edges: ["bottom", "top"], direction: { bottom: 1, top: 1 } }
  }
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
  dotSize: 20,
  eraserSize: 20,

  view: { x: 300, y: -210, zoom: 0.9 },
  surface: structuredClone(DEFAULT_SURFACE),
  hideGrid: false,

  background: { image: null, dataUrl: null, naturalWidth: 1, naturalHeight: 1 },
  imageFitMode: "crop",
  imageOpacity: 0.9,

  // Layers are stored back-to-front. The image layer starts at the back;
  // new drawing layers are added at the front.
  layers: [
    { id: "image-background", type: "image", name: "Image", opacity: 0.9, visible: true },
    { id: "layer-1", type: "drawing", name: "Layer 1", opacity: 1, visible: true }
  ],
  activeLayerId: "layer-1",
  nextLayerId: 2,

  preview: { yaw: -0.74, pitch: 0.45, zoom: 1.0, transparent: true, opacity: 0.8, dragging: false, last: null, enhanced: true },
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
