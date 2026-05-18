import {
  isExtensionContextValid,
  runtimeGetURL,
  runtimeOnMessageAddListener,
  storageLocalGet,
  storageLocalSet,
  storageOnChangedAddListener
} from "./extension";

type DisabledHosts = Record<string, true>;

interface HeavyModule {
  sanitizePdf(file: File): Promise<File>;
  sanitizeDocx(file: File): Promise<File>;
}

const STORAGE_KEY = "disabledHosts";
const COUNT_KEY = "sanitizedCount";
const BANNER_ID = "__k00_sanitizer_banner__";

const processingInputs = new WeakSet<HTMLInputElement>();
const syntheticTransfers = new WeakSet<DataTransfer>();

let enabledForHost = true;
const currentHost = window.location.hostname;

let heavyPromise: Promise<HeavyModule> | null = null;

// pdf-lib en jszip zitten in een losse bundle die we pas ophalen wanneer er
// echt een PDF of DOCX langskomt. Daardoor blijft content.js klein op pagina's
// waar je nooit een bestand plakt.
function loadHeavy(): Promise<HeavyModule> {
  if (!heavyPromise) {
    const url = runtimeGetURL("dist/heavy.js");
    heavyPromise = import(url) as Promise<HeavyModule>;
  }
  return heavyPromise;
}

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
    banner.style.font = "12px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    banner.style.boxShadow = "0 6px 18px rgba(0,0,0,0.2)";
    banner.style.color = "#fff";
    document.documentElement.appendChild(banner);
  }
  banner.textContent = message;
  banner.style.background = type === "error" ? "#b00020" : "#111";
  window.setTimeout(() => banner?.remove(), 5000);
}

function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

function isDocxFile(file: File): boolean {
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
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

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function isHeicFile(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name);
}

interface CategorizedFiles {
  images: File[];
  pdfs: File[];
  docx: File[];
  mp4: File[];
  mp3: File[];
  other: File[];
}

function categorizeFiles(files: File[]): CategorizedFiles {
  const result: CategorizedFiles = { images: [], pdfs: [], docx: [], mp4: [], mp3: [], other: [] };
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

function totalSanitizableCount(c: CategorizedFiles): number {
  return c.images.length + c.pdfs.length + c.docx.length + c.mp4.length + c.mp3.length;
}

function filesFromClipboard(items: DataTransferItemList | null): File[] {
  if (!items) return [];
  const out: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

function getExtensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/bmp": return "bmp";
    case "video/mp4": return "mp4";
    case "audio/mpeg": return "mp3";
    default: return "png";
  }
}

function safeFilename(originalName: string | undefined, mime: string): string {
  if (originalName && originalName.trim()) return originalName;
  const ext = getExtensionForMime(mime);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `sanitized-${stamp}.${ext}`;
}

async function imageToBlob(bitmap: ImageBitmap, mime: string): Promise<Blob> {
  const width = bitmap.width;
  const height = bitmap.height;
  const quality = mime === "image/jpeg" || mime === "image/webp" ? 0.92 : undefined;

  if ("OffscreenCanvas" in window) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("No 2d context");
    ctx.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: mime || "image/png", quality });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("No 2d context");
  ctx.drawImage(bitmap, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create blob"))),
      mime || "image/png",
      quality
    );
  });
}

async function sanitizeImage(file: File): Promise<File> {
  const mime = file.type || "image/png";
  const bitmap = await createImageBitmap(file);
  const blob = await imageToBlob(bitmap, mime);
  return new File([blob], safeFilename(file.name, mime), {
    type: blob.type || mime,
    lastModified: Date.now()
  });
}

const MP4_CONTAINER_BOXES = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf", "mfra"
]);

// udta/meta/ilst dragen tags. uuid is vendor-metadata (GoPro, Garmin, iPhone)
// en daar zit vaak locatie in.
const MP4_STRIP_BOXES = new Set(["udta", "meta", "ilst", "uuid"]);

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

interface BoxSpan {
  type: string;
  contentStart: number;
  boxEnd: number;
}

