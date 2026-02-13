import JSZip from "jszip";
import { PDFDocument, PDFName } from "pdf-lib";
import { storageLocalGet, storageLocalSet, storageOnChangedAddListener } from "./extension";

type DisabledHosts = Record<string, true>;

const STORAGE_KEY = "disabledHosts";
const COUNT_KEY = "sanitizedCount";
const SHOW_WATERMARK = true;
const BANNER_ID = "__image_sanitizer_banner__";
const processingInputs = new WeakSet<HTMLInputElement>();
const syntheticTransfers = new WeakSet<DataTransfer>();

let enabledForHost = true;
const currentHost = window.location.hostname;

async function getDisabledHosts(): Promise<DisabledHosts> {
  const result = await storageLocalGet([STORAGE_KEY]);
  return (result[STORAGE_KEY] as DisabledHosts) || {};
}

async function incrementSanitizedCount(by: number): Promise<void> {
  if (by <= 0) return;
  const result = await storageLocalGet([COUNT_KEY]);
  const current = Number(result[COUNT_KEY] || 0);
  await storageLocalSet({ [COUNT_KEY]: current + by });
}

async function updateEnabledState(): Promise<void> {
  const disabledHosts = await getDisabledHosts();
  enabledForHost = !disabledHosts[currentHost];
}

function showBanner(message: string, type: "error" | "info" = "info"): void {
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
    banner.style.borderRadius = "8px";
    banner.style.font = "12px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    banner.style.boxShadow = "0 6px 18px rgba(0,0,0,0.2)";
    banner.style.background = "#111";
    banner.style.color = "#fff";
    document.documentElement.appendChild(banner);
  }
  banner.textContent = message;
  banner.style.background = type === "error" ? "#b00020" : "#111";
  window.setTimeout(() => {
    banner?.remove();
  }, 5000);
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return !!el.closest?.('[contenteditable="true"]');
}

function getImageFilesFromFileList(files: FileList | null): File[] {
  if (!files) return [];
  return Array.from(files).filter((f) => f.type.startsWith("image/"));
}

function getPdfFilesFromFileList(files: FileList | null): File[] {
  if (!files) return [];
  return Array.from(files).filter((f) => isPdfFile(f));
}

function getDocxFilesFromFileList(files: FileList | null): File[] {
  if (!files) return [];
  return Array.from(files).filter((f) => isDocxFile(f));
}

function getMp4FilesFromFileList(files: FileList | null): File[] {
  if (!files) return [];
  return Array.from(files).filter((f) => isMp4File(f));
}

function getMp3FilesFromFileList(files: FileList | null): File[] {
  if (!files) return [];
  return Array.from(files).filter((f) => isMp3File(f));
}

function getImageFilesFromClipboard(items: DataTransferItemList | null): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

function getPdfFilesFromClipboard(items: DataTransferItemList | null): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isPdfFile(file)) files.push(file);
  }
  return files;
}

function getDocxFilesFromClipboard(items: DataTransferItemList | null): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isDocxFile(file)) files.push(file);
  }
  return files;
}

function getMp4FilesFromClipboard(items: DataTransferItemList | null): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isMp4File(file)) files.push(file);
  }
  return files;
}

function getMp3FilesFromClipboard(items: DataTransferItemList | null): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isMp3File(file)) files.push(file);
  }
  return files;
}

function getExtensionForMime(mime: string): string {
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
    case "application/pdf":
      return "pdf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "video/mp4":
      return "mp4";
    case "audio/mpeg":
      return "mp3";
    default:
      return "png";
  }
}

function safeFilename(originalName: string | undefined, mime: string): string {
  if (originalName && originalName.trim()) return originalName;
  const ext = getExtensionForMime(mime);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `sanitized-${stamp}.${ext}`;
}

function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

function isDocxFile(file: File): boolean {
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return true;
  }
  return file.name.toLowerCase().endsWith(".docx");
}

function isMp4File(file: File): boolean {
  if (file.type === "video/mp4") return true;
  return file.name.toLowerCase().endsWith(".mp4");
}

function isMp3File(file: File): boolean {
  if (file.type === "audio/mpeg") return true;
  return file.name.toLowerCase().endsWith(".mp3");
}

