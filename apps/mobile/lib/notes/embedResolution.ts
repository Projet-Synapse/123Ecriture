// ✒️ 123ECRITURE — lib/notes/embedResolution.ts — résolution des cibles d'embeds/liens internes
//////////////////////////////////////////////////////////////////////////////
//
// Résolution des cibles d'embeds/liens internes façon Obsidian — fonctions
// PURES partagées par les deux ports de lecture des pièces jointes
// (vault:read-attachment-data-url côté desktop, PropertiesBridge/
// readAttachmentDataUrl web) et par le widget image du Live Preview
// (lib/mdxLivePreview.ts). Même modèle de partage que
// frontmatterMigration.ts/propertyScanMerge.ts : une seule implémentation
// testée, importée telle quelle par apps/desktop (esbuild la bundle).
//
// Invariants du fichier :
//   • `![[image.png]]` s'affiche même quand l'image n'est PAS dans le
//     dossier attachments/ de l'app (coffres importés d'Obsidian : les
//     pièces jointes vivent où elles vivent — « Pièces jointes/ »,
//     sous-dossiers, à côté des notes…). Ordre de résolution, du plus
//     précis au plus permissif : 1) chemin relatif complet tel que
//     référencé ; 2) `attachments/<nom>` (convention de l'app, voir
//     import-attachment) ; 3) recherche par nom/suffixe de chemin dans
//     tout le coffre, casse ignorée — la première trouvée gagne (deux
//     images homonymes dans des dossiers différents : cas marginal,
//     Obsidian fait pareil).
//   • Toute comparaison normalise séparateurs (`\` → `/`) et casse, jamais
//     le contenu des fichiers.
//
// SOMMAIRE :
//   1. Extensions et cibles d'image
//   2. Correspondance cible-fichier — matchesEmbedTarget
//   3. Pièces jointes importées — resolveAttachmentTarget, nom et embed
//
//////////////////////////////////////////////////////////////////////////////

import { IMAGE_EXTENSIONS } from '../files/imageFormats';

//////// 1. Extensions et cibles d'image /////////////////////////////////////

// Source unique : lib/files/imageFormats.ts (jfif, avif, heic, tiff…).
export const IMAGE_EMBED_EXTENSIONS: ReadonlySet<string> = new Set(IMAGE_EXTENSIONS);

export function extensionOf(target: string): string {
  const dot = target.lastIndexOf('.');
  return dot === -1 ? '' : target.slice(dot).toLowerCase();
}

// La cible d'un embed ressemble-t-elle à une image (à l'extension près) ?
// Utilisé pour choisir le widget du Live Preview — un embed non-image garde
// sa pastille (l'aperçu, lui, rend déjà audio/pièce jointe via EmbedNode).
export function isImageEmbedTarget(target: string): boolean {
  return IMAGE_EMBED_EXTENSIONS.has(extensionOf(target));
}

function basename(posixPath: string): string {
  return posixPath.slice(posixPath.lastIndexOf('/') + 1);
}

function normalize(posixPath: string): string {
  return posixPath.replace(/\\/g, '/').toLowerCase().trim();
}

//////// 2. Correspondance cible-fichier — matchesEmbedTarget ////////////////

// Un fichier du coffre répond-il à une cible `[[...]]` ? Trois façons, dans
// l'ordre de précision : chemin exact (casse/séparateurs ignorés), suffixe
// de chemin (`dossier/img.png` référencé → `a/dossier/img.png` trouvé),
// nom de fichier seul (`img.png` référencé → n'importe où). Le suffixe AVANT
// le nom seul : deux images homonymes se départissent par le dossier quand
// la cible en mentionne un.
export function matchesEmbedTarget(candidateRelPath: string, target: string): boolean {
  const candidate = normalize(candidateRelPath);
  const wanted = normalize(target);
  if (!candidate || !wanted) return false;
  if (candidate === wanted) return true;
  if (candidate.endsWith(`/${wanted}`)) return true;
  return basename(candidate) === basename(wanted);
}

//////// 3. Pièces jointes importées — resolveAttachmentTarget, nom et embed //

// Dossier des pièces jointes normalisé (réglage attachmentsFolder) : vide,
// absent ou « / » → 'attachments' ; séparateurs `\` → `/` ; pas de `/`
// en tête/fin.
export function normalizeAttachmentsFolder(folder: string | null | undefined): string {
  const cleaned = (folder ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return cleaned || 'attachments';
}

// Résolution d'une cible d'embed contre la LISTE des fichiers du coffre
// (ports Android : index SAF / vault-fs / coffre cloud, qui n'ont pas de
// disque à interroger comme Electron). Même ordre que le desktop : 1)
// chemin exact ; 2) `<dossier des pièces jointes>/<nom>` ; 3) suffixe de
// chemin ; 4) nom de fichier seul — casse et séparateurs ignorés, `./` et
// `%20` (liens Markdown `![](a%20b.png)`) tolérés. Avant (v0.4.98) : les
// ports Android lisaient la cible TELLE QUELLE — `![[photo.jpg]]` cherchait
// `photo.jpg` à la RACINE alors que l'import l'avait copiée dans
// `attachments/` → « Pièce jointe introuvable » juste après l'insertion.
export function resolveAttachmentTarget(
  target: string,
  relPaths: Iterable<string>,
  attachmentsFolder?: string | null,
): string | null {
  let wanted = (target ?? '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!wanted) return null;
  try {
    if (/%[0-9a-f]{2}/i.test(wanted)) wanted = decodeURI(wanted);
  } catch {
    // Séquence % invalide : la cible brute.
  }
  const all = [...relPaths];
  const lower = wanted.toLowerCase();
  const exact = all.find((p) => p.toLowerCase() === lower);
  if (exact) return exact;
  if (!wanted.includes('/')) {
    const inFolder = `${normalizeAttachmentsFolder(attachmentsFolder)}/${wanted}`.toLowerCase();
    const hit = all.find((p) => p.toLowerCase() === inFolder);
    if (hit) return hit;
  }
  const suffix = all.find((p) => p.toLowerCase().endsWith(`/${lower}`));
  if (suffix) return suffix;
  const base = basename(lower);
  return all.find((p) => basename(p.toLowerCase()) === base) ?? null;
}

// Nom de fichier sûr pour un embed `![[...]]` : `[ ] | # ^` cassent la
// syntaxe Obsidian (alias, ancre, bloc), `/ \ :` un chemin. Un presse-papiers
// sans nom (capture collée) devient `Collé <horodatage>.<ext>`.
export function safeAttachmentName(name: string | null | undefined, mimeType?: string, now: Date = new Date()): string {
  const cleaned = (name ?? '').replace(/[[\]|#^/\\:*?"<>]/g, '-').replace(/\s+/g, ' ').trim();
  if (cleaned && cleaned !== '.' && !/^\.+$/.test(cleaned)) return cleaned;
  const ext = (mimeType ?? '').split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `Collé ${stamp}.${ext}`;
}

// Nom libre dans un dossier : `photo.jpg`, puis `photo 2.jpg`, `photo 3.jpg`…
// (casse ignorée — SAF et les disques Windows/macOS ne distinguent pas).
export function availableAttachmentName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} ${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// Texte inséré dans la note : `![[nom]]` — se résout par l'étape 2 de
// resolveAttachmentTarget (et du desktop) tant que le fichier est dans le
// dossier des pièces jointes.
export function attachmentEmbed(name: string): string {
  return `![[${name}]]`;
}
