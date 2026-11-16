// ✒️ 123ECRITURE — lib/files/imageFormats.ts — formats d'image reconnus (source unique)
//////////////////////////////////////////////////////////////////////////////
//
// LA liste des extensions d'image de l'app, avec leur type MIME et leur
// prise en charge par moteur d'affichage. Avant, chaque port tenait sa
// petite liste (png/jpg/gif/webp…) : un `![[photo.jfif]]` restait une
// pastille-lien (signalé 2026-11-16) et sa data URL partait en
// `application/octet-stream`, que le navigateur refuse d'afficher.
// Consommateurs : résolution des embeds (lib/notes/embedResolution.ts),
// widget image de l'aperçu vivant, NoteRenderer, ports de lecture des
// pièces jointes (desktop, web, Android SAF, cloud) et listes de synchro.
// Importé tel quel par apps/desktop (esbuild le bundle).
//
// Moteurs :
//   • 'browser' — Chromium : Electron (desktop), Chrome/Edge (web) et
//     l'Android WebView (mode Intermédiaire mobile) ;
//   • 'native'  — <Image> React Native Android (mode Lecture mobile,
//     décodeur Fresco/Android).
// 'yes' = s'affiche ; 'no' = jamais (message clair + « Ouvrir ») ;
// 'maybe' = dépend de la version (Safari affiche TIFF/HEIC, Android 9+
// décode HEIF…) — l'app ESSAIE toujours, et retombe sur la carte de
// repli si le décodage échoue (onerror / onError).
//
//////////////////////////////////////////////////////////////////////////////

export type ImageSupport = 'yes' | 'maybe' | 'no';
export type ImageEngine = 'browser' | 'native';

export type ImageFormat = {
  label: string;
  mime: string;
  browser: ImageSupport;
  native: ImageSupport;
};

const JPEG: ImageFormat = { label: 'JPEG', mime: 'image/jpeg', browser: 'yes', native: 'yes' };

export const IMAGE_FORMATS: Readonly<Record<string, ImageFormat>> = {
  '.jpg': JPEG,
  '.jpeg': JPEG,
  '.jfif': { ...JPEG, label: 'JFIF (JPEG)' },
  '.pjpeg': { ...JPEG, label: 'JPEG progressif' },
  '.pjp': { ...JPEG, label: 'JPEG progressif' },
  '.png': { label: 'PNG', mime: 'image/png', browser: 'yes', native: 'yes' },
  // APNG : animé dans le navigateur, première image seulement en natif.
  '.apng': { label: 'APNG', mime: 'image/apng', browser: 'yes', native: 'yes' },
  '.gif': { label: 'GIF', mime: 'image/gif', browser: 'yes', native: 'yes' },
  '.webp': { label: 'WebP', mime: 'image/webp', browser: 'yes', native: 'yes' },
  // AVIF : Chromium 85+ ; Android 12+ en natif.
  '.avif': { label: 'AVIF', mime: 'image/avif', browser: 'yes', native: 'maybe' },
  '.bmp': { label: 'BMP', mime: 'image/bmp', browser: 'yes', native: 'yes' },
  '.ico': { label: 'ICO', mime: 'image/x-icon', browser: 'yes', native: 'yes' },
  '.cur': { label: 'CUR', mime: 'image/x-icon', browser: 'yes', native: 'maybe' },
  // SVG : <img> navigateur ; en natif, rendu par react-native-svg (NoteRenderer).
  '.svg': { label: 'SVG', mime: 'image/svg+xml', browser: 'yes', native: 'yes' },
  // TIFF / HEIC : Safari seulement côté navigateur (pas Chromium) ;
  // HEIF décodé par Android 9+ en natif.
  '.tif': { label: 'TIFF', mime: 'image/tiff', browser: 'maybe', native: 'no' },
  '.tiff': { label: 'TIFF', mime: 'image/tiff', browser: 'maybe', native: 'no' },
  '.heic': { label: 'HEIC', mime: 'image/heic', browser: 'maybe', native: 'maybe' },
  '.heif': { label: 'HEIF', mime: 'image/heif', browser: 'maybe', native: 'maybe' },
};

export const IMAGE_EXTENSIONS: readonly string[] = Object.keys(IMAGE_FORMATS);

// Autres pièces jointes affichables (audio de l'aperçu, documents) — MIME
// seulement, pour que toutes les data URL partent avec le bon type.
const OTHER_MIME: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};

// Extension en minuscules, point compris (`photo.JFIF` → `.jfif`) ; '' si
// aucune. Ne regarde que le dernier segment du chemin.
export function fileExtension(pathOrName: string): string {
  const name = pathOrName.slice(Math.max(pathOrName.lastIndexOf('/'), pathOrName.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function imageFormatOf(pathOrName: string): ImageFormat | null {
  return IMAGE_FORMATS[fileExtension(pathOrName)] ?? null;
}

export function isImageFile(pathOrName: string): boolean {
  return imageFormatOf(pathOrName) !== null;
}

// Type MIME d'une pièce jointe (images, audio, vidéo, documents) ;
// inconnu → application/octet-stream.
export function mimeTypeForFile(pathOrName: string): string {
  const ext = fileExtension(pathOrName);
  return IMAGE_FORMATS[ext]?.mime ?? OTHER_MIME[ext] ?? 'application/octet-stream';
}

// Corrige le type d'une data URL dont le MIME est générique (port qui ne
// connaissait pas l'extension) — sans toucher aux données.
export function withImageMime(dataUrl: string, pathOrName: string): string {
  const format = imageFormatOf(pathOrName);
  if (!format || !dataUrl.startsWith('data:')) return dataUrl;
  const comma = dataUrl.indexOf(',');
  const semi = dataUrl.indexOf(';');
  const end = semi !== -1 && semi < comma ? semi : comma;
  if (end === -1) return dataUrl;
  const current = dataUrl.slice(5, end);
  if (current && current !== 'application/octet-stream') return dataUrl;
  return `data:${format.mime}${dataUrl.slice(end)}`;
}

export function imageSupport(pathOrName: string, engine: ImageEngine): ImageSupport {
  const format = imageFormatOf(pathOrName);
  return format ? format[engine] : 'no';
}

// Message de la carte de repli quand une image ne peut pas s'afficher.
export function unsupportedImageMessage(pathOrName: string, engine: ImageEngine): string {
  const format = imageFormatOf(pathOrName);
  const where = engine === 'browser' ? 'dans ce navigateur' : 'sur cet appareil';
  if (!format) return `Aperçu indisponible ${where}.`;
  return `Format ${format.label} non affichable ${where}.`;
}

// Texte d'un SVG livré en data URL base64 (ou en clair) — le <Image> natif
// ne sait pas afficher un SVG : NoteRenderer le confie à react-native-svg.
// Décodage base64 + UTF-8 en JS pur (Hermes n'a pas toujours atob).
export function svgTextFromDataUrl(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma === -1) return null;
  const header = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  try {
    if (!header.endsWith(';base64')) return decodeURIComponent(payload);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = payload.replace(/[^A-Za-z0-9+/]/g, '');
    let encoded = '';
    let buffer = 0;
    let bits = 0;
    for (const char of clean) {
      buffer = (buffer << 6) | alphabet.indexOf(char);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        encoded += '%' + ((buffer >> bits) & 0xff).toString(16).padStart(2, '0');
      }
    }
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}