async function imageToBlob(
  bitmap: ImageBitmap,
  mime: string
): Promise<Blob> {
  const canvasSupported = "OffscreenCanvas" in window;
  const width = bitmap.width;
  const height = bitmap.height;

  if (canvasSupported) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("No 2d context");
    ctx.drawImage(bitmap, 0, 0);
    if (SHOW_WATERMARK) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.font = "10px Arial, sans-serif";
      ctx.fillStyle = "#000";
      ctx.textBaseline = "top";
      ctx.fillText("sanitized", 6, 4);
      ctx.restore();
    }
    return canvas.convertToBlob({
      type: mime || "image/png",
      quality: mime === "image/jpeg" || mime === "image/webp" ? 0.92 : undefined
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("No 2d context");
  ctx.drawImage(bitmap, 0, 0);
  if (SHOW_WATERMARK) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.font = "10px Arial, sans-serif";
    ctx.fillStyle = "#000";
    ctx.textBaseline = "top";
    ctx.fillText("sanitized", 6, 4);
    ctx.restore();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create blob"));
          return;
        }
        resolve(blob);
      },
      mime || "image/png",
      mime === "image/jpeg" || mime === "image/webp" ? 0.92 : undefined
    );
  });
}

async function sanitizeFile(file: File): Promise<File> {
  const mime = file.type || "image/png";
  const bitmap = await createImageBitmap(file);
  const blob = await imageToBlob(bitmap, mime);
  const name = safeFilename(file.name, mime);
  return new File([blob], name, {
    type: blob.type || mime,
    lastModified: Date.now()
  });
}

function stripPdfMetadata(pdfDoc: PDFDocument): void {
  const anyDoc = pdfDoc as unknown as {
    catalog?: { delete?: (name: PDFName) => void };
    context?: {
      trailerInfo?: { Info?: unknown; ID?: unknown };
      lookup?: (ref: unknown) => unknown;
    };
  };

  try {
    anyDoc.catalog?.delete?.(PDFName.of("Metadata"));
  } catch {
    // Best effort only.
  }

  const trailerInfo = anyDoc.context?.trailerInfo;
  if (trailerInfo) {
    const infoRef = trailerInfo.Info;
    if (infoRef && anyDoc.context?.lookup) {
      const infoDict = anyDoc.context.lookup(infoRef) as {
        keys?: () => PDFName[];
        delete?: (key: PDFName) => void;
      };
      const keys = infoDict?.keys?.() || [];
      for (const key of keys) {
        infoDict?.delete?.(key);
      }
    }
    trailerInfo.Info = undefined;
    trailerInfo.ID = undefined;
  }
}

async function sanitizePdf(file: File): Promise<File> {
  const bytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: true
  });
  stripPdfMetadata(pdfDoc);
  const pdfBytes = await pdfDoc.save();
  const name = safeFilename(file.name, "application/pdf");
  return new File([pdfBytes], name, {
    type: "application/pdf",
    lastModified: Date.now()
  });
}

async function sanitizeDocx(file: File): Promise<File> {
  const bytes = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  for (const path of Object.keys(zip.files)) {
    if (path.startsWith("docProps/")) {
      zip.remove(path);
    }
  }
  const outBytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE"
  });
  const name = safeFilename(
    file.name,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  return new File([outBytes], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    lastModified: Date.now()
  });
}

const MP4_CONTAINER_BOXES = new Set([
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

const MP4_STRIP_BOXES = new Set(["udta", "meta", "ilst"]);

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0);
}

function writeFourCC(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < 4; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i) || 0);
  }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function parseMp4Boxes(
  bytes: Uint8Array,
  start: number,
  end: number
): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
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
        writeUint32(headerView, 8, Number((sizeBig >> 32n) & 0xffffffffn));
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

async function sanitizeMp4(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const cleaned = concatChunks(parseMp4Boxes(bytes, 0, bytes.length));
  const name = safeFilename(file.name, "video/mp4");
  return new File([cleaned], name, {
    type: "video/mp4",
    lastModified: Date.now()
  });
}

function decodeSyncSafe(sizeBytes: Uint8Array): number {
  return (
    ((sizeBytes[0] & 0x7f) << 21) |
    ((sizeBytes[1] & 0x7f) << 14) |
    ((sizeBytes[2] & 0x7f) << 7) |
    (sizeBytes[3] & 0x7f)
  );
}

function stripId3v2(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 10) return bytes;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return bytes;
  const size = decodeSyncSafe(bytes.subarray(6, 10));
  const total = 10 + size;
  if (total > bytes.length) return bytes;
  return bytes.subarray(total);
}

function stripId3v1(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 128) return bytes;
  const start = bytes.length - 128;
  if (
    bytes[start] === 0x54 &&
    bytes[start + 1] === 0x41 &&
    bytes[start + 2] === 0x47
  ) {
    return bytes.subarray(0, start);
  }
  return bytes;
}

