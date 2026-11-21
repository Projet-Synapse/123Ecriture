// ✒️ 123ECRITURE — electron/aiGateway.ts — passerelle IA : serveur MCP local (lecture seule)
//////////////////////////////////////////////////////////////////////////////
//
// Serveur MCP (transport « Streamable HTTP », réponses JSON) qui laisse
// une IA LOCALE lire le coffre actif : outils list_files / read_file /
// search (cœur : apps/mobile/lib/ai/mcpCore.ts).
//
// Invariants du fichier :
//   • N'écoute QUE sur 127.0.0.1:AI_GATEWAY_PORT, et SEULEMENT quand la
//     passerelle est activée ET qu'un jeton existe (vérifié toutes les
//     5 s : activer, désactiver, révoquer s'appliquent sans redémarrer).
//   • Chaque requête exige `Authorization: Bearer <jeton>` ; on compare
//     le SHA-256 du jeton à l'empreinte des réglages (temps constant).
//     Origine navigateur non locale refusée (DNS rebinding).
//   • Réglages relus à chaque requête dans le coffre actif
//     (.123ecriture/preferences.json, la copie synchronisée), repli sur
//     la config locale.
//   • Aucune écriture dans le coffre hors du journal local
//     (.123ecriture/ai-journal.json, non synchronisé).
//
//////////////////////////////////////////////////////////////////////////////

import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';

import { normalizeLockedPaths } from '../../mobile/lib/ai/aiLock';
import {
  AI_JOURNAL_PATH,
  appendAiJournal,
  normalizeAiGateway,
  parseAiJournal,
  sameTokenHash,
  type AiGatewaySettings,
  type AiJournalEntry,
} from '../../mobile/lib/ai/aiPolicy';
import { bearerToken, handleMcpMessage, isAllowedOrigin, type McpDeps } from '../../mobile/lib/ai/mcpCore';
import { getActiveVaultPath } from './ponts-desktop/vaults';
import { resolveInVault } from './ponts-desktop/coffre-outils';
import { getPreferences } from './preferences';

export const AI_GATEWAY_PORT = 37123;
const MAX_BODY = 1024 * 1024;

type Loaded = { settings: AiGatewaySettings; locked: string[] };

function loadSettings(vaultPath: string | null): Loaded {
  let prefs: { aiGateway?: unknown; aiLockedPaths?: unknown } = getPreferences();
  if (vaultPath) {
    try {
      const raw = fs.readFileSync(path.join(vaultPath, '.123ecriture', 'preferences.json'), 'utf-8');
      const parsed = JSON.parse(raw) as typeof prefs;
      if (parsed && typeof parsed === 'object') prefs = parsed;
    } catch {
      // Pas encore de copie dans le coffre : config locale.
    }
  }
  return { settings: normalizeAiGateway(prefs.aiGateway), locked: normalizeLockedPaths(prefs.aiLockedPaths) };
}

// Fichiers du coffre (dossiers cachés ignorés — la politique les refuse
// de toute façon).
async function walkFiles(root: string, dir = root, out: string[] = []): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkFiles(root, full, out);
    else if (e.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

// Journal : écritures SÉRIALISÉES (une chaîne de promesses).
let journalChain: Promise<void> = Promise.resolve();
function appendJournal(vaultPath: string, entry: AiJournalEntry): void {
  journalChain = journalChain
    .then(async () => {
      const file = path.join(vaultPath, ...AI_JOURNAL_PATH.split('/'));
      let current: AiJournalEntry[] = [];
      try {
        current = parseAiJournal(await fs.promises.readFile(file, 'utf-8'));
      } catch {
        current = [];
      }
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(appendAiJournal(current, entry), null, 2), 'utf-8');
    })
    .catch((error) => console.error('[passerelle IA] journal :', error));
}

function send(res: http.ServerResponse, status: number, body?: object): void {
  res.writeHead(status, body ? { 'Content-Type': 'application/json; charset=utf-8' } : {});
  res.end(body ? JSON.stringify(body) : undefined);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!isAllowedOrigin(req.headers.origin)) return send(res, 403, { error: 'Origine refusée' });
  const url = (req.url ?? '').split('?')[0];
  if (url !== '/mcp') return send(res, 404, { error: 'Introuvable — utiliser /mcp' });
  const vaultPath = getActiveVaultPath();
  const loaded = loadSettings(vaultPath);
  const token = bearerToken(req.headers.authorization);
  const hash = token ? createHash('sha256').update(token, 'utf8').digest('hex') : '';
  if (!loaded.settings.enabled || !loaded.settings.tokenHash || !token || !sameTokenHash(hash, loaded.settings.tokenHash)) {
    if (vaultPath && token) {
      appendJournal(vaultPath, {
        at: new Date().toISOString(),
        action: 'auth',
        path: '',
        decision: 'deny',
        reason: loaded.settings.enabled ? 'Jeton invalide ou révoqué.' : 'Passerelle désactivée.',
      });
    }
    return send(res, 401, { error: 'Jeton manquant, invalide ou passerelle désactivée' });
  }
  if (req.method === 'GET' || req.method === 'DELETE') return send(res, 405);
  if (req.method !== 'POST') return send(res, 405);
  if (!vaultPath) return send(res, 503, { error: 'Aucun coffre ouvert dans 123Ecriture' });

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return send(res, 413);
    chunks.push(chunk as Buffer);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } });
  }

  const deps: McpDeps = {
    load: async () => loadSettings(vaultPath),
    listFiles: () => walkFiles(vaultPath),
    readFile: (relPath) => fs.promises.readFile(resolveInVault(vaultPath, relPath), 'utf-8'),
    log: (entry) => appendJournal(vaultPath, entry),
    client: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 80) : undefined,
  };
  const messages = Array.isArray(payload) ? payload : [payload];
  const replies = (await Promise.all(messages.map((m) => handleMcpMessage(m as object, deps)))).filter(
    (r): r is object => r !== null,
  );
  if (replies.length === 0) return send(res, 202);
  res.setHeader('Mcp-Session-Id', 'local');
  return send(res, 200, Array.isArray(payload) ? replies : replies[0]);
}

let server: http.Server | null = null;
let timer: NodeJS.Timeout | null = null;

function shouldListen(): boolean {
  const { settings } = loadSettings(getActiveVaultPath());
  return settings.enabled && !!settings.tokenHash;
}

function start(): void {
  if (server) return;
  const s = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error('[passerelle IA] requête :', error);
      if (!res.headersSent) send(res, 500, { error: 'Erreur interne' });
    });
  });
  s.on('error', (error) => {
    console.error(`[passerelle IA] écoute impossible sur 127.0.0.1:${AI_GATEWAY_PORT} :`, error);
    if (server === s) server = null;
  });
  s.listen(AI_GATEWAY_PORT, '127.0.0.1', () => console.log(`[passerelle IA] MCP sur http://127.0.0.1:${AI_GATEWAY_PORT}/mcp`));
  server = s;
}

function stop(): void {
  if (!server) return;
  server.close();
  server = null;
}

function refresh(): void {
  try {
    if (shouldListen()) start();
    else stop();
  } catch (error) {
    console.error('[passerelle IA] réglages :', error);
  }
}

export function startAiGatewayWatcher(): void {
  refresh();
  timer = setInterval(refresh, 5000);
}

export function stopAiGateway(): void {
  if (timer) clearInterval(timer);
  timer = null;
  stop();
}
