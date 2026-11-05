"use strict";

(() => {
  const MAX_FILE_BYTES = 12_000_000;
  const MAX_PIXELS = 12_000_000;
  const MAX_MAIN_THREAD_PIXELS = 4_000_000;
  const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const extensionByType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  const input = document.getElementById("image-file");
  if (!input) return;

  const elements = {
    dropZone: document.getElementById("drop-zone"),
    status: document.getElementById("status-message"),
    workspace: document.getElementById("workspace"),
    fileName: document.getElementById("file-name"),
    fileMeta: document.getElementById("file-meta"),
    format: document.getElementById("format-select"),
    formatHint: document.getElementById("format-hint"),
    quality: document.getElementById("quality-range"),
    qualityValue: document.getElementById("quality-value"),
    qualityHint: document.getElementById("quality-hint"),
    backgroundField: document.getElementById("background-field"),
    backgroundColor: document.getElementById("background-color"),
    originalPreview: document.getElementById("original-preview"),
    originalSize: document.getElementById("original-size"),
    originalDimensions: document.getElementById("original-dimensions"),
    resultPreview: document.getElementById("result-preview"),
    resultPlaceholder: document.getElementById("result-placeholder"),
    resultSize: document.getElementById("result-size"),
    resultDimensions: document.getElementById("result-dimensions"),
    resultSummary: document.getElementById("result-summary"),
    compress: document.getElementById("compress-button"),
    savingIndicator: document.getElementById("saving-indicator"),
    savingTitle: document.getElementById("saving-title"),
    savingDetails: document.getElementById("saving-details"),
    download: document.getElementById("download-button"),
    originalOffer: document.getElementById("original-offer"),
    originalDownload: document.getElementById("original-download"),
    lowerQuality: document.getElementById("lower-quality-button"),
    startOver: document.getElementById("start-over-button"),
    reset: document.getElementById("reset-button")
  };
  const toolCard = document.querySelector(".tool-card");

  let originalFile = null;
  let originalUrl = null;
  let resultUrl = null;
  let isProcessing = false;
  let isLoading = false;
  let currentPixelCount = 0;

  const formatBytes = (bytes) => {
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(2)} KB`;
    return `${(bytes / 1_000_000).toFixed(2)} MB`;
  };

  function setStatus(message, kind = "") {
    elements.status.textContent = message;
    if (kind) elements.status.dataset.kind = kind;
    else delete elements.status.dataset.kind;
  }

  setStatus("");

  function releaseResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    elements.resultPreview.removeAttribute("src");
    elements.resultPreview.hidden = true;
    elements.resultPlaceholder.hidden = false;
    elements.resultSize.textContent = "Not processed yet";
    elements.resultSummary.hidden = true;
    elements.resultSummary.classList.remove("is-larger");
    elements.originalOffer.hidden = true;
    elements.lowerQuality.hidden = true;
    elements.download.removeAttribute("href");
    elements.download.removeAttribute("download");
    elements.originalDownload.removeAttribute("href");
    elements.originalDownload.removeAttribute("download");
  }

  function clearImage() {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = null;
    originalFile = null;
    currentPixelCount = 0;
    releaseResult();
    elements.originalPreview.removeAttribute("src");
    elements.workspace.hidden = true;
    elements.dropZone.hidden = false;
    elements.fileName.textContent = "";
    elements.fileMeta.textContent = "";
    elements.originalSize.textContent = "";
    elements.originalDimensions.textContent = "";
    input.value = "";
  }

  function selectedType() {
    return elements.format.value === "auto" ? originalFile.type : elements.format.value;
  }

  function updateSettings() {
    if (!originalFile) return;
    const type = selectedType();
    const isPng = type === "image/png";
    const isJpeg = type === "image/jpeg";
    elements.quality.disabled = isPng;
    elements.qualityValue.textContent = `${elements.quality.value}%`;
    elements.qualityHint.textContent = isPng
      ? "PNG uses lossless encoding; this quality control does not apply."
      : "Lower quality usually means a smaller file, with some image detail lost.";
    elements.backgroundField.hidden = !isJpeg;
    if (elements.format.value === "auto") {
      elements.formatHint.textContent = `The output will remain ${extensionByType[type].toUpperCase()}.`;
    } else if (isJpeg) {
      elements.formatHint.textContent = "JPG has no transparency; choose a background colour below.";
    } else if (isPng) {
      elements.formatHint.textContent = "PNG preserves transparency; quality setting does not apply.";
    } else {
      elements.formatHint.textContent = "WebP transparency is preserved when supported by your browser.";
    }
  }

  function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dimensions);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("This image could not be decoded. It may be corrupted or use an unsupported encoding."));
      };
      image.src = url;
    });
  }

  async function detectFileType(file) {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (header.length >= 8
      && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
      && header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a) {
      return "image/png";
    }
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return "image/jpeg";
    }
    if (header.length >= 12
      && String.fromCharCode(...header.subarray(0, 4)) === "RIFF"
      && String.fromCharCode(...header.subarray(8, 12)) === "WEBP") {
      return "image/webp";
    }
    return "";
  }

  async function isAnimatedWebP(file) {
    if (file.type !== "image/webp") return false;
    const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
    const text = (start, end) => String.fromCharCode(...header.subarray(start, end));
    return header.length >= 21
      && text(0, 4) === "RIFF"
      && text(8, 12) === "WEBP"
      && text(12, 16) === "VP8X"
      && (header[20] & 0x02) !== 0;
  }

  async function loadFile(file) {
    if (!file) return;
    if (isProcessing || isLoading) {
      setStatus("Wait for the current compression to finish before choosing another image.", "error");
      input.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus("This file is larger than the 12 MB limit. Choose a smaller image.", "error");
      input.value = "";
      return;
    }
    if (file.size === 0) {
      setStatus("This file is empty. Choose a valid image file.", "error");
      input.value = "";
      return;
    }
    clearImage();
    isLoading = true;
    elements.dropZone.hidden = true;
    setStatus("Checking image…");
    try {
      const type = await detectFileType(file);
      if (!SUPPORTED_TYPES.has(type)) {
        throw new Error("Choose a valid JPG, PNG or WebP image. Animated GIF, SVG and HEIC files are not supported.");
      }
      const normalizedFile = file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
      if (await isAnimatedWebP(normalizedFile)) {
        throw new Error("Animated WebP files are not supported. Choose a still image instead.");
      }
      const dimensions = await getImageDimensions(normalizedFile);
      if (!dimensions.width || !dimensions.height) throw new Error("This image has invalid dimensions.");
      if (dimensions.width * dimensions.height > MAX_PIXELS) {
        throw new Error(`This image has too many pixels for processing (${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()}). The limit is 12 megapixels.`);
      }
      originalFile = normalizedFile;
      currentPixelCount = dimensions.width * dimensions.height;
      originalUrl = URL.createObjectURL(normalizedFile);
      elements.originalPreview.src = originalUrl;
      elements.fileName.textContent = normalizedFile.name;
      elements.fileMeta.textContent = `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()} px · ${formatBytes(normalizedFile.size)}`;
      elements.originalSize.textContent = formatBytes(normalizedFile.size);
      elements.originalDimensions.textContent = `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()} px`;
      elements.workspace.hidden = false;
      elements.dropZone.hidden = true;
      elements.format.value = "auto";
      updateSettings();
      setStatus("Image ready. Choose your settings and compress when you are ready.", "success");
    } catch (error) {
      clearImage();
      setStatus(error instanceof Error ? error.message : "The image could not be opened. Try a different file.", "error");
      input.value = "";
    } finally {
      isLoading = false;
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Your browser could not encode this image. Try another output format."));
          return;
        }
        resolve(blob);
      }, type, quality);
    });
  }

  async function compressOnMainThread(file, type, quality, background) {
    let bitmap;
    let image;
    let imageUrl;
    try {
      let source;
      let width;
      let height;
      if ("createImageBitmap" in window) {
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch {
          bitmap = await createImageBitmap(file);
        }
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
      } else {
        imageUrl = URL.createObjectURL(file);
        image = new Image();
        image.src = imageUrl;
        await image.decode();
        source = image;
        width = image.naturalWidth;
        height = image.naturalHeight;
      }
      if (width * height > MAX_PIXELS) throw new Error("This image exceeds the 12-megapixel processing limit.");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: type !== "image/jpeg" });
      if (!context) throw new Error("Your browser could not prepare an image canvas.");
      if (type === "image/jpeg") {
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(source, 0, 0);
      const blob = await canvasToBlob(canvas, type, quality);
      return { blob, width, height };
    } finally {
      if (bitmap) bitmap.close();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    }
  }

  function compressInWorker(file, type, quality, background) {
    return new Promise((resolve, reject) => {
      const fallbackToMainThread = () => {
        if (currentPixelCount > MAX_MAIN_THREAD_PIXELS) {
          reject(new Error("This browser cannot process images above 4 megapixels in the background. Try a current browser with Web Worker and OffscreenCanvas support, or use a smaller image."));
          return;
        }
        compressOnMainThread(file, type, quality, background).then(resolve, reject);
      };
      let worker;
      try {
        worker = new Worker("compressor-worker.js");
      } catch {
        fallbackToMainThread();
        return;
      }
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if (data.error === "Canvas image processing is not available in this worker.") {
          fallbackToMainThread();
        } else if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = () => {
        worker.terminate();
        fallbackToMainThread();
      };
      try {
        worker.postMessage({ file, type, quality, background, maxPixels: MAX_PIXELS });
      } catch {
        worker.terminate();
        fallbackToMainThread();
      }
    });
  }

  function makeOutputName(fileName, type) {
    const base = fileName.replace(/\.[^.]*$/, "") || "image";
    return `${base}-compressed.${extensionByType[type]}`;
  }

  async function compress() {
    if (!originalFile || isProcessing) return;
    const file = originalFile;
    const type = selectedType();
    const quality = Number(elements.quality.value) / 100;
    const background = elements.backgroundColor.value;
    releaseResult();
    isProcessing = true;
    elements.reset.disabled = true;
    elements.format.disabled = true;
    elements.quality.disabled = true;
    elements.backgroundColor.disabled = true;
    elements.lowerQuality.disabled = true;
    setStatus("Compressing image in your browser…");
    toolCard.classList.add("is-processing");
    elements.workspace.setAttribute("aria-busy", "true");
    elements.compress.disabled = true;
    elements.compress.textContent = "Compressing…";
    try {
      const { blob, width, height } = await compressInWorker(file, type, quality, background);
      if (blob.type !== type) {
        const formatName = type === "image/webp" ? "WebP" : type === "image/png" ? "PNG" : "JPG";
        throw new Error(`${formatName} encoding is not available in this browser. Choose another output format.`);
      }
      if (originalFile !== file) return;
      resultUrl = URL.createObjectURL(blob);
      elements.resultPreview.src = resultUrl;
      elements.resultPreview.hidden = false;
      elements.resultPlaceholder.hidden = true;
      elements.resultSize.textContent = formatBytes(blob.size);
      elements.resultDimensions.textContent = `${width.toLocaleString()} × ${height.toLocaleString()} px`;
      const saved = file.size - blob.size;
      const percent = file.size > 0 ? Math.abs(saved) / file.size * 100 : 0;
      const formatName = type === "image/jpeg" ? "JPG" : type === "image/png" ? "PNG" : "WebP";
      const qualityDetails = type === "image/png" ? "lossless PNG" : `${Math.round(quality * 100)}% quality`;
      const sizeDetails = `${formatBytes(file.size)} original → ${formatBytes(blob.size)} result · ${formatName}, ${qualityDetails}`;
      elements.resultSummary.hidden = false;
      elements.download.href = resultUrl;
      elements.download.download = makeOutputName(file.name, type);
      if (saved > 0) {
        elements.savingIndicator.textContent = "−";
        elements.savingTitle.textContent = `${formatBytes(saved)} smaller (${percent.toFixed(1)}% reduction)`;
        elements.savingDetails.textContent = sizeDetails;
        elements.originalOffer.hidden = true;
        setStatus("Compression complete. Compare the previews before downloading.", "success");
      } else if (saved < 0) {
        elements.resultSummary.classList.add("is-larger");
        elements.savingIndicator.textContent = "+";
        elements.savingTitle.textContent = `${formatBytes(-saved)} larger (${percent.toFixed(1)} increase)`;
        elements.savingDetails.textContent = sizeDetails;
        elements.originalOffer.hidden = false;
        elements.originalDownload.href = originalUrl;
        elements.originalDownload.download = file.name;
        const nextQuality = Math.max(Number(elements.quality.min), Number(elements.quality.value) - 10);
        elements.lowerQuality.hidden = !["image/jpeg", "image/webp"].includes(type)
          || nextQuality >= Number(elements.quality.value);
        if (!elements.lowerQuality.hidden) {
          elements.lowerQuality.textContent = `Try ${nextQuality}% quality`;
        }
        setStatus("The encoded image is larger than the original. Try a lower quality or another format, or download the original.", "error");
      } else {
        elements.savingIndicator.textContent = "=";
        elements.savingTitle.textContent = "Same file size";
        elements.savingDetails.textContent = sizeDetails;
        elements.originalOffer.hidden = true;
        setStatus("The output is the same size as the original; no space was saved.", "success");
      }
    } catch (error) {
      releaseResult();
      setStatus(error instanceof Error ? error.message : "Compression failed. Try another image or output format.", "error");
    } finally {
      isProcessing = false;
      elements.reset.disabled = false;
      elements.format.disabled = false;
      elements.backgroundColor.disabled = false;
      elements.lowerQuality.disabled = false;
      elements.compress.disabled = false;
      elements.compress.textContent = "Compress again";
      toolCard.classList.remove("is-processing");
      elements.workspace.removeAttribute("aria-busy");
      updateSettings();
    }
  }

  input.addEventListener("change", () => loadFile(input.files && input.files[0]));
  elements.lowerQuality.addEventListener("click", () => {
    elements.quality.value = String(Math.max(Number(elements.quality.min), Number(elements.quality.value) - 10));
    elements.quality.dispatchEvent(new Event("input", { bubbles: true }));
    compress();
  });
  elements.format.addEventListener("change", () => {
    updateSettings();
    releaseResult();
    setStatus("Settings changed. Compress again to see the updated result.");
  });
  elements.quality.addEventListener("input", () => {
    elements.qualityValue.textContent = `${elements.quality.value}%`;
    releaseResult();
    setStatus("Settings changed. Compress again to see the updated result.");
  });
  elements.backgroundColor.addEventListener("input", () => {
    releaseResult();
    setStatus("Settings changed. Compress again to see the updated result.");
  });
  elements.reset.addEventListener("click", () => {
    clearImage();
    setStatus("");
    elements.format.value = "auto";
    elements.quality.value = "80";
    elements.qualityValue.textContent = "80%";
    elements.backgroundColor.value = "#ffffff";
    elements.compress.textContent = "Compress image";
    input.focus();
  });
  elements.startOver.addEventListener("click", () => elements.reset.click());
  elements.compress.addEventListener("click", compress);
  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
  elements.dropZone.addEventListener("dragleave", (event) => {
    if (!elements.dropZone.contains(event.relatedTarget)) elements.dropZone.classList.remove("is-dragging");
  });
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
    loadFile(event.dataTransfer && event.dataTransfer.files[0]);
  });
  window.addEventListener("pagehide", () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
})();