function stripApeTag(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 32) return bytes;
  const end = bytes.length;
  const footerStart = end - 32;
  const footer = bytes.subarray(footerStart, end);
  const isFooter =
    footer[0] === 0x41 &&
    footer[1] === 0x50 &&
    footer[2] === 0x45 &&
    footer[3] === 0x54 &&
    footer[4] === 0x41 &&
    footer[5] === 0x47 &&
    footer[6] === 0x45 &&
    footer[7] === 0x58;
  if (!isFooter) return bytes;

  const size =
    footer[12] |
    (footer[13] << 8) |
    (footer[14] << 16) |
    (footer[15] << 24);
  if (size <= 0 || size > bytes.length) return bytes;
  const start = end - size;
  if (start < 0) return bytes;
  return bytes.subarray(0, start);
}

async function sanitizeMp3(file: File): Promise<File> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  bytes = stripId3v2(bytes);
  bytes = stripApeTag(bytes);
  bytes = stripId3v1(bytes);
  const name = safeFilename(file.name, "audio/mpeg");
  return new File([bytes], name, {
    type: "audio/mpeg",
    lastModified: Date.now()
  });
}

function insertImagesAtCursor(dataUrls: string[]): void {
  for (const url of dataUrls) {
    document.execCommand("insertImage", false, url);
  }
}

function tryDispatchPaste(target: EventTarget | null, files: File[]): boolean {
  try {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    syntheticTransfers.add(dt);
    const evt = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    });
    (target as HTMLElement | null)?.dispatchEvent(evt);
    return true;
  } catch {
    return false;
  }
}

function tryDispatchDrop(target: EventTarget | null, files: File[]): boolean {
  try {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    syntheticTransfers.add(dt);
    const evt = new DragEvent("drop", {
      dataTransfer: dt,
      bubbles: true,
      cancelable: true
    });
    (target as HTMLElement | null)?.dispatchEvent(evt);
    return true;
  } catch {
    return false;
  }
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

document.addEventListener(
  "paste",
  async (event) => {
    if (!enabledForHost) return;
    if (event.clipboardData && syntheticTransfers.has(event.clipboardData)) return;
    const imageFiles = getImageFilesFromClipboard(event.clipboardData?.items || null);
    const pdfFiles = getPdfFilesFromClipboard(event.clipboardData?.items || null);
    const docxFiles = getDocxFilesFromClipboard(event.clipboardData?.items || null);
    const mp4Files = getMp4FilesFromClipboard(event.clipboardData?.items || null);
    const mp3Files = getMp3FilesFromClipboard(event.clipboardData?.items || null);
    if (
      !imageFiles.length &&
      !pdfFiles.length &&
      !docxFiles.length &&
      !mp4Files.length &&
      !mp3Files.length
    )
      return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const sanitizedImages = await Promise.all(imageFiles.map(sanitizeFile));
      const sanitizedPdfs = await Promise.all(pdfFiles.map(sanitizePdf));
      const sanitizedDocx = await Promise.all(docxFiles.map(sanitizeDocx));
      const sanitizedMp4 = await Promise.all(mp4Files.map(sanitizeMp4));
      const sanitizedMp3 = await Promise.all(mp3Files.map(sanitizeMp3));
      await incrementSanitizedCount(
        sanitizedImages.length +
          sanitizedPdfs.length +
          sanitizedDocx.length +
          sanitizedMp4.length +
          sanitizedMp3.length
      );

      if (
        isEditableTarget(event.target) &&
        !sanitizedPdfs.length &&
        !sanitizedDocx.length &&
        !sanitizedMp4.length &&
        !sanitizedMp3.length
      ) {
        const dataUrls: string[] = [];
        for (const file of sanitizedImages) {
          const reader = new FileReader();
          const url = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Failed to read sanitized image"));
            reader.readAsDataURL(file);
          });
          dataUrls.push(url);
        }
        insertImagesAtCursor(dataUrls);
        return;
      }

      const dispatched = tryDispatchPaste(event.target, [
        ...sanitizedImages,
        ...sanitizedPdfs,
        ...sanitizedDocx,
        ...sanitizedMp4,
        ...sanitizedMp3
      ]);
      if (!dispatched) {
        showBanner("Image sanitizer: paste blocked (could not inject sanitized image).", "error");
      }
    } catch {
      showBanner("Image sanitizer: paste blocked (failed to sanitize image).", "error");
    }
  },
  true
);

