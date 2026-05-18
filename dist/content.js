"use strict";
(() => {
  // src/extension.ts
  var ext = globalThis.browser || globalThis.chrome;
  var useBrowser = typeof globalThis.browser !== "undefined";
  function isExtensionContextValid() {
    try {
      return !!ext?.runtime?.id;
    } catch {
      return false;
    }
  }
  function storageLocalGet(keys) {
    if (!isExtensionContextValid() || !ext?.storage?.local?.get) {
      return Promise.resolve({});
    }
    try {
      if (useBrowser) {
        return ext.storage.local.get(keys).catch(
          () => ({})
        );
      }
      return new Promise((resolve) => {
        ext.storage.local.get(keys, (result) => {
          void ext.runtime?.lastError;
          resolve(result || {});
        });
      });
    } catch {
      return Promise.resolve({});
    }
  }
  function storageLocalSet(items) {
    if (!isExtensionContextValid() || !ext?.storage?.local?.set) {
      return Promise.resolve();
    }
    try {
      if (useBrowser) {
        return ext.storage.local.set(items).catch(() => void 0);
      }
      return new Promise((resolve) => {
        ext.storage.local.set(items, () => {
          void ext.runtime?.lastError;
          resolve();
        });
      });
    } catch {
      return Promise.resolve();
    }
  }
  function runtimeOnMessageAddListener(listener) {
    if (!isExtensionContextValid() || !ext?.runtime?.onMessage?.addListener) return;
    try {
      ext.runtime.onMessage.addListener((message) => {
        listener(message);
        return void 0;
      });
    } catch {
    }
  }
  function storageOnChangedAddListener(listener) {
    if (!isExtensionContextValid() || !ext?.storage?.onChanged?.addListener) return;
    try {
      ext.storage.onChanged.addListener(listener);
    } catch {
    }
  }
  function runtimeGetURL(path) {
    try {
      if (ext?.runtime?.getURL) return ext.runtime.getURL(path);
    } catch {
    }
    return path;
  }

  // src/content.ts
  var STORAGE_KEY = "disabledHosts";
  var COUNT_KEY = "sanitizedCount";
  var BANNER_ID = "__k00_sanitizer_banner__";
  var processingInputs = /* @__PURE__ */ new WeakSet();
  var syntheticTransfers = /* @__PURE__ */ new WeakSet();
  var enabledForHost = true;
  var currentHost = window.location.hostname;
  var heavyPromise = null;
  function loadHeavy() {
    if (!heavyPromise) {
      const url = runtimeGetURL("dist/heavy.js");
      heavyPromise = import(url);
    }
    return heavyPromise;
  }
  async function getDisabledHosts() {
    const result = await storageLocalGet([STORAGE_KEY]);
    return result[STORAGE_KEY] || {};
  }
  async function incrementSanitizedCount(by) {
    if (by <= 0) return;
    const result = await storageLocalGet([COUNT_KEY]);
    const current = Number(result[COUNT_KEY] || 0);
    await storageLocalSet({ [COUNT_KEY]: current + by });
  }
  async function updateEnabledState() {
    const disabledHosts = await getDisabledHosts();
    enabledForHost = !disabledHosts[currentHost];
  }
  function showBanner(message, type = "info") {
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement("div");
      banner.id = BANNER_ID;
      banner.style.position = "fixed";
      banner.style.left = "12px";
      banner.style.bottom = "12px";
      banner.style.zIndex = "2147483647";
      banner.style.maxWidth = "480px";
      banner.style.padding = "10px 12px";
      banner.style.font = "12px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      banner.style.boxShadow = "0 6px 18px rgba(0,0,0,0.2)";
      banner.style.color = "#fff";
      document.documentElement.appendChild(banner);
    }
    banner.textContent = message;
    banner.style.background = type === "error" ? "#b00020" : "#111";
    window.setTimeout(() => banner?.remove(), 5e3);
  }
  function isPdfFile(file) {
    if (file.type === "application/pdf") return true;
    return file.name.toLowerCase().endsWith(".pdf");
  }
  function isDocxFile(file) {
    if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return true;
    }
    return file.name.toLowerCase().endsWith(".docx");
  }
  function isMp4File(file) {
    if (file.type === "video/mp4") return true;
    return file.name.toLowerCase().endsWith(".mp4");
  }
  function isMp3File(file) {
    if (file.type === "audio/mpeg") return true;
    return file.name.toLowerCase().endsWith(".mp3");
  }
  function isImageFile(file) {
    return file.type.startsWith("image/");
  }
  function isHeicFile(file) {
    if (file.type === "image/heic" || file.type === "image/heif") return true;
    return /\.(heic|heif)$/i.test(file.name);
  }
  function categorizeFiles(files) {
    const result = { images: [], pdfs: [], docx: [], mp4: [], mp3: [], other: [] };
    for (const file of files) {
      if (isImageFile(file)) result.images.push(file);
      else if (isPdfFile(file)) result.pdfs.push(file);
      else if (isDocxFile(file)) result.docx.push(file);
      else if (isMp4File(file)) result.mp4.push(file);
      else if (isMp3File(file)) result.mp3.push(file);
      else result.other.push(file);
    }
    return result;
  }
  function totalSanitizableCount(c) {
    return c.images.length + c.pdfs.length + c.docx.length + c.mp4.length + c.mp3.length;
  }
  function filesFromClipboard(items) {
    if (!items) return [];
    const out = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) out.push(file);
    }
    return out;
  }
  function getExtensionForMime(mime) {
    switch (mime) {
      case "image/jpeg":
        return "jpg";
      case "image/png":
        return "png";
      case "image/webp":
        return "webp";
      case "image/gif":
        return "gif";
      case "image/bmp":
        return "bmp";
      case "video/mp4":
        return "mp4";
      case "audio/mpeg":
        return "mp3";
      default:
        return "png";
    }
  }
  function safeFilename(originalName, mime) {
    if (originalName && originalName.trim()) return originalName;
    const ext2 = getExtensionForMime(mime);
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    return `sanitized-${stamp}.${ext2}`;
  }
  async function imageToBlob(bitmap, mime) {
    const width = bitmap.width;
    const height = bitmap.height;
    const quality = mime === "image/jpeg" || mime === "image/webp" ? 0.92 : void 0;
    if ("OffscreenCanvas" in window) {
      const canvas2 = new OffscreenCanvas(width, height);
      const ctx2 = canvas2.getContext("2d", { alpha: true });
      if (!ctx2) throw new Error("No 2d context");
      ctx2.drawImage(bitmap, 0, 0);
      return canvas2.convertToBlob({ type: mime || "image/png", quality });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("No 2d context");
    ctx.drawImage(bitmap, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Failed to create blob")),
        mime || "image/png",
        quality
      );
    });
  }
  async function sanitizeImage(file) {
    const mime = file.type || "image/png";
    const bitmap = await createImageBitmap(file);
    const blob = await imageToBlob(bitmap, mime);
    return new File([blob], safeFilename(file.name, mime), {
      type: blob.type || mime,
      lastModified: Date.now()
    });
  }
  var MP4_CONTAINER_BOXES = /* @__PURE__ */ new Set([
    "moov",
    "trak",
    "mdia",
    "minf",
    "stbl",
    "edts",
    "dinf",
    "mvex",
    "moof",
    "traf",
    "mfra"
  ]);
  var MP4_STRIP_BOXES = /* @__PURE__ */ new Set(["udta", "meta", "ilst", "uuid"]);
  function readFourCC(view, offset) {
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
  }
  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0);
  }
  function writeFourCC(view, offset, value) {
    for (let i = 0; i < 4; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i) || 0);
    }
  }
  function concatChunks(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
  function* iterBoxes(view, start, end) {
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      const type = readFourCC(view, pos + 4);
      let headerSize = 8;
      if (size === 1) {
        if (pos + 16 > end) break;
        const hi = view.getUint32(pos + 8);
        const lo = view.getUint32(pos + 12);
        size = Number((BigInt(hi) << 32n) + BigInt(lo));
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end) break;
      yield { type, contentStart: pos + headerSize, boxEnd: pos + size };
      pos += size;
    }
  }
  function trakHandlerType(view, contentStart, contentEnd) {
    for (const mdia of iterBoxes(view, contentStart, contentEnd)) {
      if (mdia.type !== "mdia") continue;
      for (const hdlr of iterBoxes(view, mdia.contentStart, mdia.boxEnd)) {
        if (hdlr.type !== "hdlr") continue;
        return readFourCC(view, hdlr.contentStart + 8);
      }
    }
    return null;
  }
  function parseMp4Boxes(bytes, start, end) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [];
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      const type = readFourCC(view, pos + 4);
      let headerSize = 8;
      if (size === 1) {
        if (pos + 16 > end) break;
        const hi = view.getUint32(pos + 8);
        const lo = view.getUint32(pos + 12);
        size = Number((BigInt(hi) << 32n) + BigInt(lo));
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end) break;
      const boxEnd = pos + size;
      if (MP4_STRIP_BOXES.has(type)) {
        pos = boxEnd;
        continue;
      }
      if (type === "trak" && trakHandlerType(view, pos + headerSize, boxEnd) === "meta") {
        pos = boxEnd;
        continue;
      }
      if (MP4_CONTAINER_BOXES.has(type)) {
        const childChunks = parseMp4Boxes(bytes, pos + headerSize, boxEnd);
        const payload = concatChunks(childChunks);
        const newSize = headerSize + payload.length;
        const header = new Uint8Array(headerSize);
        const headerView = new DataView(header.buffer);
        if (headerSize === 16) {
          writeUint32(headerView, 0, 1);
          writeFourCC(headerView, 4, type);
          const sizeBig = BigInt(newSize);
          writeUint32(headerView, 8, Number(sizeBig >> 32n & 0xffffffffn));
          writeUint32(headerView, 12, Number(sizeBig & 0xffffffffn));
        } else {
          writeUint32(headerView, 0, newSize);
          writeFourCC(headerView, 4, type);
        }
        chunks.push(header, payload);
        pos = boxEnd;
        continue;
      }
      chunks.push(bytes.subarray(pos, boxEnd));
      pos = boxEnd;
    }
    return chunks;
  }
  async function sanitizeMp4(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cleaned = concatChunks(parseMp4Boxes(bytes, 0, bytes.length));
    return new File([cleaned], safeFilename(file.name, "video/mp4"), {
      type: "video/mp4",
      lastModified: Date.now()
    });
  }
  function decodeSyncSafe(sizeBytes) {
    return (sizeBytes[0] & 127) << 21 | (sizeBytes[1] & 127) << 14 | (sizeBytes[2] & 127) << 7 | sizeBytes[3] & 127;
  }
  function stripId3v2(bytes) {
    if (bytes.length < 10) return bytes;
    if (bytes[0] !== 73 || bytes[1] !== 68 || bytes[2] !== 51) return bytes;
    const size = decodeSyncSafe(bytes.subarray(6, 10));
    const total = 10 + size;
    if (total > bytes.length) return bytes;
    return bytes.subarray(total);
  }
  function stripId3v1(bytes) {
    if (bytes.length < 128) return bytes;
    const start = bytes.length - 128;
    if (bytes[start] === 84 && bytes[start + 1] === 65 && bytes[start + 2] === 71) {
      return bytes.subarray(0, start);
    }
    return bytes;
  }
  function stripApeTag(bytes) {
    if (bytes.length < 32) return bytes;
    const end = bytes.length;
    const footerStart = end - 32;
    const footer = bytes.subarray(footerStart, end);
    const isFooter = footer[0] === 65 && footer[1] === 80 && footer[2] === 69 && footer[3] === 84 && footer[4] === 65 && footer[5] === 71 && footer[6] === 69 && footer[7] === 88;
    if (!isFooter) return bytes;
    const size = footer[12] | footer[13] << 8 | footer[14] << 16 | footer[15] << 24;
    if (size <= 0 || size > bytes.length) return bytes;
    const start = end - size;
    if (start < 0) return bytes;
    return bytes.subarray(0, start);
  }
  async function sanitizeMp3(file) {
    let bytes = new Uint8Array(await file.arrayBuffer());
    bytes = stripId3v2(bytes);
    bytes = stripApeTag(bytes);
    bytes = stripId3v1(bytes);
    return new File([bytes], safeFilename(file.name, "audio/mpeg"), {
      type: "audio/mpeg",
      lastModified: Date.now()
    });
  }
  async function sanitizeAll(c) {
    const jobs = [];
    const run = (file, work) => jobs.push(
      work().then(
        (f) => ({ file: f }),
        () => ({
          error: isHeicFile(file) ? `${file.name || "HEIC"}: HEIC kan de browser niet schonen, geblokkeerd` : `${file.name || "bestand"}: schonen mislukt, geblokkeerd`
        })
      )
    );
    for (const f of c.images) run(f, () => sanitizeImage(f));
    for (const f of c.mp4) run(f, () => sanitizeMp4(f));
    for (const f of c.mp3) run(f, () => sanitizeMp3(f));
    if (c.pdfs.length || c.docx.length) {
      const heavy = loadHeavy();
      for (const f of c.pdfs) run(f, async () => (await heavy).sanitizePdf(f));
      for (const f of c.docx) run(f, async () => (await heavy).sanitizeDocx(f));
    }
    const results = await Promise.all(jobs);
    const files = [];
    const failures = [];
    for (const r of results) {
      if ("file" in r) files.push(r.file);
      else failures.push(r.error);
    }
    return { files, failures };
  }
  function setInputFiles(input, files) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function tryDispatchPaste(target, files) {
    try {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      syntheticTransfers.add(dt);
      const evt = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      });
      target?.dispatchEvent(evt);
      return true;
    } catch {
      return false;
    }
  }
  function tryDispatchDrop(target, files) {
    try {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      syntheticTransfers.add(dt);
      const evt = new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true
      });
      target?.dispatchEvent(evt);
      return true;
    } catch {
      return false;
    }
  }
  function deliverFiles(target, files, mode) {
    if (!files.length) return true;
    if (mode === "drop" && target instanceof HTMLInputElement && target.type === "file") {
      setInputFiles(target, files);
      return true;
    }
    return mode === "paste" ? tryDispatchPaste(target, files) : tryDispatchDrop(target, files);
  }
  function reportFailures(failures) {
    if (!failures.length) return;
    const head = failures.slice(0, 3).join(" | ");
    const extra = failures.length > 3 ? ` (+${failures.length - 3})` : "";
    showBanner(`K00 Sanitizer: ${head}${extra}`, "error");
  }
  function teardown() {
    document.removeEventListener("paste", onPaste, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("change", onChange, true);
  }
  function stale() {
    if (isExtensionContextValid()) return false;
    teardown();
    return true;
  }
  async function onPaste(event) {
    if (stale() || !enabledForHost) return;
    if (event.clipboardData && syntheticTransfers.has(event.clipboardData)) return;
    const cat = categorizeFiles(filesFromClipboard(event.clipboardData?.items || null));
    if (!totalSanitizableCount(cat)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { files, failures } = await sanitizeAll(cat);
    await incrementSanitizedCount(files.length);
    reportFailures(failures);
    if (files.length && !deliverFiles(event.target, files, "paste")) {
      showBanner("K00 Sanitizer: paste geblokkeerd (kon schone versie niet plaatsen).", "error");
    }
  }
  async function onDrop(event) {
    if (stale() || !enabledForHost) return;
    if (event.dataTransfer && syntheticTransfers.has(event.dataTransfer)) return;
    const allFiles = Array.from(event.dataTransfer?.files || []);
    const cat = categorizeFiles(allFiles);
    if (!totalSanitizableCount(cat)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { files, failures } = await sanitizeAll(cat);
    await incrementSanitizedCount(files.length);
    reportFailures(failures);
    const combined = [...cat.other, ...files];
    if (combined.length && !deliverFiles(event.target, combined, "drop")) {
      showBanner("K00 Sanitizer: drop geblokkeerd (kon schone versie niet plaatsen).", "error");
    }
  }
  async function onChange(event) {
    if (stale() || !enabledForHost) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "file") return;
    if (processingInputs.has(target)) return;
    const cat = categorizeFiles(Array.from(target.files || []));
    if (!totalSanitizableCount(cat)) return;
    processingInputs.add(target);
    try {
      const { files, failures } = await sanitizeAll(cat);
      await incrementSanitizedCount(files.length);
      reportFailures(failures);
      setInputFiles(target, [...cat.other, ...files]);
    } finally {
      processingInputs.delete(target);
    }
  }
  document.addEventListener("paste", onPaste, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("change", onChange, true);
  runtimeOnMessageAddListener((message) => {
    if (message?.type !== "k00:setEnabled") return;
    if (typeof message.host === "string" && message.host !== currentHost) return;
    enabledForHost = message.enabled !== false;
  });
  storageOnChangedAddListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) updateEnabledState().catch(() => void 0);
  });
  updateEnabledState().catch(() => void 0);
})();
