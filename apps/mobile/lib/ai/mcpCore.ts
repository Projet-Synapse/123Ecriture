// ✒️ 123ECRITURE — lib/ai/mcpCore.ts — serveur MCP de la passerelle IA (cœur, lecture seule)
//////////////////////////////////////////////////////////////////////////////
//
// Cœur du serveur MCP local (v0.4.100) : protocole JSON-RPC 2.0 de MCP
// (initialize, tools/list, tools/call, ping) et les 3 outils en LECTURE
// SEULE : list_files, read_file, search. Le transport HTTP (127.0.0.1,
// jeton) et l'accès disque vivent côté Electron (electron/aiGateway.ts),
// injectés ici par `McpDeps` — ce qui rend ce cœur testable sans réseau
// (mcpCore.test.ts).
//
// Invariants du fichier :
//   • CHAQUE chemin passe par decideAiAction / isVisibleToAi
//     (lib/ai/aiPolicy.ts) : verrouillé, interne, hors dossiers autorisés
//     ou action interdite → jamais listé, lu ni cherché.
//   • « Demander » n'a pas encore d'écran de confirmation : traité comme
//     un refus (journalisé « ask »).
//   • Chaque appel d'outil est JOURNALISÉ (deps.log), refus compris.
//   • Réglages relus À CHAQUE appel (deps.load) : désactivation,
//     verrouillage, révocation s'appliquent immédiatement.
//
//////////////////////////////////////////////////////////////////////////////

import { decideAiAction, isVisibleToAi, type AiGatewaySettings, type AiJournalEntry } from './aiPolicy';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_MAX_READ_BYTES = 512 * 1024;
const MAX_LIST = 2000;
const MAX_SEARCH_FILES = 5000;
const SEARCHABLE = /\.(md|mdx|txt|canvas|csv|json|ya?ml)$/i;

export type McpDeps = {
  load: () => Promise<{ settings: AiGatewaySettings; locked: string[] }>;
  // Tous les FICHIERS du coffre (chemins relatifs, `/`).
  listFiles: () => Promise<string[]>;
  readFile: (relPath: string) => Promise<string>;
  log: (entry: AiJournalEntry) => void;
  now?: () => Date;
  client?: string;
};

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export const MCP_TOOLS = [
  {
    name: 'list_files',
    description:
      'Liste les fichiers du coffre 123Ecriture accessibles à l’IA (chemins relatifs). Optionnel : un dossier de départ.',
    inputSchema: {
      type: 'object',
      properties: { folder: { type: 'string', description: 'Dossier relatif, ex. « Projets/Roman ». Vide = tout.' } },
    },
  },
  {
    name: 'read_file',
    description: 'Lit le contenu texte (Markdown) d’un fichier du coffre 123Ecriture.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Chemin relatif, ex. « Projets/Roman/Chapitre 1.md ».' } },
      required: ['path'],
    },
  },
  {
    name: 'search',
    description: 'Cherche un texte (sans tenir compte de la casse) dans les noms et contenus des notes accessibles.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texte à chercher.' },
        limit: { type: 'number', description: 'Nombre maximum de résultats (défaut 20, max 100).' },
      },
      required: ['query'],
    },
  },
];