document.addEventListener(
  "drop",
  async (event) => {
    if (!enabledForHost) return;
    if (event.dataTransfer && syntheticTransfers.has(event.dataTransfer)) return;
    const allFiles = Array.from(event.dataTransfer?.files || []);
    const imageFiles = allFiles.filter((f) => f.type.startsWith("image/"));
    const pdfFiles = allFiles.filter((f) => isPdfFile(f));
    const docxFiles = allFiles.filter((f) => isDocxFile(f));
    const mp4Files = allFiles.filter((f) => isMp4File(f));
    const mp3Files = allFiles.filter((f) => isMp3File(f));
    if (
      !imageFiles.length &&
      !pdfFiles.length &&
      !docxFiles.length &&
      !mp4Files.length &&
      !mp3Files.length
    )
      return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const sanitizedImages = await Promise.all(imageFiles.map(sanitizeFile));
      const sanitizedPdfs = await Promise.all(pdfFiles.map(sanitizePdf));
      const sanitizedDocx = await Promise.all(docxFiles.map(sanitizeDocx));
      const sanitizedMp4 = await Promise.all(mp4Files.map(sanitizeMp4));
      const sanitizedMp3 = await Promise.all(mp3Files.map(sanitizeMp3));
      await incrementSanitizedCount(
        sanitizedImages.length +
          sanitizedPdfs.length +
          sanitizedDocx.length +
          sanitizedMp4.length +
          sanitizedMp3.length
      );
      const nonImages = allFiles.filter(
        (f) =>
          !f.type.startsWith("image/") &&
          !isPdfFile(f) &&
          !isDocxFile(f) &&
          !isMp4File(f) &&
          !isMp3File(f)
      );
      const combined = [
        ...nonImages,
        ...sanitizedImages,
        ...sanitizedPdfs,
        ...sanitizedDocx,
        ...sanitizedMp4,
        ...sanitizedMp3
      ];
      const target = event.target as HTMLElement | null;

      if (target && target instanceof HTMLInputElement && target.type === "file") {
        setInputFiles(target, combined);
        return;
      }

      const dispatched = tryDispatchDrop(event.target, combined);
      if (!dispatched) {
        showBanner("Image sanitizer: drop blocked (could not inject sanitized image).", "error");
      }
    } catch {
      showBanner("Image sanitizer: drop blocked (failed to sanitize image).", "error");
    }
  },
  true
);

document.addEventListener(
  "change",
  async (event) => {
    if (!enabledForHost) return;
    const target = event.target as HTMLElement | null;
    if (!target || !(target instanceof HTMLInputElement)) return;
    if (target.type !== "file") return;
    if (processingInputs.has(target)) return;

    const files = Array.from(target.files || []);
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const pdfFiles = files.filter((f) => isPdfFile(f));
    const docxFiles = files.filter((f) => isDocxFile(f));
    const mp4Files = files.filter((f) => isMp4File(f));
    const mp3Files = files.filter((f) => isMp3File(f));
    if (!imageFiles.length && !pdfFiles.length && !docxFiles.length && !mp4Files.length && !mp3Files.length)
      return;

    processingInputs.add(target);
    try {
      const sanitizedImages = await Promise.all(imageFiles.map(sanitizeFile));
      const sanitizedPdfs = await Promise.all(pdfFiles.map(sanitizePdf));
      const sanitizedDocx = await Promise.all(docxFiles.map(sanitizeDocx));
      const sanitizedMp4 = await Promise.all(mp4Files.map(sanitizeMp4));
      const sanitizedMp3 = await Promise.all(mp3Files.map(sanitizeMp3));
      await incrementSanitizedCount(
        sanitizedImages.length +
          sanitizedPdfs.length +
          sanitizedDocx.length +
          sanitizedMp4.length +
          sanitizedMp3.length
      );
      const nonImages = files.filter(
        (f) =>
          !f.type.startsWith("image/") &&
          !isPdfFile(f) &&
          !isDocxFile(f) &&
          !isMp4File(f) &&
          !isMp3File(f)
      );
      setInputFiles(target, [
        ...nonImages,
        ...sanitizedImages,
        ...sanitizedPdfs,
        ...sanitizedDocx,
        ...sanitizedMp4,
        ...sanitizedMp3
      ]);
    } catch {
      target.value = "";
      showBanner("Image sanitizer: upload blocked (failed to sanitize selected image).", "error");
    } finally {
      processingInputs.delete(target);
    }
  },
  true
);

storageOnChangedAddListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEY]) {
    updateEnabledState().catch(() => undefined);
  }
});

updateEnabledState().catch(() => undefined);
