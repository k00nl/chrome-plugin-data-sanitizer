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

### PDF

We laden de PDF met `pdf-lib`, gooien de Info-dictionary weg, halen de document-ID weg, en verwijderen de XMP-metadata uit de catalog.

### DOCX

Een DOCX is een ZIP. We slopen alles onder `docProps/`, leeg de ZIP-comments, en zetten alle timestamps op nul. Met `jszip`.

### MP4

MP4 is een boomstructuur van boxes. We parsen de boomstructuur en verwijderen elke `udta`, `meta` en `ilst`-box. Daar zitten dingen in als locatiegegevens van je telefoon.

### MP3

We strippen drie tag-blokken. ID3v2 aan het begin, APEv2 aan het einde, ID3v1 in de laatste 128 bytes.

## Waar het werkt

De extensie luistert op drie events:
- `paste` (ctrl+v of cmd+v)
- `drop` (slepen)
- `change` op een file-input

De schone bestanden worden teruggegeven via een synthetisch event op dezelfde target. Daardoor pakt de site het op alsof je zelf een schoon bestand had geplakt of gesleept. Werkt op Gemini, ChatGPT, Claude.ai, Gmail, Slack en de rest.

Lukt sanitizen niet, dan wordt het bestand niet geplaatst en zie je een banner.

## Build

```bash
npm install
npm run build
```

De gebundelde scripts staan in `dist/`. Laad de map als unpacked extensie via `chrome://extensions`.

## Beperkingen

- Bestandsnamen blijven zoals ze waren. Wil je die ook verbergen, hernoem dan zelf.
- Timestamps worden op het huidige moment gezet, niet op nul. Sommige sites kijken daar niet naar, andere wel.
- Container-velden zoals codec-parameters of frame-rate blijven staan. Daar zit geen persoonlijke info in.
- We raken de pixels of de inhoud van de pagina niet aan. Alleen metadata.