// Loopt één niveau diep door de boxes tussen start en end.
function* iterBoxes(view: DataView, start: number, end: number): Generator<BoxSpan> {
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

// Leest het handler-type van een trak via trak > mdia > hdlr. Een trak met
// handler "meta" is een timed-metadata-track (iPhone bewaart daar GPS in).
function trakHandlerType(view: DataView, contentStart: number, contentEnd: number): string | null {
  for (const mdia of iterBoxes(view, contentStart, contentEnd)) {
    if (mdia.type !== "mdia") continue;
    for (const hdlr of iterBoxes(view, mdia.contentStart, mdia.boxEnd)) {
      if (hdlr.type !== "hdlr") continue;
      // hdlr: version+flags (4) + pre_defined (4) + handler_type (4)
      return readFourCC(view, hdlr.contentStart + 8);
    }
  }
  return null;
}

function parseMp4Boxes(bytes: Uint8Array, start: number, end: number): Uint8Array[] {
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

    // Hele metadata-track droppen (daar zit de GPS-track van telefoons in).
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
  return new File([cleaned], safeFilename(file.name, "video/mp4"), {
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
  if (bytes[start] === 0x54 && bytes[start + 1] === 0x41 && bytes[start + 2] === 0x47) {
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
    footer[0] === 0x41 && footer[1] === 0x50 && footer[2] === 0x45 && footer[3] === 0x54 &&
    footer[4] === 0x41 && footer[5] === 0x47 && footer[6] === 0x45 && footer[7] === 0x58;
  if (!isFooter) return bytes;

  const size = footer[12] | (footer[13] << 8) | (footer[14] << 16) | (footer[15] << 24);
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
  return new File([bytes], safeFilename(file.name, "audio/mpeg"), {
    type: "audio/mpeg",
    lastModified: Date.now()
  });
}

interface SanitizeOutcome {
  files: File[];
  failures: string[];
}

// Schoont elk bestand los van de rest. Eén bestand dat faalt (bv. een HEIC die
// de browser niet kan decoderen) blokkeert de andere niet.
async function sanitizeAll(c: CategorizedFiles): Promise<SanitizeOutcome> {
  const jobs: Promise<{ file: File } | { error: string }>[] = [];

  const run = (file: File, work: () => Promise<File>) =>
    jobs.push(
      work().then(
        (f) => ({ file: f }),
        () => ({
          error: isHeicFile(file)
            ? `${file.name || "HEIC"}: HEIC kan de browser niet schonen, geblokkeerd`
            : `${file.name || "bestand"}: schonen mislukt, geblokkeerd`
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
  const files: File[] = [];
  const failures: string[] = [];
  for (const r of results) {
    if ("file" in r) files.push(r.file);
    else failures.push(r.error);
  }
  return { files, failures };
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
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

// Levert de schone bestanden terug aan de pagina door het originele paste- of
// drop-event opnieuw te dispatchen. Zo doorloopt de site z'n eigen flow alsof
// er niks gebeurd is, alleen met een gestripte versie van het bestand.
function deliverFiles(
  target: EventTarget | null,
  files: File[],
  mode: "paste" | "drop"
): boolean {
  if (!files.length) return true;

  // Drop direct op een <input type="file">: synthetische events triggeren
  // geen default browser-gedrag, dus die input vullen we direct.
  if (mode === "drop" && target instanceof HTMLInputElement && target.type === "file") {
    setInputFiles(target, files);
    return true;
  }

  return mode === "paste"
    ? tryDispatchPaste(target, files)
    : tryDispatchDrop(target, files);
}

function reportFailures(failures: string[]): void {
  if (!failures.length) return;
  const head = failures.slice(0, 3).join(" | ");
  const extra = failures.length > 3 ? ` (+${failures.length - 3})` : "";
  showBanner(`K00 Sanitizer: ${head}${extra}`, "error");
}

// Een verouderd content-script (na een extensie-update of -herlaad) heeft een
// ongeldige context. Dan halen we onze listeners weg zodat de pagina gewoon
// z'n eigen paste/drop doet tot de tab ververst wordt.
function teardown(): void {
  document.removeEventListener("paste", onPaste, true);
  document.removeEventListener("drop", onDrop, true);
  document.removeEventListener("change", onChange, true);
}

function stale(): boolean {
  if (isExtensionContextValid()) return false;
  teardown();
  return true;
}

async function onPaste(event: ClipboardEvent): Promise<void> {
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

async function onDrop(event: DragEvent): Promise<void> {
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

  // Niet-herkende bestanden gaan ongewijzigd mee.
  const combined = [...cat.other, ...files];
  if (combined.length && !deliverFiles(event.target, combined, "drop")) {
    showBanner("K00 Sanitizer: drop geblokkeerd (kon schone versie niet plaatsen).", "error");
  }
}

async function onChange(event: Event): Promise<void> {
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

// De popup stuurt dit bij het togglen zodat het meteen werkt, zonder refresh.
runtimeOnMessageAddListener((message) => {
  if (message?.type !== "k00:setEnabled") return;
  if (typeof message.host === "string" && message.host !== currentHost) return;
  enabledForHost = message.enabled !== false;
});

// Fallback: andere open tabs van dezelfde host pikken het via storage op.
storageOnChangedAddListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEY]) updateEnabledState().catch(() => undefined);
});

updateEnabledState().catch(() => undefined);
