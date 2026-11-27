// ✒️ 123ECRITURE — lib/ai/ellieVault.ts — accès coffre + journal pour le chat Ellie
//////////////////////////////////////////////////////////////////////////////
//
// Construit les `McpDeps` du renderer (window.vault) pour qu'Ellie passe
// par la même logique que la passerelle (runVaultAiTool). Le journal est
// écrit dans `.123ecriture/ai-journal.json`, en chaîne (pas d'écriture
// concurrente).
//
//////////////////////////////////////////////////////////////////////////////

import { AI_JOURNAL_PATH, appendAiJournal, parseAiJournal, type AiGatewaySettings, type AiJournalEntry } from './aiPolicy';
import type { McpDeps } from './mcpCore';

export function flattenVaultFiles(tree: VaultTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: VaultTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'folder') walk(node.children ?? []);
      else out.push(node.relPath);
    }
  };
  walk(tree);
  return out;
}

let journalChain: Promise<void> = Promise.resolve();

export function appendEllieJournal(entry: AiJournalEntry): void {
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  if (!vault?.readNote || !vault.writeNote) return;
  journalChain = journalChain
    .then(async () => {
      let current: AiJournalEntry[] = [];
      try {
        current = parseAiJournal(await vault.readNote(AI_JOURNAL_PATH));
      } catch {
        current = [];
      }
      await vault.writeNote(AI_JOURNAL_PATH, `${JSON.stringify(appendAiJournal(current, entry), null, 2)}\n`);
    })
    .catch(() => undefined);
}

export function createRendererEllieVault(
  load: () => Promise<{ settings: AiGatewaySettings; locked: string[] }>,
  client: string,
): McpDeps {
  return {
    load,
    client,
    log: (entry) => appendEllieJournal({ ...entry, client: entry.client ?? client }),
    listFiles: async () => {
      const vault = typeof window !== 'undefined' ? window.vault : undefined;
      if (!vault?.listTree) return [];
      return flattenVaultFiles(await vault.listTree());
    },
    readFile: async (relPath) => {
      const vault = typeof window !== 'undefined' ? window.vault : undefined;
      if (!vault?.readNote) throw new Error('Coffre indisponible.');
      return vault.readNote(relPath);
    },
  };
}
