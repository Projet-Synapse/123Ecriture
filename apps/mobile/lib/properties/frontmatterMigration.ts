import { parseFrontmatter, serializeFrontmatter, type FrontmatterData } from './frontmatter';

// ✒️ 123ECRITURE — lib/properties/frontmatterMigration.ts — migration de clé de frontmatter
//////////////////////////////////////////////////////////////////////////////
//
// Migration de la CLÉ de frontmatter d'une note quand une propriété est
// renommée dans le schéma (voir apps/desktop/electron/properties.ts,
// `properties:update`). Contrairement au reste de properties.ts (qui ne
// touche jamais aux notes), un renommage de propriété doit migrer la
// VALEUR déjà écrite sous l'ancienne clé, sans quoi elle devient
// orpheline du point de vue de l'UI (qui lit désormais le nouveau nom).
// Fonction pure et testable (comme lib/sync/diff.ts) — le handler IPC
// l'appelle une fois par note du coffre.
//
// Invariants du fichier :
//   • JAMAIS d'écrasement silencieux d'une valeur existante : si la
//     nouvelle clé porte déjà une valeur sur la note, la note reste telle
//     quelle et le cas remonte comme `skipped` pour être compté côté
//     appelant.
//   • La clé renommée est remplacée À SA PLACE d'origine (pas de
//     suppression + rajout en fin) : l'ordre des propriétés dans le YAML
//     sérialisé reste proche de l'original.
//   • `changed` faux → contenu identique à l'entrée : rien à réécrire sur
//     disque.
//   • `oldKey`/`newKey` sont supposés non-vides et différents — l'appelant
//     ne migre que si le nom a réellement changé.
//
// SOMMAIRE :
//   1. migrateFrontmatterKey — renommage d'une clé de frontmatter
//
//////////////////////////////////////////////////////////////////////////////

export interface FrontmatterKeyMigrationResult {
  // Contenu final du fichier — identique à `content` d'entrée si
  // `changed` est faux (rien à réécrire sur disque dans ce cas).
  content: string;
  // La clé a été renommée : le fichier doit être réécrit.
  changed: boolean;
  // La note a bien l'ancienne clé, mais la nouvelle existe déjà avec sa
  // propre valeur — ignorée pour ne JAMAIS écraser silencieusement une
  // valeur existante (voir CLAUDE.md, "sauvegarde et gestion des
  // données").
  skipped: boolean;
}

//////// 1. migrateFrontmatterKey — renommage d'une clé de frontmatter ///////

// `oldKey`/`newKey` supposés non-vides et différents — l'appelant (ici
// `properties:update`) ne migre que si le nom a réellement changé.
export function migrateFrontmatterKey(content: string, oldKey: string, newKey: string): FrontmatterKeyMigrationResult {
  const { data, body } = parseFrontmatter(content);

  // Pas d'ancienne clé sur cette note : rien à migrer, contenu intact.
  if (!(oldKey in data)) {
    return { content, changed: false, skipped: false };
  }

  // La nouvelle clé porte déjà une valeur sur cette note (ex. tapée à la
  // main avant le renommage, ou héritée d'une autre propriété du même
  // nom) : ne jamais l'écraser silencieusement — la note reste telle
  // quelle, le cas remonte comme "skipped" pour être compté côté appelant.
  if (newKey in data) {
    return { content, changed: false, skipped: true };
  }

  // Reconstruit l'objet en remplaçant la clé À SA PLACE d'origine (plutôt
  // que de la supprimer puis rajouter `newKey` en fin d'objet) — garde
  // l'ordre des propriétés dans le YAML sérialisé proche de l'original.
  const nextData: FrontmatterData = {};
  for (const [key, value] of Object.entries(data)) {
    nextData[key === oldKey ? newKey : key] = value;
  }

  return { content: serializeFrontmatter(nextData, body), changed: true, skipped: false };
}
