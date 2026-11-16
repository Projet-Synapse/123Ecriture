// ✒️ 123ECRITURE — lib/properties/propertiesBridgeCore.ts — pont Propriétés indépendant du stockage
//////////////////////////////////////////////////////////////////////////////
//
// Logique du pont `window.properties` (schéma `.123ecriture/properties.json`
// + migration des frontmatters au renommage + scan du coffre), écrite UNE
// fois contre une petite interface d'E/S — utilisée par Android
// (nativePropertiesAdapter.ts, lecture/écriture via le coffre actif) et
// testée en mémoire (propertiesBridgeCore.test.ts). Même format et mêmes
// validations que le desktop (apps/desktop/electron/properties.ts) et le
// web (webPropertiesAdapter) : un coffre partagé reste lisible partout.
//
// Invariants du fichier :
//   • Noms uniques sans tenir compte de la casse, jamais vides ; types
//     limités à la liste connue ; options normalisées (vides retirées).
//   • Renommage : schéma écrit D'ABORD, migration des notes ensuite ; une
//     note en échec n'interrompt pas les suivantes (compteur d'erreurs).
//   • JSON illisible : sauvegarde `.corrupt-*` avant de repartir à vide —
//     jamais de perte silencieuse (comme events.json/tasks.json natifs).
//   • Jamais de réécriture à contenu identique (writeText décide, voir
//     writeNoteIfChanged côté adaptateur).
//
// SOMMAIRE :
//   1. Interface d'E/S et validations
//   2. createPropertiesBridge
//
//////////////////////////////////////////////////////////////////////////////

import { parseFrontmatter } from './frontmatter';
import { migrateFrontmatterKey } from './frontmatterMigration';
import { createPropertyScanMerger } from './propertyScanMerge';

//////// 1. Interface d'E/S et validations ////////////////////////////////////

export const PROPERTIES_PATH = '.123ecriture/properties.json';

export type PropertiesIo = {
  // Lève une erreur si le fichier est absent.
  readText: (relPath: string) => Promise<string>;
  writeText: (relPath: string, content: string) => Promise<void>;
  // Notes markdown (.md/.mdx) du coffre, hors corbeille.
  listNotes: () => Promise<string[]>;
  newId: () => string;
  now?: () => string;
};

const PROPERTY_TYPES: PropertyType[] = [
  'text', 'list', 'number', 'checkbox', 'date', 'datetime', 'path', 'options', 'multi-options', 'bubbles',
];

// tags/aliases enregistrées en 'list' par un ancien scan : lues en 'bubbles'
// (migration paresseuse, comme le desktop — fichier non réécrit pour ça).
const BUBBLE_PROPERTY_NAMES = ['tags', 'tag', 'aliases', 'alias'];

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as string[]).includes(value);
}

export function normalizeOptions(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('La liste d’options est invalide.');
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

//////// 2. createPropertiesBridge /////////////////////////////////////////////

export function createPropertiesBridge(io: PropertiesIo): PropertiesBridge {
  const now = io.now ?? (() => new Date().toISOString());

  const read = async (): Promise<PropertyDefinition[]> => {
    let raw: string;
    try {
      raw = await io.readText(PROPERTIES_PATH);
    } catch {
      return []; // aucun schéma encore, ou coffre inactif
    }
    try {
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value)) return [];
      return (value as PropertyDefinition[]).map((def) =>
        typeof def?.name === 'string' && BUBBLE_PROPERTY_NAMES.includes(def.name.toLowerCase()) && def.type === 'list'
          ? ({ ...def, type: 'bubbles' } as PropertyDefinition)
          : def,
      );
    } catch {
      const backup = `${PROPERTIES_PATH}.corrupt-${Date.now()}`;
      try {
        await io.writeText(backup, raw);
        console.error(`[properties] properties.json : JSON cassé — contenu sauvegardé dans ${backup}`);
      } catch {
        console.error('[properties] properties.json : JSON cassé ET sauvegarde impossible');
      }
      return [];
    }
  };

  const write = async (properties: PropertyDefinition[]): Promise<PropertyDefinition[]> => {
    await io.writeText(PROPERTIES_PATH, JSON.stringify(properties, null, 2));
    return properties;
  };

  const migrate = async (oldName: string, newName: string): Promise<PropertyRenameMigrationSummary> => {
    const summary: PropertyRenameMigrationSummary = { migratedCount: 0, skippedCount: 0, errorCount: 0 };
    for (const relPath of await io.listNotes()) {
      try {
        const result = migrateFrontmatterKey(await io.readText(relPath), oldName, newName);
        if (result.skipped) {
          summary.skippedCount += 1;
          continue;
        }
        if (!result.changed) continue;
        await io.writeText(relPath, result.content);
        summary.migratedCount += 1;
      } catch (error) {
        console.error(`[properties] échec de la migration du frontmatter pour "${relPath}" :`, error);
        summary.errorCount += 1;
      }
    }
    return summary;
  };

  return {
    list: () => read(),

    create: async (name, type, options) => {
      const trimmed = (name ?? '').trim();
      if (!trimmed) throw new Error('Le nom de la propriété ne peut pas être vide.');
      if (!isPropertyType(type)) throw new Error('Type de propriété invalide.');
      const properties = await read();
      if (properties.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('Une propriété porte déjà ce nom.');
      }
      const normalized = normalizeOptions(options);
      // Cast via unknown : la lib DOM déclare aussi une interface globale
      // PropertyDefinition (CSS @property) qui fusionne avec la nôtre.
      const definition = {
        id: io.newId(),
        name: trimmed,
        type,
        createdAt: now(),
        ...(normalized !== undefined ? { options: normalized } : {}),
      } as unknown as PropertyDefinition;
      return write([...properties, definition]);
    },

    update: async (id, patch) => {
      const properties = await read();
      const existing = properties.find((p) => p.id === id);
      if (!existing) throw new Error('Propriété introuvable.');
      const previousName = existing.name;
      if (patch?.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) throw new Error('Le nom de la propriété ne peut pas être vide.');
        if (properties.some((p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase())) {
          throw new Error('Une propriété porte déjà ce nom.');
        }
        existing.name = trimmed;
      }
      if (patch?.type !== undefined) {
        if (!isPropertyType(patch.type)) throw new Error('Type de propriété invalide.');
        existing.type = patch.type;
      }
      if (patch?.options !== undefined) existing.options = normalizeOptions(patch.options);
      await write(properties);
      if (existing.name !== previousName) {
        return { properties, migration: await migrate(previousName, existing.name) };
      }
      return { properties };
    },

    remove: async (id) => write((await read()).filter((p) => p.id !== id)),

    scanVault: async () => {
      const properties = await read();
      const merger = createPropertyScanMerger(
        properties.map((p) => p.name),
        { newId: io.newId, now },
      );
      for (const relPath of await io.listNotes()) {
        let content: string;
        try {
          content = await io.readText(relPath);
        } catch {
          continue; // note disparue entre le listage et la lecture
        }
        merger.absorbNoteFrontmatter(parseFrontmatter(content).data);
      }
      const updated = merger.toCreate.length > 0 ? await write([...properties, ...merger.toCreate]) : properties;
      return { properties: updated, usage: merger.usage, createdCount: merger.toCreate.length };
    },
  };
}