function text(t: string, isError = false): ToolResult {
  return isError ? { content: [{ type: 'text', text: t }], isError: true } : { content: [{ type: 'text', text: t }] };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function under(folder: string, relPath: string): boolean {
  const f = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  return !f || relPath.toLowerCase() === f || relPath.toLowerCase().startsWith(`${f}/`);
}

function snippetAround(content: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + length + 60);
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < content.length ? '…' : ''}`;
}

async function callTool(name: string, args: Record<string, unknown>, deps: McpDeps): Promise<ToolResult> {
  const { settings, locked } = await deps.load();
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const log = (action: AiJournalEntry['action'], path: string, decision: AiJournalEntry['decision'], reason: string) =>
    deps.log({ at, action, path, decision, reason, ...(deps.client ? { client: deps.client } : {}) });

  if (name === 'list_files' || name === 'search') {
    const action = name === 'list_files' ? 'read' : 'search';
    const folder = name === 'list_files' ? str(args.folder) : '';
    const query = name === 'search' ? str(args.query).trim() : '';
    const label = name === 'search' ? `recherche : ${query}` : folder;
    const d = decideAiAction(settings, locked, { action, path: folder });
    if (d.decision !== 'allow') {
      log(action, label, d.decision, d.reason);
      return text(`Refusé : ${d.reason}`, true);
    }
    if (name === 'search' && !query) return text('Paramètre « query » manquant.', true);
    const visible = (await deps.listFiles()).filter((p) => under(folder, p) && isVisibleToAi(settings, locked, p)).sort();
    if (name === 'list_files') {
      log('read', label, 'allow', `${visible.length} fichier(s) listé(s).`);
      const shown = visible.slice(0, MAX_LIST);
      return text(shown.join('\n') + (visible.length > MAX_LIST ? `\n… (+${visible.length - MAX_LIST})` : '') || '(aucun fichier)');
    }
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
    const needle = query.toLowerCase();
    const hits: string[] = [];
    for (const p of visible.filter((x) => SEARCHABLE.test(x)).slice(0, MAX_SEARCH_FILES)) {
      if (hits.length >= limit) break;
      if (p.toLowerCase().includes(needle)) {
        hits.push(`${p}\n  (nom du fichier)`);
        continue;
      }
      let content = '';
      try {
        content = await deps.readFile(p);
      } catch {
        continue;
      }
      const i = content.toLowerCase().indexOf(needle);
      if (i >= 0) hits.push(`${p}\n  ${snippetAround(content, i, needle.length)}`);
    }
    log('search', label, 'allow', `${hits.length} résultat(s).`);
    return text(hits.length ? hits.join('\n') : 'Aucun résultat.');
  }

  if (name === 'read_file') {
    const path = str(args.path).replace(/\\/g, '/').replace(/^\/+/, '');
    const d = decideAiAction(settings, locked, { action: 'read', path });
    if (d.decision !== 'allow' || !path) {
      const reason = path ? d.reason : 'Paramètre « path » manquant.';
      log('read', path, d.decision === 'allow' ? 'deny' : d.decision, reason);
      return text(`Refusé : ${reason}`, true);
    }
    let content: string;
    try {
      content = await deps.readFile(path);
    } catch {
      log('read', path, 'deny', 'Fichier introuvable.');
      return text(`Fichier introuvable : ${path}`, true);
    }
    if (content.includes('\u0000')) {
      log('read', path, 'deny', 'Fichier binaire.');
      return text('Fichier binaire : lecture refusée.', true);
    }
    const truncated = content.length > MCP_MAX_READ_BYTES;
    log('read', path, 'allow', truncated ? 'Lu (tronqué).' : 'Lu.');
    return text(truncated ? `${content.slice(0, MCP_MAX_READ_BYTES)}\n… (tronqué)` : content);
  }

  return text(`Outil inconnu : ${name}`, true);
}

// Une requête JSON-RPC → sa réponse (null pour une notification).
export async function handleMcpMessage(msg: JsonRpcRequest, deps: McpDeps): Promise<object | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isNotification ? null : err(-32600, 'Requête invalide');
  switch (msg.method) {
    case 'initialize':
      return ok({
        protocolVersion: str(msg.params?.protocolVersion) || MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: '123ecriture', version: '1.0.0' },
        instructions:
          'Accès en LECTURE SEULE au coffre de notes 123Ecriture. Utilise list_files, search puis read_file. Les dossiers verrouillés sont invisibles.',
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: MCP_TOOLS });
    case 'tools/call': {
      const name = str(msg.params?.name);
      const args = (msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}) as Record<
        string,
        unknown
      >;
      try {
        return ok(await callTool(name, args, deps));
      } catch (error) {
        return ok(text(`Erreur : ${error instanceof Error ? error.message : String(error)}`, true));
      }
    }
    default:
      if (msg.method.startsWith('notifications/')) return null;
      return isNotification ? null : err(-32601, `Méthode inconnue : ${msg.method}`);
  }
}

// Origine d'un navigateur : seules les pages locales sont admises (protection
// contre le « DNS rebinding » — une page web qui viserait 127.0.0.1).
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

// En-tête Authorization: Bearer <jeton> → jeton (ou null).
export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return m ? m[1] : null;
}
