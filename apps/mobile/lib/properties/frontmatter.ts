import { dump, load } from 'js-yaml';

// Découpe/recompose le frontmatter YAML d'une note (`---\n...\n---\n\n`,
// gabarit déjà écrit par vault.js à la création — voir
// defaultContentForKind) — jamais parsé nulle part avant ce fichier
// (confirmé en explorant le repo avant d'écrire ceci). Sert de base au
// panneau Propriétés (PropertiesPanel.tsx) : lit/écrit les valeurs typées
// dans ce même bloc, à côté de `title`/`created` déjà présents.
//
// `js-yaml` choisi plutôt qu'un parseur maison : le YAML admet assez de
// subtilités (guillemets, indentation de listes, échappement) pour qu'une
// regex ligne-à-ligne se fasse vite piéger — même raisonnement que pour
// markdown-it côté rendu des notes.

export type FrontmatterData = Record<string, unknown>;

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Renvoie les propriétés du frontmatter (objet vide si absent OU si le bloc
// existe mais ne parse pas comme un objet YAML valide — ex. l'utilisatrice
// tape du YAML invalide à la main en mode Source) et le corps de la note
// SANS ce bloc. Volontairement tolérant aux erreurs de parsing plutôt que
// de faire planter tout l'éditeur : le texte reste visible tel quel en mode
// Source, à corriger à la main si besoin.
export function parseFrontmatter(content: string): { data: FrontmatterData; body: string } {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) return { data: {}, body: content };

  try {
    const parsed: unknown = load(match[1]);
    const data =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as FrontmatterData) : {};
    // Le gabarit de création (vault.js) laisse une ligne vide après le bloc
    // fermant (`---\n\n`) — normalisée ici plutôt que conservée telle
    // quelle, pour que `body` soit toujours le contenu "réel" sans jamais
    // de saut de ligne résiduel en tête (même normalisation que
    // serializeFrontmatter, pour un aller-retour stable).
    return { data, body: content.slice(match[0].length).replace(/^\n+/, '') };
  } catch {
    return { data: {}, body: content };
  }
}

// Recompose le contenu complet à partir des propriétés + du corps. Pas de
// bloc frontmatter du tout si `data` est vide (une note sans propriété n'a
// pas besoin d'un `---\n---\n\n` vide). Normalise toujours un séparateur
// `\n\n` entre le bloc et le corps (au lieu de préserver le nombre exact de
// sauts de ligne d'origine) : simple et stable pour un aller-retour
// parse→édition→sérialisation répété, même si ça peut légèrement changer le
// nombre de lignes vides existantes.
export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const keys = Object.keys(data);
  const trimmedBody = body.replace(/^\n+/, '');
  if (keys.length === 0) return trimmedBody;

  const yamlBlock = dump(data).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${trimmedBody}`;
}

// Réordonne les clés du frontmatter selon `orderedNames` (glisser-déposer du
// bloc Propriétés en mode Intermédiaire — l'ordre écrit dans le fichier est
// ensuite celui du mode Source). Les clés absentes de `orderedNames`
// (liste périmée face au fichier) sont conservées à la fin dans leur ordre
// d'origine plutôt que perdues : jamais de perte de donnée sur un reorder.
export function reorderFrontmatterData(data: FrontmatterData, orderedNames: string[]): FrontmatterData {
  const next: FrontmatterData = {};
  for (const name of orderedNames) {
    if (name in data) next[name] = data[name];
  }
  for (const key of Object.keys(data)) {
    if (!(key in next)) next[key] = data[key];
  }
  return next;
}

// Matérialise les dates système `created`/`modified` DANS le frontmatter
// (choix utilisateur : les lignes « Créé/Modifié » des vues deviennent de
// vraies clés, cf. la demande de cohérence entre les modes). `created` n'est
// écrit QUE s'il manque (jamais d'écrasement d'une date de création déjà
// là, quelle que soit sa valeur) ; `modified` est actualisé à chaque
// sauvegarde. Retourne le même objet si rien à changer (idempotence : un
// double appel ne réécrit pas le fichier).
export function ensureTimestamps(
  data: FrontmatterData,
  fallbackCreatedAtMs: number,
  nowMs: number,
): FrontmatterData {
  const next = { ...data };
  if (next.created === undefined) next.created = new Date(fallbackCreatedAtMs).toISOString();
  next.modified = new Date(nowMs).toISOString();
  return next;
}
