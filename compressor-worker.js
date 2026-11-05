"use strict";

self.onmessage = async ({ data }) => {
  const { file, type, quality, background, maxPixels } = data;
  let bitmap;
  try {
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
      throw new Error("Canvas image processing is not available in this worker.");
    }
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height || width * height > maxPixels) {
      throw new Error("This image exceeds the 12-megapixel processing limit.");
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: type !== "image/jpeg" });
    if (!context) throw new Error("Your browser could not prepare an image canvas.");
    if (type === "image/jpeg") {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type, quality });
    self.postMessage({ blob, width, height });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "The browser could not process this image." });
  } finally {
    if (bitmap) bitmap.close();
  }
};
