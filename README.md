# Data Sanitizer Chrome Extension

Data Sanitizer is a Chrome extension that removes metadata from common file types during paste, drag-and-drop, and file input uploads. It prioritizes privacy by stripping embedded metadata while preserving the original filename.

## Supported Files
- Images: `jpg`, `png`, `webp`, `gif`, `bmp`
- Documents: `pdf`, `docx` (ZIP metadata stripped)
- Media: `mp4`, `mp3`

## How It Works

### Images
Images are decoded into pixels and re-encoded to a new file:
- Decode with `createImageBitmap`
- Draw to `OffscreenCanvas` or `<canvas>`
- Re-encode as a new image blob

This removes EXIF and embedded metadata.

### PDF
PDFs are parsed and re-saved with metadata removed:
- Removes the document Info dictionary
- Removes the document ID
- Removes XMP metadata (`/Metadata` in the catalog)

Implementation uses `pdf-lib`.

### DOCX
DOCX files are ZIP archives. We remove metadata entries:
- Removes everything under `docProps/`
- Clears ZIP comments, timestamps, and permissions

Implementation uses `jszip`.

### MP4
MP4 files are ISO Base Media File Format containers. We remove metadata atoms:
- Removes `udta`, `meta`, and `ilst` boxes anywhere in the box tree

This covers common location tags such as `com.apple.quicktime.location.ISO6709` when stored in metadata atoms.

### MP3
MP3 metadata is stripped by removing standard tag blocks:
- Removes ID3v2 (header at start)
- Removes APEv2 (footer at end)
- Removes ID3v1 (last 128 bytes)

## Where It Runs
The sanitizer runs on:
- Clipboard paste
- Drag-and-drop
- File input change events

If sanitization fails, the original file is blocked from being inserted.

## Build
The project bundles content scripts with `esbuild`.

```bash
npm install
npm run build
```

Output is written to `dist/`.

## Notes
- Filenames are preserved; timestamps are reset to the current time.
- Some container-level fields may still exist (e.g., file system timestamps or codec parameters).
- The extension does not alter visible content; it only removes metadata.
