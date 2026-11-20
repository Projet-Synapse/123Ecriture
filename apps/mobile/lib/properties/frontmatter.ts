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
//   • splitFrontmatter est la SEULE découpe du bloc : elle rend le bloc
//     BRUT (BOM, délimiteurs, fins de ligne CRLF, lignes vides de
//     séparation compris) et le corps qui suit, de sorte que
//     `block + body === content` octet pour octet. Tolérée : BOM UTF-8 en
//     tête, CRLF, espaces/tabulations après `---`, bloc vide `---\n---`,
//     fichier qui s'arrête juste après le `---` fermant.
//   • Un bloc dont le YAML ne parse pas comme un OBJET (YAML invalide,
//     scalaire, liste) n'est PAS un frontmatter : il reste dans le corps,
//     visible tel quel (le mode Intermédiaire ne cache jamais du texte
//     que la carte Propriétés ne sait pas montrer).
//   • parseFrontmatter est TOLÉRANT AUX ERREURS : un bloc présent mais non
//     parsable comme objet YAML renvoie un objet vide et le corps tel quel
//     — le texte reste visible en mode Source, l'éditeur ne plante jamais.
//   • joinFrontmatter(block, body) recompose le contenu SANS retoucher le
//     bloc (aucun re-dump YAML) : c'est la voie d'écriture du corps en
//     mode Intermédiaire — le frontmatter du fichier reste identique.
//   • serializeFrontmatter / replaceFrontmatterData n'écrivent AUCUN bloc
//     si `data` est vide (une note sans propriété n'a pas de `---\n---\n\n`
//     vide). replaceFrontmatterData garde le BOM, le style de fin de ligne
//     et le corps exact du contenu d'origine.
//   • reorderFrontmatterData conserve à la fin, dans leur ordre d'origine,
//     les clés absentes de la liste demandée : jamais de perte de donnée
//     sur un réordonnancement.
//   • ensureTimestamps n'écrit `created` QUE s'il manque (jamais
//     d'écrasement d'une date de création déjà là, quelle que soit sa
//     valeur) ; `modified` est actualisé à chaque sauvegarde ; rien à
//     changer → le même objet est rendu (idempotence : un double appel ne
//     réécrit pas le fichier).
//   • newNoteFrontmatter est le gabarit UNIQUE des nouvelles notes
//     (desktop, web, Android) : `created` seulement, plus de `title`
//     (demande 2026-11-14 — le nom affiché est celui du fichier).
//
// SOMMAIRE :
//   1. splitFrontmatter / parseFrontmatter — lecture (tolérante) du bloc + corps
//   2. joinFrontmatter / serializeFrontmatter / replaceFrontmatterData — recomposition
//   3. reorderFrontmatterData — réordonnancement sans perte
//   4. ensureTimestamps — dates système created/modified
//   5. newNoteFrontmatter — gabarit des nouvelles notes
//
//////////////////////////////////////////////////////////////////////////////

export type FrontmatterData = Record<string, unknown>;

// BOM UTF-8 optionnel (fichiers venus de Windows/Notepad), `---` ouvrant
// suivi d'espaces éventuels, YAML (absent pour un bloc vide `---\n---`),
// `---` fermant suivi d'espaces éventuels puis fin de ligne OU fin de
// fichier, puis les lignes vides de séparation (rangées dans le bloc pour
// que le corps commence au vrai texte). Le groupe YAML est optionnel ET
// paresseux (`??`) : `---\n---\n...` est un bloc vide, pas un bloc qui
// s'étendrait jusqu'au `---` suivant.
// ⚠️ Avant 2026-11-14, le motif exigeait `---` collé en tout début de
// fichier sans espace ni BOM : ces fichiers-là affichaient leur YAML brut
// dans le corps en mode Intermédiaire.
const FRONTMATTER_PATTERN =
  /^(\uFEFF?)---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)??---[ \t]*(?:\r?\n|$)((?:[ \t]*\r?\n)*)/;

export type FrontmatterSplit = {
  // Bloc BRUT tel qu'il est dans le fichier ('' si pas de frontmatter
  // valide) — `block + body === content`.
  block: string;
  body: string;
  data: FrontmatterData;
  // BOM UTF-8 en tête du fichier (à conserver lors d'une réécriture).
  bom: string;
  // Style de fin de ligne du bloc (ou du fichier si pas de bloc).
  eol: '\n' | '\r\n';
};

function detectEol(text: string): '\n' | '\r\n' {
  const index = text.indexOf('\n');
  return index > 0 && text[index - 1] === '\r' ? '\r\n' : '\n';
}

//////// 1. splitFrontmatter / parseFrontmatter — lecture (tolérante) ////////

// Bloc frontmatter BRUT (sans parser le YAML) — clé de mémo bon marché
// pour ne reparser les propriétés que quand le bloc change.
export function frontmatterBlockOf(content: string): string {
  return FRONTMATTER_PATTERN.exec(content)?.[0] ?? '';
}

