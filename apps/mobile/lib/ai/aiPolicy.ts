// ✒️ 123ECRITURE — lib/ai/aiPolicy.ts — politique de la passerelle IA (décision unique)
//////////////////////////////////////////////////////////////////////////////
//
// Passerelle IA (v0.4.100) : TOUTE demande d'une IA (serveur MCP local,
// plus tard file distante) passe par `decideAiAction` — une seule
// fonction, testée (aiPolicy.test.ts), qui répond « allow », « ask »
// (demander à l'utilisatrice) ou « deny », avec une raison lisible.
//
// Ordre des règles (le premier refus gagne) :
//   1. passerelle désactivée → refus ;
//   2. chemin invalide (`..`, absolu) ou interne (dossier caché :
//      .123ecriture, .trash, .git…) → refus ;
//   3. élément VERROUILLÉ (lib/ai/aiLock.ts), source OU destination →
//      refus, TOUJOURS, quelles que soient les autorisations ;
//   4. dossiers autorisés renseignés et chemin hors de ces dossiers →
//      refus ;
//   5. autorisation du type d'action : Interdit / Demander / Toujours.
//
// Invariants du fichier :
//   • Module PUR (aucun import React/RN) — partagé renderer / Electron.
//   • Défauts PRUDENTS : passerelle désactivée, lecture et recherche
//     autorisées, toute écriture INTERDITE (lecture seule par défaut).
//   • Le jeton n'est JAMAIS stocké en clair : seulement son SHA-256
//     (les préférences voyagent avec le coffre).
//
//////////////////////////////////////////////////////////////////////////////

import { isAiLocked, normalizeLockPath, normalizeLockedPaths } from './aiLock';

export type AiAction = 'read' | 'search' | 'create' | 'edit' | 'move' | 'delete' | 'template' | 'format';
export type AiPermission = 'deny' | 'ask' | 'allow';
export type AiDecision = { decision: AiPermission; reason: string };

export type AiGatewaySettings = {
  enabled: boolean;
  permissions: Record<AiAction, AiPermission>;
  // Vide = tout le coffre (moins les éléments verrouillés).
  allowedFolders: string[];
  // SHA-256 hexadécimal du jeton (jamais le jeton lui-même).
  tokenHash?: string;
  // 4 derniers caractères, pour reconnaître le jeton affiché ailleurs.
  tokenHint?: string;
  tokenCreatedAt?: string;
};

export const AI_ACTIONS: { id: AiAction; label: string; write: boolean }[] = [
  { id: 'read', label: 'Lire (lister les fichiers, ouvrir une note)', write: false },
  { id: 'search', label: 'Chercher dans le coffre', write: false },
  { id: 'create', label: 'Créer un fichier', write: true },
  { id: 'edit', label: 'Modifier un fichier', write: true },
  { id: 'move', label: 'Renommer / déplacer', write: true },
  { id: 'delete', label: 'Supprimer (vers la corbeille)', write: true },
  { id: 'template', label: 'Appliquer un template', write: true },
  { id: 'format', label: 'Formater un fichier', write: true },
];

export const AI_PERMISSION_LABELS: Record<AiPermission, string> = {
  deny: 'Interdit',
  ask: 'Demander',
  allow: 'Toujours autoriser',
};

export const DEFAULT_AI_GATEWAY: AiGatewaySettings = {
  enabled: false,
  permissions: {
    read: 'allow',
    search: 'allow',
    create: 'deny',
    edit: 'deny',
    move: 'deny',
    delete: 'deny',
    template: 'deny',
    format: 'deny',
  },
  allowedFolders: [],
};

const PERMISSIONS: AiPermission[] = ['deny', 'ask', 'allow'];

// Lecture tolérante du réglage stocké (valeurs inconnues → défaut).
export function normalizeAiGateway(raw: unknown): AiGatewaySettings {
  const r = raw && typeof raw === 'object' ? (raw as Partial<AiGatewaySettings>) : {};
  const permissions = { ...DEFAULT_AI_GATEWAY.permissions };
  if (r.permissions && typeof r.permissions === 'object') {
    for (const { id } of AI_ACTIONS) {
      const v = (r.permissions as Record<string, unknown>)[id];
      if (PERMISSIONS.includes(v as AiPermission)) permissions[id] = v as AiPermission;
    }
  }
  const out: AiGatewaySettings = {
    enabled: r.enabled === true,
    permissions,
    allowedFolders: normalizeLockedPaths(r.allowedFolders),
  };
  if (typeof r.tokenHash === 'string' && /^[0-9a-f]{64}$/.test(r.tokenHash)) {
    out.tokenHash = r.tokenHash;
    if (typeof r.tokenHint === 'string') out.tokenHint = r.tokenHint.slice(-4);
    if (typeof r.tokenCreatedAt === 'string') out.tokenCreatedAt = r.tokenCreatedAt;
  }
  return out;
}

