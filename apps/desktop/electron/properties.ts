import { ipcMain } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

import * as vaults from './vaults';
import type { PropertyDefinition, PropertyPatch, PropertyType } from './types';

// Module "Propriétés" (voir docs/ARCHITECTURE.md §4/§8, panneau
// PropertiesPanel.tsx dans la barre latérale) : schéma global de
// propriétés typées, DANS le vault (comme tasks.js/calendar.js — contenu
// utilisateur, pas un réglage app-level). Un seul fichier PLAT
// `.123ecriture/properties.json` — contrairement à tasklists.json, il n'y a
// qu'UN schéma par coffre, pas une notion de "plusieurs schémas actifs".
//
// Ce fichier ne porte QUE la définition (nom + type) de chaque propriété —
// les VALEURS, elles, vivent dans le frontmatter YAML de chaque note (voir
// apps/mobile/lib/frontmatter.ts), pas ici. Renommer/changer le type/
// supprimer une propriété ne touche donc JAMAIS les notes déjà écrites : ça
// ne modifie que ce registre. Une valeur devient juste "orpheline" (plus
// rattachée à aucune définition du schéma) si sa propriété est renommée ou
// supprimée — choix assumé pour rester simple, cohérent avec le reste de
// l'app qui ne fait jamais de migration silencieuse de contenu.
const PROPERTY_TYPES: PropertyType[] = ['text', 'list', 'number', 'checkbox', 'date', 'datetime'];

function getVaultPath(): string | null {
  return vaults.getActiveVaultPath();
}

function getPropertiesFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'properties.json');
}

function readProperties(vaultPath: string): PropertyDefinition[] {
  try {
    return JSON.parse(fsSync.readFileSync(getPropertiesFilePath(vaultPath), 'utf8')) as PropertyDefinition[];
  } catch {
    return [];
  }
}

async function writeProperties(vaultPath: string, properties: PropertyDefinition[]): Promise<PropertyDefinition[]> {
  const filePath = getPropertiesFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(properties, null, 2), 'utf8');
  return properties;
}

function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as string[]).includes(value);
}

export function registerPropertiesHandlers(): void {
  ipcMain.handle('properties:list', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return readProperties(vaultPath);
  });

  ipcMain.handle('properties:create', async (_event, name: string, type: unknown) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la propriété ne peut pas être vide.');
    if (!isPropertyType(type)) throw new Error('Type de propriété invalide.');

    const properties = readProperties(vaultPath);
    if (properties.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Une propriété porte déjà ce nom.');
    }
    properties.push({ id: crypto.randomUUID(), name: trimmed, type, createdAt: new Date().toISOString() });
    return writeProperties(vaultPath, properties);
  });

  ipcMain.handle('properties:update', async (_event, id: string, patch: PropertyPatch | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const properties = readProperties(vaultPath);
    const existing = properties.find((p) => p.id === id);
    if (!existing) throw new Error('Propriété introuvable.');

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
    return writeProperties(vaultPath, properties);
  });

  ipcMain.handle('properties:remove', async (_event, id: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const properties = readProperties(vaultPath).filter((p) => p.id !== id);
    return writeProperties(vaultPath, properties);
  });
}
