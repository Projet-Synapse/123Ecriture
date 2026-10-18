import { BUBBLE_PROPERTY_NAMES, inferPropertyType, makePropertyDefinition } from './propertyTypes';

// ✒️ 123ECRITURE — lib/properties/propertyScanMerge.ts — fusion du scan de propriétés
//////////////////////////////////////////////////////////////////////////////
//
// Fusion du scan de propriétés (auto-enregistrement des clés de
// frontmatter, voir properties:scan-vault côté desktop et
// PropertiesBridge.scanVault côté web) — extraite en fonction PURE pour
// que les DEUX ports partagent la même logique, testée ici par Vitest, sur
// le modèle de frontmatterMigration.ts (le desktop importe déjà des
// fonctions pures de apps/mobile/lib, esbuild les bundle sans problème).
//
// Invariants du fichier :
//   • Une clé de frontmatter non enregistrée CRÉE une définition avec le
//     type déduit de la valeur (inferPropertyType).
//   • La fusion est INSENSIBLE À LA CASSE : une note qui écrit `Tags`
//     alors que `tags` est déjà enregistré ne crée rien — la graphie
//     enregistrée gagne.
//   • Le compteur d'usage est indexé par le NOM CANONIQUE (graphie
//     enregistrée quand elle existe, première graphie rencontrée sinon) :
//     `Tags` sur 3 notes avec la définition `tags` affiche 3, pas 0.
//   • created/modified sont EXCLUES du scan : matérialisées par l'APP à
//     chaque sauvegarde (NotesScreen.tsx) — les enregistrerait en doublon
//     à chaque scan.
//   • Le scan ne crée jamais de troisième graphie si le schéma porte déjà
//     un doublon de casse : premier gagnant.
//
// SOMMAIRE :
//   1. Types et exclusions — SYSTEM_SCAN_EXCLUDED_KEYS, PropertyScanMerger
//   2. createPropertyScanMerger — l'état de fusion
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Types et exclusions — SYSTEM_SCAN_EXCLUDED_KEYS, PropertyScanMerger ///

// Toutes les propriétés mentionnées dans les fichiers s'enregistrent avec
// leur compteur d'usage — seules les dates système font exception (voir
// l'invariant en en-tête).
export const SYSTEM_SCAN_EXCLUDED_KEYS = ['created', 'modified'] as const;

export type PropertyScanMerger = {
  // Absorbe le frontmatter d'UNE note (Object.entries du parseFrontmatter).
  absorbNoteFrontmatter: (data: Record<string, unknown>) => void;
  // Usage par nom canonique — consommé tel quel par PropertiesManagementSection
  // (usage[def.name] ?? 0).
  usage: Record<string, number>;
  // Définitions créées pendant CE scan, à concaténer au schéma persisté.
  toCreate: PropertyDefinition[];
};

//////// 2. createPropertyScanMerger — l'état de fusion //////////////////////

export function createPropertyScanMerger(
  existingNames: string[],
  options: { newId: () => string; now?: () => string },
): PropertyScanMerger {
  const { newId, now = () => new Date().toISOString() } = options;

  // lower → nom canonique : les définitions déjà enregistrées fixent la
  // graphie de référence ; une clé inconnue posera la sienne à la première
  // rencontre (les suivantes ne diffèrent que par la casse → même entrée).
  const lowerToCanonicalName = new Map<string, string>();
  for (const name of existingNames) {
    const lower = name.toLowerCase();
    // Premier gagnant si le schéma lui-même porte un doublon de casse (le
    // scan ne doit jamais en rajouter un troisième).
    if (!lowerToCanonicalName.has(lower)) lowerToCanonicalName.set(lower, name);
  }

  const usage: Record<string, number> = {};
  const toCreate: PropertyDefinition[] = [];

  return {
    absorbNoteFrontmatter(data) {
      for (const [key, value] of Object.entries(data)) {
        if ((SYSTEM_SCAN_EXCLUDED_KEYS as readonly string[]).includes(key)) continue;

        const lower = key.toLowerCase();
        const canonical = lowerToCanonicalName.get(lower);
        if (canonical === undefined) {
          lowerToCanonicalName.set(lower, key);
          // tags/aliases : type 'bubbles' même si la valeur est un tableau
          // (qui aurait été deviné 'list') — voir propertyTypes.ts.
          const type =
            BUBBLE_PROPERTY_NAMES.has(lower) && Array.isArray(value)
              ? 'bubbles'
              : inferPropertyType(value);
          toCreate.push(makePropertyDefinition(newId(), key, type, now()));
          usage[key] = (usage[key] ?? 0) + 1;
        } else {
          usage[canonical] = (usage[canonical] ?? 0) + 1;
        }
      }
    },
    usage,
    toCreate,
  };
}
