// Résolution des cibles d'embeds/liens internes façon Obsidian — fonctions
// PURES partagées par les deux ports de lecture des pièces jointes
// (vault:read-attachment-data-url côté desktop, PropertiesBridge/
// readAttachmentDataUrl web) et par le widget image du Live Preview
// (lib/mdxLivePreview.ts). Même modèle de partage que
// frontmatterMigration.ts/propertyScanMerge.ts : une seule implémentation
// testée, importée telle quelle par apps/desktop (esbuild la bundle).
//
// Comportement Obsidian attendu par l'utilisatrice : `![[image.png]]` doit
// s'afficher même quand l'image n'est PAS dans le dossier attachments/ de
// l'app (coffres importés d'Obsidian : les pièces jointes vivent où elles
// vivent — « Pièces jointes/ », sous-dossiers, à côté des notes…). Ordre de
// résolution, du plus précis au plus permissif :
// 1. chemin relatif complet (tel que référencé) ;
// 2. `attachments/<nom>` (convention de l'app, voir import-attachment) ;
// 3. RECHERCHE PAR NOM dans tout le coffre — un fichier dont le nom (ou le
//    suffixe de chemin) correspond, casse ignorée ; la première trouvée
//    gagne (deux images homonymes dans des dossiers différents : cas
//    marginal, Obsidian fait pareil).

export const IMAGE_EMBED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif',
]);

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