function isInvalidOrInternal(path: string): boolean {
  if (/^([a-z]:|\/|\\)/i.test(path.trim())) return true;
  const segments = normalizeLockPath(path).split('/');
  return segments.some((s) => s === '..' || s === '.' || s.startsWith('.'));
}

function insideAllowed(path: string, allowedFolders: readonly string[]): boolean {
  if (allowedFolders.length === 0) return true;
  // Même règle d'inclusion (héritage, casse) que le verrouillage.
  return isAiLocked(path, allowedFolders);
}

export type AiRequest = {
  action: AiAction;
  // Chemin relatif au coffre ; '' = racine (liste / recherche globale :
  // chaque résultat doit ENSUITE passer par isVisibleToAi).
  path: string;
  // Destination d'un renommage / déplacement.
  destPath?: string;
};

export function decideAiAction(
  settings: AiGatewaySettings,
  lockedPaths: readonly string[],
  request: AiRequest,
): AiDecision {
  if (!settings.enabled) return { decision: 'deny', reason: 'Passerelle IA désactivée.' };
  const paths = [request.path, ...(request.destPath !== undefined ? [request.destPath] : [])];
  for (const raw of paths) {
    const p = normalizeLockPath(raw);
    const isRoot = p === '' && raw === request.path && (request.action === 'read' || request.action === 'search');
    if (isRoot) continue;
    if (!p || isInvalidOrInternal(raw)) return { decision: 'deny', reason: `Chemin refusé : « ${raw} ».` };
    if (isAiLocked(p, lockedPaths)) return { decision: 'deny', reason: `« ${p} » est verrouillé pour l’IA.` };
    if (!insideAllowed(p, settings.allowedFolders)) {
      return { decision: 'deny', reason: `« ${p} » est hors des dossiers autorisés.` };
    }
  }
  const permission = settings.permissions[request.action] ?? 'deny';
  const label = AI_ACTIONS.find((a) => a.id === request.action)?.label ?? request.action;
  if (permission === 'deny') return { decision: 'deny', reason: `Action interdite : ${label}.` };
  if (permission === 'ask') return { decision: 'ask', reason: `Confirmation requise : ${label}.` };
  return { decision: 'allow', reason: 'Autorisé.' };
}

// Filtre d'un résultat de liste/recherche : visible si la LECTURE de ce
// chemin précis serait autorisée sans confirmation.
export function isVisibleToAi(settings: AiGatewaySettings, lockedPaths: readonly string[], path: string): boolean {
  return decideAiAction(settings, lockedPaths, { action: 'read', path }).decision === 'allow' && path !== '';
}

//////// Jeton ////////////////////////////////////////////////////////////////

// 32 octets aléatoires CRYPTOGRAPHIQUES en base64url (préfixe lisible).
// null si l'environnement n'a pas de générateur sûr (jamais de repli
// Math.random pour un secret).
export function generateAiToken(): string | null {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (!c || typeof c.getRandomValues !== 'function') return null;
  const bytes = new Uint8Array(32);
  c.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `ecr_${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

// Comparaison en temps constant de deux empreintes hexadécimales.
export function sameTokenHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

//////// Journal //////////////////////////////////////////////////////////////

// Fichier LOCAL (dossier caché, jamais synchronisé) : ce que l'IA a
// demandé sur CET appareil et la décision prise.
export const AI_JOURNAL_PATH = '.123ecriture/ai-journal.json';
export const AI_JOURNAL_MAX = 500;

export type AiJournalEntry = {
  at: string;
  action: AiAction | 'auth';
  path: string;
  decision: AiPermission;
  reason: string;
  client?: string;
};

export function parseAiJournal(text: string | null | undefined): AiJournalEntry[] {
  if (!text) return [];
  try {
    const data = JSON.parse(text) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is AiJournalEntry =>
        !!e && typeof e === 'object' && typeof e.at === 'string' && typeof e.action === 'string' && typeof e.decision === 'string',
    );
  } catch {
    return [];
  }
}

// Plus récent EN PREMIER, borné à AI_JOURNAL_MAX entrées.
export function appendAiJournal(entries: readonly AiJournalEntry[], entry: AiJournalEntry): AiJournalEntry[] {
  return [entry, ...entries].slice(0, AI_JOURNAL_MAX);
}
