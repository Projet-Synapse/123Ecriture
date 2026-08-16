import { ipcMain } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

import * as vaults from './vaults';
import type { OccurrenceEntry, OccurrencePatch } from './types';

// Module "Occurrences" (voir docs/ARCHITECTURE.md §4/§8, panneau
// OccurrencesPanel.tsx dans la barre latérale) : dictionnaire personnel de
// mots `{{mot}}` — mélange lien interne/mot-clé, voir la description de
// l'utilisatrice. Un seul fichier plat `.123ecriture/occurrences.json` par
// coffre, même schéma que properties.js (pas de notion de "liste active").
//
// Particularité par rapport à properties.js : renommer un mot DOIT rester
// cohérent avec tout le texte déjà écrit (contrairement à une propriété,
// dont le nom ne vit que dans le frontmatter d'une note à la fois) — donc
// `occurrences:update` réécrit `{{ancien}}` → `{{nouveau}}` dans tous les
// `.mdx` du coffre AVANT de persister le renommage, plutôt que de laisser
// les occurrences déjà tapées devenir orphelines.

function getVaultPath(): string | null {
  return vaults.getActiveVaultPath();
}

function getOccurrencesFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'occurrences.json');
}

function readOccurrences(vaultPath: string): OccurrenceEntry[] {
  try {
    return JSON.parse(fsSync.readFileSync(getOccurrencesFilePath(vaultPath), 'utf8')) as OccurrenceEntry[];
  } catch {
    return [];
  }
}

async function writeOccurrences(vaultPath: string, occurrences: OccurrenceEntry[]): Promise<OccurrenceEntry[]> {
  const filePath = getOccurrencesFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(occurrences, null, 2), 'utf8');
  return occurrences;
}

// Échappe les caractères spéciaux regex d'un mot avant de l'utiliser dans
// un pattern — les mots du dictionnaire sont du texte libre, pas des
// fragments de regex.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function walkMdxFiles(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMdxFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      out.push(fullPath);
    }
  }
  return out;
}

// Parcourt tous les `.mdx` du coffre et remplace `{{ancien}}` par
// `{{nouveau}}` (comparaison EXACTE du mot entre les accolades, espaces
// superflus tolérés comme à l'affichage) — n'écrit que les fichiers
// réellement modifiés.
async function renameOccurrenceEverywhere(vaultPath: string, oldWord: string, newWord: string): Promise<void> {
  const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(oldWord)}\\s*\\}\\}`, 'g');
  const files = await walkMdxFiles(vaultPath);
  for (const fullPath of files) {
    const content = await fs.readFile(fullPath, 'utf8');
    if (!pattern.test(content)) continue;
    pattern.lastIndex = 0;
    const updated = content.replace(pattern, `{{${newWord}}}`);
    if (updated !== content) await fs.writeFile(fullPath, updated, 'utf8');
  }
}

// Renvoie les `.mdx` (chemins relatifs au coffre) qui mentionnent
// littéralement `{{word}}` — calculé à la demande (pas d'index précalculé),
// cohérent avec le reste de l'app (ex. flattenNotes côté renderer).
async function findNotesContaining(vaultPath: string, word: string): Promise<string[]> {
  const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(word)}\\s*\\}\\}`);
  const files = await walkMdxFiles(vaultPath);
  const matches: string[] = [];
  for (const fullPath of files) {
    const content = await fs.readFile(fullPath, 'utf8');
    if (pattern.test(content)) matches.push(path.relative(vaultPath, fullPath));
  }
  return matches;
}

export function registerOccurrencesHandlers(): void {
  ipcMain.handle('occurrences:list', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return readOccurrences(vaultPath);
  });

  ipcMain.handle('occurrences:create', async (_event, word: string, description: string | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (word ?? '').trim();
    if (!trimmed) throw new Error('Le mot ne peut pas être vide.');

    const occurrences = readOccurrences(vaultPath);
    if (occurrences.some((o) => o.word.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Ce mot existe déjà dans le dictionnaire.');
    }
    occurrences.push({
      id: crypto.randomUUID(),
      word: trimmed,
      description: (description ?? '').trim(),
      createdAt: new Date().toISOString(),
    });
    return writeOccurrences(vaultPath, occurrences);
  });

  ipcMain.handle('occurrences:update', async (_event, id: string, patch: OccurrencePatch | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const occurrences = readOccurrences(vaultPath);
    const existing = occurrences.find((o) => o.id === id);
    if (!existing) throw new Error('Occurrence introuvable.');

    if (patch?.word !== undefined) {
      const trimmed = patch.word.trim();
      if (!trimmed) throw new Error('Le mot ne peut pas être vide.');
      if (occurrences.some((o) => o.id !== id && o.word.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('Ce mot existe déjà dans le dictionnaire.');
      }
      if (trimmed !== existing.word) {
        await renameOccurrenceEverywhere(vaultPath, existing.word, trimmed);
        existing.word = trimmed;
      }
    }
    if (patch?.description !== undefined) {
      existing.description = patch.description;
    }
    return writeOccurrences(vaultPath, occurrences);
  });

  ipcMain.handle('occurrences:remove', async (_event, id: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const occurrences = readOccurrences(vaultPath).filter((o) => o.id !== id);
    return writeOccurrences(vaultPath, occurrences);
  });

  ipcMain.handle('occurrences:find-notes', async (_event, word: string | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return findNotesContaining(vaultPath, word ?? '');
  });
}
