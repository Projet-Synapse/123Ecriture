import { dump, load } from 'js-yaml';

// ✒️ 123ECRITURE — lib/properties/frontmatter.ts — découpe/recomposition du frontmatter YAML
//////////////////////////////////////////////////////////////////////////////
//
// Découpe et recompose le frontmatter YAML d'une note
// (`---\n...\n---\n\n`, gabarit écrit à la création de la note — voir
// defaultContentForKind) : ce fichier est le SEUL à parser ce bloc. Sert de
// base au panneau Propriétés (PropertiesPanel.tsx, PropertiesBlock.tsx via
// usePropertyValues) : lit/écrit les valeurs typées dans ce même bloc, à
// côté de `title`/`created` déjà présents. `js-yaml` plutôt qu'un parseur
// maison : le YAML admet assez de subtilités (guillemets, indentation de
// listes, échappement) pour qu'une regex ligne-à-ligne se fasse vite
// piéger — même raisonnement que markdown-it côté rendu des notes.
//
// Invariants du fichier :
//   • parseFrontmatter est TOLÉRANT AUX ERREURS : un bloc présent mais non
//     parsable comme objet YAML renvoie un objet vide et le corps tel quel
//     — le texte reste visible en mode Source, l'éditeur ne plante jamais.
//   • serializeFrontmatter n'écrit AUCUN bloc si `data` est vide (une note
//     sans propriété n'a pas de `---\n---\n\n` vide) et normalise un
//     séparateur `\n\n` entre bloc et corps : un aller-retour
//     parse→édition→sérialisation répété reste stable.
//   • reorderFrontmatterData conserve à la fin, dans leur ordre d'origine,
//     les clés absentes de la liste demandée : jamais de perte de donnée
//     sur un réordonnancement.
//   • ensureTimestamps n'écrit `created` QUE s'il manque (jamais
//     d'écrasement d'une date de création déjà là, quelle que soit sa
//     valeur) ; `modified` est actualisé à chaque sauvegarde ; rien à
//     changer → le même objet est rendu (idempotence : un double appel ne
//     réécrit pas le fichier).
//
// SOMMAIRE :
//   1. parseFrontmatter — lecture (tolérante) du bloc + corps
//   2. serializeFrontmatter — recomposition du contenu complet
//   3. reorderFrontmatterData — réordonnancement sans perte
//   4. ensureTimestamps — dates système created/modified
//
//////////////////////////////////////////////////////////////////////////////

export type FrontmatterData = Record<string, unknown>;

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

//////// 1. parseFrontmatter — lecture (tolérante) du bloc + corps ///////////

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

//////// 2. serializeFrontmatter — recomposition du contenu complet //////////

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

//////// 3. reorderFrontmatterData — réordonnancement sans perte /////////////

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

//////// 4. ensureTimestamps — dates système created/modified ////////////////

// Matérialise les dates système `created`/`modified` DANS le frontmatter
// (les lignes « Créé/Modifié » des vues sont de vraies clés, partagées par
// les trois modes). `created` n'est écrit QUE s'il manque (jamais
// d'écrasement d'une date de création déjà là, quelle que soit sa valeur) ;
// `modified` est actualisé à chaque sauvegarde. Retourne le même objet si
// rien à changer (idempotence : un double appel ne réécrit pas le fichier).
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
