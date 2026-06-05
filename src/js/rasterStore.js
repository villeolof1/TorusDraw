// Runtime raster cache for destructive paint operations.
// Objects store imageDataUrl for save/load; canvases live here so erasing and
// rendering are synchronous and never depend on async Image loading.
const canvases = new Map();
const images = new Map();

export function setRasterCanvas(id, canvas) {
  if (id == null || !canvas) return;
  canvases.set(id, canvas);
  images.delete(id);
}

export function clearRasterCanvas(id) {
  canvases.delete(id);
  images.delete(id);
}

export function getRasterCanvas(object, onReady = null) {
  if (!object || object.id == null) return null;
  const cached = canvases.get(object.id);
  if (cached && (!object.imageDataUrl || cached.__sourceDataUrl === object.imageDataUrl)) return cached;
  if (cached) canvases.delete(object.id);
  if (!object.imageDataUrl) return null;
  const imageCached = images.get(object.id);
  if (imageCached?.src === object.imageDataUrl && imageCached.image.complete && imageCached.image.naturalWidth) {
    const canvas = document.createElement("canvas");
    canvas.width = imageCached.image.naturalWidth;
    canvas.height = imageCached.image.naturalHeight;
    canvas.getContext("2d").drawImage(imageCached.image, 0, 0);
    canvas.__sourceDataUrl = object.imageDataUrl;
    canvases.set(object.id, canvas);
    return canvas;
  }
  if (!imageCached || imageCached.src !== object.imageDataUrl) {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || 1;
      canvas.height = image.naturalHeight || 1;
      canvas.getContext("2d").drawImage(image, 0, 0);
      canvas.__sourceDataUrl = object.imageDataUrl;
      canvases.set(object.id, canvas);
      if (typeof onReady === "function") onReady();
    };
    image.src = object.imageDataUrl;
    images.set(object.id, { src: object.imageDataUrl, image });
  }
  return null;
}

export function snapshotRasterCanvas(object) {
  const canvas = getRasterCanvas(object);
  return canvas ? canvas.toDataURL("image/png") : object?.imageDataUrl;
}
