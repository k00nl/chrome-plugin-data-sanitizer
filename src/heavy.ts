// Zware afhankelijkheden (pdf-lib, jszip) staan los van content.js zodat ze
// niet op elke pagina meeladen. content.ts importeert deze module pas wanneer
// er echt een PDF of DOCX langskomt.
import JSZip from "jszip";
import { PDFDocument, PDFName } from "pdf-lib";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function safeFilename(originalName: string | undefined, ext: string): string {
  if (originalName && originalName.trim()) return originalName;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `sanitized-${stamp}.${ext}`;
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
    // niet kritisch, ga door
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
      for (const key of keys) infoDict?.delete?.(key);
    }
    trailerInfo.Info = undefined;
    trailerInfo.ID = undefined;
  }
}

export async function sanitizePdf(file: File): Promise<File> {
  const bytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: true
  });
  stripPdfMetadata(pdfDoc);
  const pdfBytes = await pdfDoc.save();
  return new File([pdfBytes], safeFilename(file.name, "pdf"), {
    type: "application/pdf",
    lastModified: Date.now()
  });
}

export async function sanitizeDocx(file: File): Promise<File> {
  const bytes = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  zip.comment = "";
  for (const path of Object.keys(zip.files)) {
    if (path.startsWith("docProps/")) {
      zip.remove(path);
      continue;
    }
    const entry = zip.files[path];
    entry.date = new Date(0);
    entry.comment = "";
    entry.unixPermissions = null;
    entry.dosPermissions = null;
  }
  const outBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new File([outBytes], safeFilename(file.name, "docx"), {
    type: DOCX_MIME,
    lastModified: Date.now()
  });
}