// Dernier YAML parsé (perf desktop, v0.4.100) : pendant la frappe, le bloc
// ne change pas mais splitFrontmatter est appelé plusieurs fois par lettre
// (corps affiché, recomposition) — le YAML n'est reparsé que s'il change.
// Une COPIE est rendue à chaque appel : aucun appelant ne partage l'objet.
let lastYaml: string | null = null;
let lastParsed: unknown = null;
function cloneParsed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneParsed);
  if (value instanceof Date) return new Date(value.getTime());
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneParsed(v);
    return out;
  }
  return value;
}
function loadYamlCached(yaml: string): unknown {
  if (yaml !== lastYaml) {
    lastParsed = load(yaml);
    lastYaml = yaml;
  }
  return cloneParsed(lastParsed);
}

// Découpe brute : voir les invariants en tête de fichier.
export function splitFrontmatter(content: string): FrontmatterSplit {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const eol = detectEol(content);
  const none: FrontmatterSplit = { block: '', body: content, data: {}, bom, eol };
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) return none;

  let data: FrontmatterData;
  try {
    const yaml = match[2] ?? '';
    const parsed: unknown = yaml.trim() === '' ? {} : loadYamlCached(yaml);
    if (parsed === null || parsed === undefined) data = {};
    else if (typeof parsed === 'object' && !Array.isArray(parsed) && !(parsed instanceof Date)) {
      data = parsed as FrontmatterData;
    } else return none;
  } catch {
    return none;
  }
  return { block: match[0], body: content.slice(match[0].length), data, bom, eol };
}

// Renvoie les propriétés du frontmatter (objet vide si absent OU si le bloc
// existe mais ne parse pas comme un objet YAML valide — ex. l'utilisatrice
// tape du YAML invalide à la main en mode Source) et le corps de la note
// SANS ce bloc. Volontairement tolérant aux erreurs de parsing plutôt que
// de faire planter tout l'éditeur : le texte reste visible tel quel en mode
// Source, à corriger à la main si besoin. Le corps commence au vrai texte
// (les lignes vides qui suivent le `---` fermant font partie du bloc).
export function parseFrontmatter(content: string): { data: FrontmatterData; body: string } {
  const { data, body } = splitFrontmatter(content);
  return { data, body };
}

//////// 2. joinFrontmatter / serializeFrontmatter / replaceFrontmatterData ///

// Recompose `block + body` sans toucher au bloc (voie d'écriture du corps
// en mode Intermédiaire). Seule retouche : un bloc qui s'arrête sur le
// `---` fermant sans fin de ligne (fichier `---\na: 1\n---`) reçoit une
// fin de ligne avant un corps non vide — sinon le premier mot tapé se
// collerait au délimiteur (`---Bonjour`) et casserait le frontmatter.
export function joinFrontmatter(block: string, body: string): string {
  if (!block || !body || block.endsWith('\n')) return block + body;
  return `${block}${detectEol(block)}${body}`;
}

// Recompose le contenu complet à partir des propriétés + du corps. Pas de
// bloc frontmatter du tout si `data` est vide (une note sans propriété n'a
// pas besoin d'un `---\n---\n\n` vide). Normalise toujours un séparateur
// `\n\n` entre le bloc et le corps : simple et stable pour un aller-retour
// parse→édition→sérialisation répété.
export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const keys = Object.keys(data);
  const trimmedBody = body.replace(/^\n+/, '');
  if (keys.length === 0) return trimmedBody;

  const yamlBlock = dump(data).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${trimmedBody}`;
}

// Remplace les propriétés d'un contenu EXISTANT (carte Propriétés, dates
// système à la sauvegarde) en gardant tout le reste : BOM, style de fin de
// ligne (CRLF conservé), corps à l'identique. Un contenu dont le bloc ne
// parse pas n'a pas de frontmatter reconnu : le nouveau bloc est ajouté
// devant le texte, qui reste intact.
export function replaceFrontmatterData(content: string, data: FrontmatterData): string {
  const { block, body, bom, eol } = splitFrontmatter(content);
  const rawBody = block ? body : body.slice(bom.length);
  if (Object.keys(data).length === 0) return bom + rawBody;
  const yamlBlock = dump(data).trimEnd().split('\n').join(eol);
  return `${bom}---${eol}${yamlBlock}${eol}---${eol}${eol}${rawBody}`;
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

//////// 5. newNoteFrontmatter — gabarit des nouvelles notes ////////////////

// Frontmatter écrit à la création d'une note markdown (nouvelle note, note
// journalière) sur les trois plateformes. Plus de `title` (demande
// 2026-11-14 : la propriété faisait doublon avec le nom du fichier, qui
// reste le seul nom affiché/recherché) ; les notes existantes qui en ont
// un ne sont PAS réécrites — le ✕ de la carte Propriétés le retire.
export function newNoteFrontmatter(now: Date = new Date()): string {
  return `---\ncreated: ${now.toISOString()}\n---\n\n`;
}
