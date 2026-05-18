# K00 Sanitizer

Browser-extensie die metadata uit bestanden haalt op het moment dat je ze in een website plakt, sleept of upload. Werkt in elke Chromium-browser (Chrome, Brave, Edge, Opera, Arc) en in Firefox.

## Wat het doet

Plak je een foto in Gmail, sleep je een PDF naar Slack, of upload je een filmpje via een formulier. Voordat het bestand de site bereikt vangt de extensie het af, strip de metadata, en geeft de schone versie door. De site merkt het verschil niet.

Geen browser-plaatje als preview. Geen "verzonden via". De site krijgt het bestand zoals het hoort.

## Welke bestanden

- Afbeeldingen: `jpg`, `png`, `webp`, `gif`, `bmp`
- Documenten: `pdf`, `docx`
- Media: `mp4`, `mp3`

## Hoe

### Afbeeldingen

Decoderen naar pixels, opnieuw encoderen. EXIF en GPS gaan eruit omdat ze nooit in de pixels zitten. We gebruiken `createImageBitmap` plus `OffscreenCanvas`.

HEIC (iPhone-foto's) kan de browser zelf niet decoderen. Zo'n bestand wordt niet stiekem doorgelaten met GPS er nog in. Het wordt geblokkeerd en je krijgt een melding. Andere bestanden in dezelfde plak- of sleepactie gaan gewoon door.

### PDF

We laden de PDF met `pdf-lib`, gooien de Info-dictionary weg, halen de document-ID weg, en verwijderen de XMP-metadata uit de catalog.

### DOCX

Een DOCX is een ZIP. We slopen alles onder `docProps/`, leeg de ZIP-comments, en zetten alle timestamps op nul. Met `jszip`.

### MP4

MP4 is een boomstructuur van boxes. We parsen die en verwijderen elke `udta`, `meta`, `ilst` en `uuid`-box. Daarnaast gooien we de hele metadata-track weg (een trak met handler `meta`). Daar bewaart een iPhone de GPS-route van een filmpje, los van de tags.

### MP3

We strippen drie tag-blokken. ID3v2 aan het begin, APEv2 aan het einde, ID3v1 in de laatste 128 bytes.

## Waar het werkt

De extensie luistert op drie events:
- `paste` (ctrl+v of cmd+v)
- `drop` (slepen)
- `change` op een file-input

De schone bestanden worden teruggegeven via een synthetisch event op dezelfde target. Daardoor pakt de site het op alsof je zelf een schoon bestand had geplakt of gesleept. Werkt op Gemini, ChatGPT, Claude.ai, Gmail, Slack en de rest.

Elk bestand wordt los geschoond. Faalt er één, dan wordt alleen die geblokkeerd met een melding. De rest gaat door.

`pdf-lib` en `jszip` zijn samen bijna een megabyte. Die laden niet mee op elke pagina. Ze worden pas opgehaald zodra je echt een PDF of DOCX plakt of sleept. Op alle andere pagina's draait alleen een script van een paar kilobyte.

## Build

```bash
npm install
npm run build
```

Of draai `build.cmd`. Dat bouwt alles en zet een kant-en-klare map plus zip in `build/`. Laad `build/k00-sanitizer` via `chrome://extensions` met "Uitgepakte extensie laden", of deel de zip.

## Beperkingen

- Bestandsnamen blijven zoals ze waren. Wil je die ook verbergen, hernoem dan zelf.
- Timestamps worden op het huidige moment gezet, niet op nul. Sommige sites kijken daar niet naar, andere wel.
- Container-velden zoals codec-parameters of frame-rate blijven staan. Daar zit geen persoonlijke info in.
- We raken de pixels of de inhoud van de pagina niet aan. Alleen metadata.
