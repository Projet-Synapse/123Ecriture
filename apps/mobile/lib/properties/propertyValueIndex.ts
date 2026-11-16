// ✒️ 123ECRITURE — lib/properties/propertyValueIndex.ts — index des valeurs de propriétés du coffre
//////////////////////////////////////////////////////////////////////////////
//
// Valeurs déjà utilisées par propriété, pour l'autocomplétion
// (propertyValueSuggestions.ts). Construit À LA DEMANDE — au premier focus
// d'un champ de valeur — en lisant le frontmatter des notes (.md/.mdx) via
// le pont du coffre : desktop, web et Android, sans nouveau pont natif.
// Un seul index partagé par tous les champs (store de module +
// useSyncExternalStore), relu après RELOAD_AFTER_MS ou quand le coffre
// change ; une valeur validée y est ajoutée tout de suite (rememberValue).
// Plafond MAX_NOTES : au-delà, les notes suivantes sont ignorées.
//
//////////////////////////////////////////////////////////////////////////////

import { useSyncExternalStore } from 'react';

import { parseFrontmatter } from './frontmatter';
import { flattenNotes } from '../notes/vaultTree';
import { absorbFrontmatterValues, flattenPropertyValue, type PropertyValueIndex } from './propertyValueSuggestions';

const RELOAD_AFTER_MS = 2 * 60 * 1000;
const MAX_NOTES = 3000;
const CONCURRENCY = 8;

let index: PropertyValueIndex | null = null;
let loadedAt = 0;
let loadedFor: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

async function build(vault: VaultBridge): Promise<PropertyValueIndex> {
  const tree = await vault.listTree();
  const notes = flattenNotes(tree)
    .filter((note) => /\.(md|mdx)$/i.test(note.relPath))
    .slice(0, MAX_NOTES);
  const next: PropertyValueIndex = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < notes.length) {
      const note = notes[cursor++];
      if (!note) break;
      try {
        absorbFrontmatterValues(next, parseFrontmatter(await vault.readNote(note.relPath)).data);
      } catch {
        // Note illisible (supprimée entre-temps…) : ignorée.
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return next;
}

// Lance (ou relance si périmé / autre coffre) la construction de l'index.
export function ensurePropertyValueIndex(): void {
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  if (!vault || loading) return;
  loading = (async () => {
    try {
      const vaultPath = await vault.getCurrentPath();
      const fresh = index && loadedFor === vaultPath && Date.now() - loadedAt < RELOAD_AFTER_MS;
      if (fresh) return;
      index = await build(vault);
      loadedAt = Date.now();
      loadedFor = vaultPath;
      emit();
    } catch (err) {
      console.error('[propriétés] index des valeurs indisponible :', err);
    } finally {
      loading = null;
    }
  })();
}

// Une valeur validée devient suggérable tout de suite (sans relire le coffre).
export function rememberPropertyValue(name: string, value: unknown): void {
  if (!index) return;
  const values = flattenPropertyValue(value);
  if (values.length === 0) return;
  const key = name.toLowerCase();
  const counts = new Map(index.get(key) ?? []);
  for (const item of values) if (!counts.has(item)) counts.set(item, 1);
  index = new Map(index).set(key, counts);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PropertyValueIndex | null {
  return index;
}

export function usePropertyValueIndex(): PropertyValueIndex | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
