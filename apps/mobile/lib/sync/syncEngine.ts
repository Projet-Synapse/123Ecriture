
import { planSync, type SyncPlan } from './threeWay';
import type { SyncDecision } from './diff';
import { isSyncAllowed, isVaultSyncEnabled, loadSyncSettings, saveSyncSettings } from './syncSettings';
import { isHashableRelPath } from './syncRules';
import { holdDeletionsUntilIndexed, migrateSyncStateFiles, SYNC_STATE_VERSION } from './stateMigration';
import { EMPTY_SHA256, folderToMarker, isFolderMarker, markerToFolder } from './folderMarker';
import { splitEditHot, quietRetryAt } from './editQuiet';
import { errorMessage } from '../errorMessage';
import { APP_SCHEMA, VAULT_FILES_TABLE } from './supabaseClient';
import {
  fetchRemoteFiles,
  downloadRemoteText,
  pushFile,
  tombstoneRemoteFile,
  pullFile,
  isBinaryAttachmentRelPath,
  loadVerifiedSyncBase,
  saveSyncBase,
 heartbeatDevice, fetchMyDeviceLock, pushFolderMarkers, runPool, restoreRemoteFile } from './cloud';
import { isVersionConflictError } from './versionLock';
import { requireBridges } from './bridges';

import { type SyncSummary } from './syncTypes';
import { isTrashRelPath, selectRemoteRows } from './relPath';
import {
  loadPendingReview,
  savePendingReview,
  reconcileRemoteDeletions,
  sameRemoteDeletions,
  type PendingReview,
} from './pendingReview';
import { collectRemoteDeletionCandidates, shouldTripBreaker } from './safetyNet';
import { pickActiveRemoteVault } from './activeVault';
import {
  capJournalEntries,
  makeJournalEntry,
  type SyncJournal,
  type SyncJournalEntry,
} from './journal';
import { tryThreeWayMerge } from './merge';
import { configConflictBackupPath, isStructuredConfigFile, newerSide, planConfigResolution, type Side } from './configMerge';
import { processDeviceCommands } from './deviceGateway';
import { FILE_OP_TIMEOUT_MS, STEP_TIMEOUT_MS, setSyncProgress, withTimeout } from './syncProgress';

// Cycle moteur EN COURS (module) : un cycle révoqué par le watchdog de l'UI
// continue en arrière-plan — on n'en lance jamais un second par-dessus.
let engineCycleRunning = false;
// Heartbeat + passerelle PENDANT le cycle (toutes les N secondes) : un long
// premier pull reste visible (« vu à … ») et pilotable (dump-diagnostics).
const CYCLE_TICK_MS = 30_000;
// Journal de progression écrit AU FIL DU CYCLE (pas seulement à la fin).
const PROGRESS_JOURNAL_EVERY = 20;
const PROGRESS_JOURNAL_MIN_MS = 30_000;
// Fichiers envoyés/reçus en parallèle (réseau + SAF : borne prudente).
const FILE_PARALLEL = 4;
// Le compte de lignes backslashed signalé au cycle précédent : le signal
// « N lignes ignorées » ne se répète que si le nombre change.
let lastBackslashReport = -1;
// Liste des pièces jointes synchronisées (source unique : nativeVaultAdapter).
// randomUUID portable — crypto.randomUUID n'existe pas sous Hermes natif
// (le helper web tombe sur Math.random), voir lib/storage/webUuid.ts.

// ✒️ 123ECRITURE — lib/sync/syncEngine.ts — le moteur du cycle de synchronisation
//////////////////////////////////////////////////////////////////////////////
//
// Un cycle (runSync) déroule toujours la même séquence : résoudre ENSEMBLE
// le coffre local actif et sa ligne distante, passer les gardes d'entrée
// (verrou à distance, verrou anti-bascule), hacher le coffre
// via le pont, paginer les lignes distantes, propager les suppressions,
// calculer le diff à trois voix (local / distant / état du dernier cycle),
// appliquer les décisions (push, pull, fusion de conflit), puis réécrire
// l'état, tenir le journal progressif et battre le cœur des appareils. Ce
// fichier est un orchestrateur VOLONTAIREMENT fin : toute la logique de
// décision qui mérite des tests vit dans les modules voisins — diff.ts
// (verrouillé par diff.test.ts), deletions.ts, merge.ts, editQuiet.ts
// (verrouillé par editQuiet.test.ts).
//
// Invariants du fichier :
//   • Un seul coffre à la fois : dossier local et référence distante sont
//     résolus ensemble en début de cycle, et aucune bascule de coffre n'est
//     possible pendant le cycle (verrou anti-bascule) — jamais de contenu
//     de A écrit dans le coffre B.
//   • Tout chemin qui franchit la frontière cloud est normalisé en slashes
//     POSIX : un backslash crée des doublons jamais matchés, des
//     tombestones qui ne partent pas et des résurrections en boucle.
//   • Une suppression n'est jamais silencieuse : tombestone seulement après
//     relecture directe du fichier, garde anti-suppression massive en revue
//     manuelle, application distante conservatrice, état timbré par le
//     chemin du coffre qu'il décrit.
//   • Un fichier « chaud » (modifié il y a moins de 60 s) sort du cycle :
//     ni push, ni pull, ni fusion — le conflit est différé.
//   • Journal, bases de fusion, heartbeat : best-effort — jamais une raison
//     de faire échouer un cycle.
//
// SOMMAIRE :
//   1. L'état de synchro et le journal du cycle (persistés dans le coffre)
//   2. La liaison et le catalogue des coffres distants
//   3. Les appareils : heartbeat, verrou à distance
//   4. La lecture du cloud : pagination et téléchargements
//   5. Les pièces jointes binaires (détection, MIME, base64)
//   6. Le push, le pull et les bases de fusion
//   7. Les conflits : archivage du perdant, corbeille, fusion à trois voix
//   8. runSync : résolution du coffre et gardes d'entrée
//   9. runSync : les suppressions (tombestones locales et distantes, revue)
//  10. runSync : diff, application des décisions, nouvel état et clôture
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. L'état de synchro et le journal du cycle ///////////////////////

// dossier du coffre — il suit les déplacements. C'est la référence qui
// distingue « jamais existé ici » (pull autorisé) de « existait et a été
// supprimé ici » (tombestone, jamais de résurrection).
// SYNC-STATE HONNÊTE : l'état est TIMBRÉ par le chemin du coffre qu'il
// décrit (rootPath). Un rootPath différent au chargement (dossier
// reconnecté, migration du socle, changement de coffre) = l'état est jeté
// à vide plutôt que cru — aucune suppression ne peut être propagée sur la
// foi d'un état qui ne décrit pas ce coffre-ci.
const SYNC_STATE_REL_PATH = '.123ecriture/sync-state.json';

type SyncState = {
  files: Record<string, string>;
  // Verrou optimiste : version serveur connue par chemin au dernier cycle.
  // Absent dans les anciens états = version inconnue (comportement prudent).
  versions?: Record<string, number>;
  rootPath?: string | null;
  // Version du format/des migrations (stateMigration.ts) ; absent = 1.
  version?: number;
};

// Hermes (Android) n'expose PAS `AbortSignal.timeout` (méthode statique du
// DOM) : l'appeler fait échouer CHAQUE cycle de synchro sur Android.
// Helper qui renvoie le signal quand il existe, sinon undefined (pas
// d'abandon — le délai d'attente strict reste un chantier pour une
// polyfill dédiée).
async function loadSyncState(): Promise<SyncState> {
  const { vault } = requireBridges();
  try {
    const raw = await vault.readNote(SYNC_STATE_REL_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    // Jette les clés backslashed (résidus du bug de séparateurs desktop) :
    // elles ne matcheront jamais les chemins normalisés et ne doivent pas
    // générer de tombestones fantômes.
    const files: Record<string, string> = {};
    for (const [relPath, hash] of Object.entries(parsed.files ?? {})) {
      if (relPath.includes('\\')) continue;
      // `.trash/` n'est plus synchronisé : ses anciennes références ne
      // doivent pas devenir des « suppressions locales » (tombstones).
      if (isTrashRelPath(relPath)) continue;
      files[relPath] = hash;
    }
    return { files, rootPath: parsed.rootPath ?? null, version: typeof parsed.version === 'number' ? parsed.version : 1 };
  } catch {
    // Absent à la première synchro du coffre — repart à vide.
    return { files: {}, version: SYNC_STATE_VERSION };
  }
}

async function saveSyncState(state: SyncState): Promise<void> {
  const { vault } = requireBridges();
  await vault.writeNote(SYNC_STATE_REL_PATH, JSON.stringify(state));
}

// Journal de synchronisation — voir journal.ts. Même pattern
// read-modify-write que l'état de synchro ; best-effort (une écriture
// ratée ne doit jamais faire échouer un cycle) ; borné par capJournalEntries.
const SYNC_JOURNAL_REL_PATH = '.123ecriture/sync-journal.json';

export async function appendJournalEntries(entries: SyncJournalEntry[]): Promise<void> {
  if (!entries.length) return;
  try {
    const { vault } = requireBridges();
    let existing: SyncJournalEntry[] = [];
    try {
      const raw = await vault.readNote(SYNC_JOURNAL_REL_PATH);
      const parsed = JSON.parse(raw) as Partial<SyncJournal>;
      existing = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      // Journal absent au tout premier cycle.
    }
    const next = capJournalEntries([...existing, ...entries]);
    await vault.writeNote(SYNC_JOURNAL_REL_PATH, JSON.stringify({ entries: next }));
  } catch (error) {
    // Best-effort TOTAL : un journal en échec ne doit jamais faire échouer
    // un cycle de synchro (plateforme sans pont, disque saturé…).
    console.error('[sync] échec d’écriture du journal :', error);
  }
}

// Longueur actuelle du journal — mémorisée AVANT d'écrire le début d'un
// cycle, pour pouvoir le retirer intégralement s'il se termine sans la
// moindre action (les cycles à vide ne laissent rien).
export async function journalLength(): Promise<number> {
  try {
    const { vault } = requireBridges();
    const raw = await vault.readNote(SYNC_JOURNAL_REL_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncJournal>;
    return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
  } catch {
    return 0;
  }
}

// Retire les entrées au-delà de `keepLength` — utilisé pour retirer un
// début de cycle resté orphelin. Best-effort comme appendJournalEntries.
export async function truncateJournalEntries(keepLength: number): Promise<void> {
  try {
    const { vault } = requireBridges();
    const raw = await vault.readNote(SYNC_JOURNAL_REL_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncJournal>;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    await vault.writeNote(SYNC_JOURNAL_REL_PATH, JSON.stringify({ entries: entries.slice(0, keepLength) }));
  } catch (error) {
    console.error('[sync] échec de troncature du journal :', error);
  }
}

export const SYNC_JOURNAL_READ_PATH = SYNC_JOURNAL_REL_PATH;

//////// 7. Les conflits : archivage, corbeille, fusion à trois voix ///////

// Écrit le côté PERDANT d'un conflit AVANT de l'écraser — jamais de perte
// silencieuse. Sous `.123ecriture/conflits/<horodatage>/…` : un dossier
// caché, donc HORS de l'arbre synchronisé. Il FAUT que la copie reste hors
// arbre — un fichier normal du coffre se synchronise comme n'importe quelle
// note, et un appareil en retard le REPOUSSE comme contenu actif après une
// suppression, ressuscitant en boucle des fichiers supprimés. Le contenu
// reste récupérable sur l'appareil qui a tranché le conflit, sans polluer
// le coffre ni la synchro.
async function backupLosingSide(relPath: string, content: string): Promise<void> {
  const { vault } = requireBridges();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRelPath = `.123ecriture/conflits/${timestamp}/${relPath}`;
  await vault.writeNote(backupRelPath, content);
}

// Restaure un fichier depuis la corbeille synchronisée `.trash/` vers son
// chemin d'origine. Le chemin d'origine est lu dans la structure miroir de
// la corbeille (`.trash/A/B.md` → `A/B.md`). Étapes :
// 1) déplacement local (vault.set-path, avec dédoublonnage « 2 », « 3 » si
//    un fichier plus récent occupe déjà la place) ;
// 2) SUPPRESSION de la ligne tombestone distale (hard DELETE, pas un
//    update deleted=false — le trigger anti-résurrection bloque toute
//    réactivation à hash identique, et le filtre du moteur interdit le
//    push des chemins tombestonés : détruire la ligne est le seul chemin
//    propre ; les clients ne font jamais de DELETE, donc la garde garde
//    tout son sens pour eux) ;
// 3) repousse IMMÉDIATE du fichier restauré — sans ça, un autre appareil
//    dont le cycle passe entre le DELETE et notre prochain cycle
//    re-tombestonerait le chemin (il l'a dans son état, plus sur son
//    disque) et la restauration serait mangée.
export async function restoreFromTrash(
  trashRelPath: string,
  remoteVaultId: string,
  ownerId: string,
): Promise<string> {
  const { vault, sync, supabase: client } = requireBridges();
  if (!trashRelPath.startsWith('.trash/')) {
    throw new Error('Ce chemin n’est pas dans la corbeille.');
  }
  // Android cloud : restore_file (tombstone levée côté serveur, verrou optimiste).
  if (vault.cloudSync) return vault.cloudSync.restore(trashRelPath);
  const normalize = (p: string) => p.replace(/\\/g, '/');
  const originalBase = trashRelPath.slice('.trash/'.length);

  // Destination : le chemin d'origine, dédoublonné si réoccupé entre-temps
  // (set-path REFUSE une destination existante — on calcule un suffixe
  // libre depuis l'arborescence plutôt que d'échouer).
  const tree = await vault.listTree();
  const existing = new Set<string>();
  const collect = (nodes: { relPath: string; children?: unknown }[]): void => {
    for (const node of nodes) {
      existing.add(normalize(node.relPath));
      if (Array.isArray(node.children)) collect(node.children as { relPath: string; children?: unknown }[]);
    }
  };
  collect(tree);
  const dot = originalBase.lastIndexOf('.');
  const stem = dot >= 0 ? originalBase.slice(0, dot) : originalBase;
  const ext = dot >= 0 ? originalBase.slice(dot) : '';
  let target = originalBase;
  for (let counter = 2; existing.has(normalize(target)); counter += 1) {
    target = `${stem} ${counter}${ext}`;
  }

  const wasDeduped = normalize(target) !== normalize(originalBase);
  const moved = await vault.setPath(trashRelPath, target);
  // Destination réoccupée (dédoublonnée) : le chemin d'origine est VIVANT
  // — aucune tombestone à détruire (et surtout pas la ligne de l'occupant).
  // Sinon, on détruit la tombestone du chemin d'origine (la ligne .trash,
  // elle, disparaîtra d'elle-même au cycle suivant : absente du disque,
  // présente dans l'état → tombestone automatique).
  let expectedVersion: number | null = null;
  let legacyServer = false;
  if (!wasDeduped) {
    // Verrou optimiste : la pierre tombale est LEVÉE par la RPC
    // restore_file (version+1), jamais détruite. Ligne vivante entre-temps
    // (autre appareil) → refus : on ne pousse rien par-dessus.
    const restoredRow = await restoreRemoteFile(remoteVaultId, moved.relPath);
    if (restoredRow && !restoredRow.ok) {
      await appendJournalEntries([
        makeJournalEntry('conflict', {
          path: moved.relPath,
          detail: 'restauré localement ; une version plus récente existe dans le cloud — rien écrasé, résolu au prochain cycle',
        }),
      ]);
      return moved.relPath;
    }
    if (restoredRow) expectedVersion = restoredRow.currentVersion;
    else legacyServer = true;
  }
  if (!wasDeduped && legacyServer) {
    // Ancien serveur (migration absente) : comportement historique.
    const { error: deleteError } = await client
      .schema(APP_SCHEMA)
      .from(VAULT_FILES_TABLE)
      .delete()
      .eq('vault_id', remoteVaultId)
      .eq('rel_path', moved.relPath);
    if (deleteError) throw deleteError;
  }

  // Repousse immédiate du contenu restauré.
  const localFiles = await sync.hashVaultTree();
  const restored = localFiles.find((note) => note.relPath === moved.relPath);
  if (restored) {
    await pushFile(remoteVaultId, ownerId, restored, [], null, expectedVersion !== null ? { expectedVersion } : undefined);
  }
  await appendJournalEntries([makeJournalEntry('restore', { path: moved.relPath })]);
  return moved.relPath;
}

// Tentative de fusion à trois voix d'un conflit (diff-match-patch, comme
// Obsidian Sync). Retourne le hash RÉEL du fichier FUSIONNÉ re-haché après
// écriture si le conflit est RÉSOLU par fusion : les deux versions sont
// réunies (modifications de parties différentes), écrites localement ET
// poussées — les deux appareils convergent. L'appelant enregistre ce hash
// dans le sync-state : enregistrer autre chose que le hash du fichier
// réellement écrit fait re-détecter au cycle suivant une divergence déjà
// résolue et re-annoncer le conflit, en boucle. Retourne null quand il
// n'y a pas de base de fusion ou que les modifications se chevauchent
// réellement : l'appelant retombe sur le comportement gagnant/perdant
// archivé.
// Contexte d'un conflit : hash de la dernière version synchronisée (pour
// vérifier la base) et côté le plus récent (newerSide, tolérance d'horloge).
type ConflictContext = { expectedBaseHash: string | undefined; newer: Side };

async function attemptConflictMerge(
  remoteVaultId: string,
  ownerId: string,
  relPath: string,
  remoteObjectPath: string | undefined,
  journal: SyncJournalEntry[],
  preferLocal = false,
  onLocalChanged?: () => void,
  ctx: ConflictContext = { expectedBaseHash: undefined, newer: 'remote' },
): Promise<string | null> {
  if (isBinaryAttachmentRelPath(relPath)) return null; // jamais de fusion binaire
  if (isStructuredConfigFile(relPath)) {
    return resolveConfigConflict(remoteVaultId, ownerId, relPath, remoteObjectPath, journal, preferLocal, onLocalChanged, ctx);
  }
  // Base VÉRIFIÉE (hash = sync-state) : une base périmée produirait une
  // fusion fausse (passages réintroduits ou perdus).
  const base = await loadVerifiedSyncBase(relPath, ctx.expectedBaseHash);
  if (base === null) return null;
  let local: string;
  let remote: string;
  try {
    const { vault } = requireBridges();
    local = await vault.readNote(relPath);
    remote = await downloadRemoteText(remoteVaultId, relPath, remoteObjectPath);
  } catch {
    return null;
  }
  const merged = tryThreeWayMerge(base, local, remote);
  if (merged.kind !== 'merged') return null;
  // Garde JSON : les métadonnées synchronisées sont du JSON
  // (tasks/tasklists/preferences) — une fusion par caractères peut produire
  // du texte inanalysable. Si le résultat ne se parse pas, on retombe sur
  // le comportement gagnant/perdant plutôt que d'écrire un fichier cassé.
  if (relPath.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(merged.text);
    } catch {
      return null;
    }
  }

  const { vault, sync } = requireBridges();
  await vault.writeNote(relPath, merged.text);
  const tree = await sync.hashVaultTree();
  const note = tree.find((n) => n.relPath === relPath);
  if (!note) return null;
  await pushFile(remoteVaultId, ownerId, note, journal);
  journal.push(
    makeJournalEntry('conflict', {
      path: relPath,
      detail: 'fusion automatique des deux versions (diff-match-patch)',
    }),
  );
  return note.contentHash;
}

// Conflit sur un fichier de CONFIGURATION JSON (tasks/tasklists/
// preferences) : fusion STRUCTURÉE (configMerge.ts), jamais
// diff-match-patch. Retourne TOUJOURS le hash du fichier local final (le
// conflit est résolu ici, pas de repli gagnant/perdant). Le résultat
// fusionné devient la nouvelle base (pushFile/pullFile/saveSyncBase) :
// une suppression ne revient pas au conflit suivant. Sans base ou avec un
// côté illisible : le cloud gagne (sauf priorité « local » explicite du
// dialogue de fusion) et la version perdante est gardée LOCALEMENT en
// `.123ecriture/<nom>.conflict-<horodatage>.json` (jamais synchronisé).
async function resolveConfigConflict(
  remoteVaultId: string,
  ownerId: string,
  relPath: string,
  remoteObjectPath: string | undefined,
  journal: SyncJournalEntry[],
  preferLocal: boolean,
  onLocalChanged: (() => void) | undefined,
  ctx: ConflictContext,
): Promise<string | null> {
  const { vault, sync } = requireBridges();
  const local = await vault.readNote(relPath);
  const remote = await downloadRemoteText(remoteVaultId, relPath, remoteObjectPath);
  // Base VÉRIFIÉE : hash du texte = hash du sync-state, sinon « pas de base ».
  const base = await loadVerifiedSyncBase(relPath, ctx.expectedBaseHash);
  const rehash = async () => {
    const tree = await sync.hashVaultTree();
    return tree.find((n) => n.relPath === relPath) ?? null;
  };
  // Priorité « local » du dialogue de fusion = le local est réputé le plus récent.
  const newer: Side = preferLocal ? 'local' : ctx.newer;
  // Plan PUR (configMerge.planConfigResolution, testé) puis exécution.
  const plan = planConfigResolution(base, local, remote, newer);
  if (plan.backupLocal) await vault.writeNote(configConflictBackupPath(relPath), local);
  if (plan.backupCloud) await vault.writeNote(configConflictBackupPath(relPath, new Date(), 'cloud'), remote);
  if (plan.pull) {
    await withTimeout(pullFile(remoteVaultId, relPath, remoteObjectPath), FILE_OP_TIMEOUT_MS, `réception ${relPath}`);
    onLocalChanged?.();
  } else if (plan.final !== local) {
    await vault.writeNote(relPath, plan.final);
    onLocalChanged?.();
  }
  const note = await rehash();
  if (!note) return null;
  if (plan.push) {
    // Résultat ≠ cloud : TOUJOURS envoyé (pushFile enregistre aussi la base).
    await withTimeout(pushFile(remoteVaultId, ownerId, note, journal, remote), FILE_OP_TIMEOUT_MS, `envoi ${relPath}`);
  } else if (!plan.pull) {
    // Le cloud porte déjà le résultat : base = résultat (même texte que le
    // fichier local re-haché → hash cohérent au cycle suivant).
    await saveSyncBase(relPath, plan.final);
  }
  const qui = plan.newer === 'local' ? 'cet appareil' : 'le cloud';
  const detail =
    plan.reason === 'merged'
      ? `fusion structurée de la configuration (par identifiant / par clé ; valeur en conflit : la plus récente gagne — ${qui})${plan.push ? ', envoyée' : ''}`
      : `configuration ${plan.reason === 'no-base' ? 'sans base de fusion fiable' : 'illisible'} : version la plus récente conservée (${qui})${plan.push ? ' et envoyée' : ''}, l'autre sauvegardée (.conflict)`;
  journal.push(makeJournalEntry('conflict', { path: relPath, detail }));
  return note.contentHash;
}

//////// 8. runSync : résolution du coffre et gardes d'entrée //////////////

// Horodatage de la dernière annonce « connexion » (anti-spam : une seule
// annonce par session, ou après ≥5 min sans cycle).
let lastConnexionAnnouncedAt = 0;

// Lance une synchro complète (push + pull + résolution de conflit) pour le
// coffre ACTIF. `trigger` alimente le journal : d'où vient ce cycle
// (« manuel », « automatique (60 s) », « surveillance du dossier »,
// « retour à l'app », « démarrage »).
//
// COHÉRENCE STRUCTURELLE : l'identifiant du coffre distant est DÉDUIT ICI
// du coffre actif via le pont (getActive + registre), exactement comme le
// dossier haché et toutes les opérations fichiers (elles opèrent par
// construction sur le coffre actif) — jamais un paramètre venu du renderer.
// Sans cela, une bascule de coffre immédiatement suivie d'une synchro croise
// « distant du coffre A » avec « dossier du coffre B » : le moteur peut au
// pire synchroniser l'ANCIEN coffre actif un cycle de trop, jamais deux
// coffres entremêlés.
export async function runSync(ownerId: string, trigger = 'automatique'): Promise<SyncSummary> {
  const summary: SyncSummary = { pushed: 0, pulled: 0, deleted: 0, trashed: 0, modifications: 0, conflicts: 0, errors: [] };
  let bridges;
  try {
    bridges = requireBridges();
  } catch (error) {
    summary.errors.push(errorMessage(error));
    return summary;
  }

  // Résolution cohérente du coffre ACTIF (dossier ET distant ensemble).
  const [activeId, vaultEntries] = await Promise.all([
    bridges.vaults.getActive(),
    bridges.vaults.list(),
  ]);
  const activeEntry = pickActiveRemoteVault(vaultEntries, activeId);
  if (!activeEntry || !activeEntry.remoteVaultId) {
    await appendJournalEntries([
      makeJournalEntry('info', { detail: 'cycle ignoré : le coffre actif n’est pas lié au cloud' }),
    ]);
    return summary;
  }
  const remoteVaultId = activeEntry.remoteVaultId;

  // PARAMÈTRES DE SYNCHRONISATION (syncSettings.ts) : sync globale ou de ce
  // coffre désactivée → cycle ignoré SANS erreur (l'app reste 100 % locale).
  const syncSettings = loadSyncSettings();
  if (!isVaultSyncEnabled(syncSettings, remoteVaultId) || syncSettings.pausedAfterUpdate) {
    return summary;
  }
  // Wi-Fi uniquement : sur réseau mobile, cycle ignoré (aucune erreur).
  const connection = (globalThis as { navigator?: { connection?: { type?: string } } }).navigator?.connection;
  if (syncSettings.wifiOnly && connection?.type === 'cellular') {
    return summary;
  }

  // GARDE « AUCUN COFFRE LOCAL ACTIF » : sans coffre LOCAL actif et
  // résolvable, il n'y a rien à afficher ni où écrire — le cycle est refusé
  // avec un message qui dit quoi faire, au lieu d'une rafale de pulls en
  // échec.
  try {
    const activeLocalPath = await bridges.vault.getCurrentPath?.();
    if (!activeLocalPath) {
      const message = "Cycle ignoré : aucun coffre local actif sur cet appareil — choisis d'abord un dossier (Paramètres → Coffres).";
      summary.errors.push(message);
      try {
        await appendJournalEntries([makeJournalEntry('info', { detail: message })]);
      } catch {
        // Pas de coffre pour écrire le journal : le message reste dans le résumé.
      }
      console.error('[sync]', message);
      return summary;
    }
  } catch {
    // Pont sans getCurrentPath (vieux pont) : on laisse passer le cycle.
  }

  // DISJONCTEUR DE SYNCHRO : si le cycle PRÉCÉDENT s'est terminé en rafale
  // d'erreurs, « Synchroniser » est REFUSÉ d'office — on ne resynchronise
  // jamais par-dessus un appareil en échec. La levée est manuelle (revue,
  // ou opérateur via le fichier).
  // File illisible : signalée (erreur du cycle + journal), jamais écrasée ;
  // le cycle continue sans disjoncteur connu — aucune suppression distante
  // ne sera appliquée de toute façon (section 2).
  let pendingReview: { syncBlocked?: { at: string; errorCount: number; samples: string[] } } = {};
  try {
    pendingReview = await loadPendingReview(bridges.vault);
  } catch (error) {
    console.error('[sync] file de revue illisible :', error);
    summary.errors.push(errorMessage(error));
    try {
      await appendJournalEntries([makeJournalEntry('error', { detail: errorMessage(error) })]);
    } catch (journalError) {
      console.error('[sync] journal indisponible :', journalError);
    }
  }
  if (pendingReview.syncBlocked) {
    const blocked = pendingReview.syncBlocked;
    const message = `Synchronisation BLOQUÉE par le disjoncteur : ${blocked.errorCount} erreur(s) au dernier cycle (${blocked.at}). Exemple : « ${blocked.samples[0] ?? '…'} ». Validez ou corrigez depuis Paramètres → Journal de synchronisation avant de resynchroniser.`;
    summary.errors.push(message);
    // Log visible dans logcat release (console.error) : message + origine,
    // pour diagnostic à distance sans devinettes.
    console.error('[sync] disjoncteur ouvert :', message);
    try {
      await appendJournalEntries([makeJournalEntry('error', { detail: message })]);
    } catch {
      // Le journal ne doit pas masquer le refus.
    }
    return summary;
  }

  // VERROU À DISTANCE : si CET appareil a été verrouillé (carte
  // « Appareils connectés » d'un autre appareil, ou SQL/API d'urgence),
  // AUCUN cycle cloud ne s'exécute ici — le coffre local continue hors
  // ligne, zéro perte, tant que le verrou n'est pas levé.
  const myLock = await fetchMyDeviceLock(remoteVaultId);
  if (myLock.locked) {
    const message = `Cycle ignoré : cet appareil est VERROUILLÉ à distance${myLock.reason ? ` — motif : ${myLock.reason}` : ''}.`;
    summary.errors.push(message);
    try {
      await appendJournalEntries([makeJournalEntry('info', { detail: message })]);
    } catch {
      // Le journal ne doit pas masquer le message du verrou.
    }
    return summary;
  }

  // Verrou ANTI-BASCULE : le bucket distant est capturé ICI, mais chaque
  // opération locale (hachage, lecture, écriture, suppression) relit le
  // coffre ACTIF au moment de son IPC. Si le coffre actif change pendant le
  // cycle, le contenu de A part dans le bucket de B et le cloud de A
  // s'écrit sur le disque de B. Pendant le cycle, `vaults:switch` est donc
  // REFUSÉ par le main process (TTL de 10 min : un crash du renderer ne
  // bloque pas l'app pour toujours).
  if (engineCycleRunning) {
    const message = 'Cycle ignoré : le cycle précédent est encore en cours sur cet appareil.';
    summary.errors.push(message);
    console.error('[sync]', message);
    return summary;
  }
  engineCycleRunning = true;
  // VERROU LIBÉRÉ DANS UN FINALLY : une exception ou un délai dépassé ne
  // laisse plus jamais le coffre verrouillé ni le moteur « occupé ».
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await withTimeout(heartbeatDevice(remoteVaultId, ownerId), 20_000, 'heartbeat');
      await withTimeout(processDeviceCommands(remoteVaultId, ownerId), 120_000, 'commandes appareil');
    } catch (error) {
      console.warn('[sync] tick de cycle :', errorMessage(error));
    } finally {
      ticking = false;
    }
  };
  void tick();
  const ticker = setInterval(() => void tick(), CYCLE_TICK_MS);
  try {
    // ANDROID 100 % CLOUD : pas de diff disque ↔ cloud — on rejoue la file
    // d'opérations du cache (verrou optimiste côté serveur) puis on relit
    // le catalogue distant. Aucune suppression distante ne naît d'ici.
    if (bridges.vault.cloudSync) {
      return await runCloudCycle(bridges.vault.cloudSync, ownerId, remoteVaultId, summary, trigger);
    }
    await bridges.sync.setVaultLock?.(true);
    return await runLockedCycle(bridges, ownerId, remoteVaultId, summary, syncSettings);
  } finally {
    clearInterval(ticker);
    setSyncProgress(null);
    engineCycleRunning = false;
    try {
      await bridges.sync.setVaultLock?.(false);
    } catch (error) {
      console.error('[sync] libération du verrou de coffre :', errorMessage(error));
    }
  }
}

async function runCloudCycle(
  cloudSync: NonNullable<VaultBridge['cloudSync']>,
  ownerId: string,
  remoteVaultId: string,
  summary: SyncSummary,
  trigger: string,
): Promise<SyncSummary> {
  const result = await withTimeout(cloudSync.flush(), 10 * 60_000, 'synchronisation cloud');
  summary.pushed = result.pushed;
  summary.deleted = result.deleted;
  summary.conflicts = result.conflicts;
  summary.errors.push(...result.errors);
  if (result.offline) summary.errors.push(`Hors ligne : ${result.pending} modification(s) en attente, envoyées au retour du réseau.`);
  try {
    await appendJournalEntries([
      makeJournalEntry(result.errors.length ? 'error' : 'info', {
        detail: `cycle cloud (${trigger}) : ${result.pushed} envoyé(s), ${result.deleted} en corbeille, ${result.restored} restauré(s), ${result.conflicts} conflit(s), ${result.pending} en attente${result.offline ? ' — hors ligne' : ''}`,
      }),
    ]);
  } catch {
    // journal best-effort
  }
  if (!result.offline) {
    await withTimeout(heartbeatDevice(remoteVaultId, ownerId, summary), 30_000, 'heartbeat de fin').catch(() => undefined);
    await withTimeout(processDeviceCommands(remoteVaultId, ownerId), 120_000, 'commandes appareil').catch(() => undefined);
    try {
      const { publishDeviceInventory } = await import('./deviceInventory');
      await publishDeviceInventory(remoteVaultId, await cloudSync.inventory());
    } catch (error) {
      console.warn('[sync] inventaire du cache :', errorMessage(error));
    }
  }
  return summary;
}

async function runLockedCycle(
  bridges: ReturnType<typeof requireBridges>,
  ownerId: string,
  remoteVaultId: string,
  summary: SyncSummary,
  syncSettings: ReturnType<typeof loadSyncSettings>,
): Promise<SyncSummary> {

  // Le journal PROGRESSIF raconte le cycle comme Obsidian Sync (« connexion
  // au serveur », « upload en cours », « upload terminé ») : la connexion
  // s'écrit immédiatement, les étapes au fil de l'eau. SI le cycle ne
  // produit AUCUNE action (aucun changement), il est RETIRÉ du journal à la
  // fin : un cycle à vide ne laisse rien (pas de spam de « 0 envoyée(s) » à
  // chaque minute).
  // ANTI-SPAM : « connexion » n'est annoncé qu'à la VRAIE reprise
  // (démarrage de l'app, reconnexion après ≥5 min sans cycle) — les cycles
  // de surveillance d'un même run ne ré-annoncent pas la connexion à
  // chaque fois.
  const journal: SyncJournalEntry[] = [];
  if (Date.now() - lastConnexionAnnouncedAt > 5 * 60_000) {
    journal.push(makeJournalEntry('connexion'));
    lastConnexionAnnouncedAt = Date.now();
  }
  const journalStartLength = await journalLength();
  await appendJournalEntries(journal);

  setSyncProgress({ phase: 'Lecture de la liste distante…', done: 0, total: 0 });
  const [remoteFiles, syncState] = await withTimeout(
    Promise.all([fetchRemoteFiles(remoteVaultId), loadSyncState()]),
    STEP_TIMEOUT_MS,
    'liste distante',
  );

  // SYNC-STATE HONNÊTE : l'état ne vaut que pour LE dossier qu'il décrit.
  // Un rootPath différent (dossier reconnecté, migration du socle,
  // changement de coffre) = l'état est JETÉ à vide : aucune suppression ne
  // sera propagée avant qu'un premier cycle complet ait reconstruit la
  // vérité depuis le disque et le cloud — sinon le moteur « sait » des
  // choses fausses.
  const vaultRootPath = (await bridges.vault.getCurrentPath?.()) ?? null;
  if (syncState.rootPath && syncState.rootPath !== vaultRootPath) {
    syncState.files = {};
    journal.push(
      makeJournalEntry('info', {
        detail: `État de synchro d'un autre dossier ignoré (${syncState.rootPath}) — reconstruit à vide pour ${vaultRootPath ?? 'coffre inconnu'}.`,
      }),
    );
  }
  syncState.rootPath = vaultRootPath;
  // Défense en profondeur : les relPaths locaux sont ramenés en slashes
  // POSIX quel que soit le pont — un relPath backslashed crée des doublons
  // cloud jamais matchés, des tombestones jamais envoyées et des
  // résurrections en boucle (le fix à la source vit dans sync.ts).
  setSyncProgress({ phase: 'Analyse du coffre local…', done: 0, total: 0 });
  const localFiles = (await withTimeout(bridges.sync.hashVaultTree(), STEP_TIMEOUT_MS, 'analyse du coffre local')).map((note) => ({
    ...note,
    relPath: note.relPath.split('\\').join('/'),
  }));
  // PÉRIODE DE SILENCE « FICHIER OUVERT » : un fichier modifié il y a moins
  // de 60 s est peut-être OUVERT dans un éditeur (l'app, Obsidian…) — il
  // sort du cycle : pas de push, pas d'écrasement par le pull, pas
  // d'archivage en conflit. Le cycle suivant, une fois le fichier
  // silencieux (quitté, frappe arrêtée), le synchronise normalement —
  // sinon, conflit à chaque frappe pendant l'écriture.
  const { cold: localFilesCold, hotPaths } = splitEditHot(localFiles, Date.now());
  if (hotPaths.size > 0) {
    summary.retryAfterMs = quietRetryAt(localFiles, hotPaths);
    journal.push(
      makeJournalEntry('info', {
        detail: `${hotPaths.size} fichier(s) en cours d'édition — synchronisation différée (silence de 60 s requis) : ${[...hotPaths].slice(0, 2).join(' | ').slice(0, 140)}`,
      }),
    );
  }
  const localByPath = new Map(localFilesCold.map((note) => [note.relPath, note]));
  // DOSSIERS DE PREMIÈRE CLASSE (folderMarker.ts) : chaque dossier local
  // est représenté par son marqueur ; le cloud en garde une ligne vide.
  let localFolders: string[] = [];
  // Liste FIABLE des dossiers locaux ? Sinon (pont sans listFolders, échec
  // de lecture) les marqueurs sortent ENTIÈREMENT du plan : une liste
  // absente n'est jamais « aucun dossier » (sinon tombstone de tous les
  // dossiers reçus au cycle précédent).
  let foldersKnown = false;
  if (syncSettings.emptyFolders && bridges.sync.listFolders) {
    try {
      localFolders = (await bridges.sync.listFolders()).map((f: string) => f.split('\\').join('/'));
      foldersKnown = true;
    } catch (error) {
      console.warn('[sync] liste des dossiers :', errorMessage(error));
      journal.push(makeJournalEntry('info', { detail: `Dossiers locaux illisibles ce cycle — dossiers non synchronisés : ${errorMessage(error).slice(0, 120)}` }));
    }
  }
  const localFolderSet = new Set(localFolders);
  // PREMIER PARCOURS COMPLET réussi ? Sinon (index partiel) : aucune
  // suppression propagée ce cycle, et la migration v2 attend.
  const fullyIndexed = bridges.sync.isFullyIndexed ? bridges.sync.isFullyIndexed() : true;
  let stateVersion = syncState.version ?? 1;
  if (stateVersion < SYNC_STATE_VERSION && foldersKnown && fullyIndexed) {
    const migrated = migrateSyncStateFiles(
      syncState.files,
      stateVersion,
      new Set(localFolders.map((f) => folderToMarker(f))),
    );
    syncState.files = migrated.files;
    stateVersion = SYNC_STATE_VERSION;
    if (migrated.dropped.length > 0) {
      journal.push(
        makeJournalEntry('info', {
          detail: `Migration de l'état : ${migrated.dropped.length} dossier(s) du cloud absent(s) ici seront recréés (jamais supprimés du cloud).`,
        }),
      );
    }
  }

//////// 9. runSync : les suppressions — tombestones et revue //////////////

  // ---- SUPPRESSIONS -----------------------------------------------------
  // ORDRE CRITIQUE : une ligne deleted=true (ou qu'on vient de tombestoner)
  // est INTERDITE de pull ET de push pour tout le cycle — sinon le diff,
  // calculé sur une liste distante périmée, retélécharge le fichier qu'on
  // vient de déclarer mort, puis le repousse (upsert deleted:false), le
  // ressuscitant à jamais.
  // 1bis) LIGNES RÉSIDUELLES BACKSLASHED : aucune purge automatique. Ces
  // lignes impossibles (résidus du bug de séparateurs) sont simplement
  // IGNORÉES : hors du diff, hors des décisions, hors du comptage — elles
  // ne peuvent plus rien casser. Leur nettoyage est un geste MANUEL
  // (revue/SQL), signalé une seule fois quand leur nombre change.
  const backslashedRows = remoteFiles.filter((file) => (file.rawRelPath ?? '').includes('\\'));
  if (backslashedRows.length > 0 && backslashedRows.length !== lastBackslashReport) {
    lastBackslashReport = backslashedRows.length;
    const { legacy, shadowed } = selectRemoteRows(backslashedRows.concat(remoteFiles.filter((f) => !(f.rawRelPath ?? '').includes('\\'))));
    journal.push(
      makeJournalEntry('info', {
        detail: `${backslashedRows.length} ligne(s) à backslash dans le cloud (chemins Windows hérités) : ${legacy.length} lue(s) sous leur chemin POSIX, ${shadowed.length} masquée(s) par une jumelle — migration : scripts/migrate-backslash-relpaths.mjs`,
      }),
    );
  }
  // 1ter) SÉLECTION DES LIGNES (relPath.ts) : `.trash/` jamais synchronisé ;
  // une ligne héritée à backslash SANS jumelle POSIX est lue sous son chemin
  // normalisé (sinon tout un coffre poussé depuis Windows reste invisible
  // sur Android) ; avec jumelle, elle est masquée. Aucune réécriture des
  // données ici (script de migration dédié : scripts/migrate-backslash-relpaths.mjs).
  const selected = selectRemoteRows(remoteFiles);
  // Ligne héritée lue sous son chemin POSIX : sa version (verrou optimiste)
  // est celle de la ligne BRUTE — la réutiliser pour pousser le chemin POSIX
  // échouerait à chaque cycle. Sans version : le push crée la ligne POSIX
  // (qui masquera ensuite l'héritée), la tombstone vise la clé brute.
  const visibleRemoteFiles = selected.rows.map((file) =>
    (file.rawRelPath ?? '').includes('\\') ? { ...file, version: undefined } : file,
  );
  const activeRemoteFiles = visibleRemoteFiles.filter((file) => !file.deleted);
  const remoteByPath = new Map(activeRemoteFiles.map((file) => [file.relPath, file]));
  const tombstonedPaths = new Set(
    visibleRemoteFiles.filter((file) => file.deleted).map((file) => file.relPath),
  );

  // 1) Supprimés LOCALEMENT depuis le dernier cycle -> tombestones distantes.
  // GARDE ANTI-SUPPRESSION MASSIVE : un appareil dont le contenu local est
  // incomplet (pull partiel, coffre fraîchement reconnecté, permission SAF
  // perdue, panne de disque) déclarerait « supprimés » TOUS les fichiers
  // qu'il n'a pas — et viderait le cloud ET les autres appareils. La liste
  // suspecte part donc en REVUE MANUELLE (pending-review.json dans le
  // coffre) et le cycle se termine sans supprimer ; jamais de confirmation
  // par un simple « relancer une fois ». La levée se fait par une action
  // humaine explicite depuis l'écran de revue.
  // ---- MOTEUR À TROIS ÉTATS (threeWay.ts) ------------------------------
  // L = disque, R = cloud, B = base (sync-state). Une absence ne vaut
  // suppression QUE si le chemin était dans la base. Les fichiers en cours
  // d'édition et les types désactivés sortent entièrement du plan.
  const allow = (relPath: string) =>
    isSyncAllowed(relPath, syncSettings) &&
    // Marqueurs de dossier : JAMAIS soumis à la garde « en cours d'édition »
    // (un dossier ne se « tape » pas) — toujours tirés/poussés.
    (isFolderMarker(relPath) ? foldersKnown : !hotPaths.has(relPath) && isHashableRelPath(relPath));
  // Suppressions CONFIRMÉES depuis l'écran de revue (sinon la confirmation
  // n'a aucun effet : le cycle suivant recalcule la même liste et relève le
  // garde-fou — la demande « revient » toutes les 30 s).
  // Illisible : aucune approbation (= aucune suppression approuvée) ; déjà
  // signalé par la lecture du disjoncteur en début de cycle.
  const reviewBefore: PendingReview = await loadPendingReview(bridges.vault).catch(() => ({}) as PendingReview);
  // Chemins dont l'issue du cycle n'est pas confirmée : leur base
  // précédente est conservée telle quelle (voir nouvel état de référence).
  const keepPreviousRef = new Set<string>();
  const approvedDeletions = new Set(reviewBefore.approvedDeletions?.paths ?? []);
  let plan: SyncPlan = planSync({
    local: [
      ...localFilesCold.map((n) => ({ relPath: n.relPath, hash: n.contentHash, size: n.sizeBytes, mtime: n.modifiedAt })),
      ...localFolders.map((f) => ({ relPath: folderToMarker(f), hash: EMPTY_SHA256, kind: 'folder' as const })),
    ],
    remote: visibleRemoteFiles.map((r) => ({
      relPath: r.relPath,
      hash: r.contentHash,
      updatedAt: r.updatedAt,
      version: r.version ?? null,
      deleted: r.deleted,
      kind: isFolderMarker(r.relPath) ? ('folder' as const) : ('file' as const),
    })),
    base: Object.fromEntries(
      Object.entries(syncState.files).map(([p, h]) => [p, { hash: h, kind: isFolderMarker(p) ? ('folder' as const) : ('file' as const) }]),
    ),
    allow,
    guard: { approved: approvedDeletions },
  });
  {
    // OBSERVABILITÉ DOSSIERS : ce que le plan décide pour les marqueurs.
    const counts: Record<string, number> = {};
    for (const a of plan.actions) if (a.entryKind === 'folder') counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    const remoteMarkers = visibleRemoteFiles.filter((r) => !r.deleted && isFolderMarker(r.relPath)).length;
    journal.push(
      makeJournalEntry('info', {
        detail: `Dossiers : ${localFolders.length} ici, ${remoteMarkers} dans le cloud${foldersKnown ? '' : ' (liste locale indisponible)'} — plan : ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'rien'}`,
      }),
    );
  }
  const heldDeletions = new Set<string>();
  {
    const held = holdDeletionsUntilIndexed(plan, fullyIndexed);
    plan = held.plan;
    for (const p of held.held) heldDeletions.add(p);
    if (held.held.length > 0) {
      journal.push(
        makeJournalEntry('info', {
          detail: `${held.held.length} suppression(s) retenue(s) : premier parcours complet du coffre pas encore réussi.`,
        }),
      );
    }
  }
  const locallyDeleted = plan.actions.filter((x) => x.kind === 'tombstone-remote').map((x) => x.relPath);
  if (plan.guard.suspended) {
    // FUSION (jamais d'écrasement) : les suppressions distantes en revue et
    // les approbations déjà données sont conservées ; liste COMPLÈTE.
    // File illisible : JAMAIS écrasée (PendingReviewUnreadableError) — les
    // suppressions restent suspendues dans tous les cas.
    try {
      const current = await loadPendingReview(bridges.vault);
      await savePendingReview(bridges.vault, {
        ...current,
        suspiciousDeletions: {
          at: new Date().toISOString(),
          count: plan.guard.deletions.length,
          paths: plan.guard.deletions,
        },
      });
    } catch (error) {
      console.error('[sync] revue de suppression massive non persistée :', error);
      summary.errors.push(`revue de suppression massive non enregistrée : ${errorMessage(error)}`);
      journal.push(makeJournalEntry('error', { detail: `revue non enregistrée : ${errorMessage(error)}` }));
    }
    const message = `Garde-fou : ${plan.guard.reason} Les suppressions sont SUSPENDUES (rien n'est effacé, ni ici ni dans le cloud) ; les fichiers manquants sont rapatriés. Valide depuis Paramètres → Journal de synchronisation si c'est volontaire.`;
    // Pas une ERREUR de l'interface : un avertissement du journal.
    journal.push(makeJournalEntry('info', { detail: message }));
  }
  {
    // Garde levé : le plan ne contient plus que les suppressions APPROUVÉES.
    for (const relPath of locallyDeleted) {
      try {
        // REVÉRIFICATION DIRECTE AVANT TOUTE TOMBSTONE : un parcours peut
        // manquer un fichier (édité pendant le scan). Si le fichier RÉPOND
        // à une lecture directe, il existe : le parcours s'est trompé, on
        // ne détruit rien et on le signale — sinon les AUTRES appareils
        // effacent un fichier vivant.
        try {
          if (isFolderMarker(relPath)) throw new Error('introuvable');
          await bridges.vault.readNote(relPath);
          journal.push(
            makeJournalEntry('info', {
              path: relPath,
              detail: 'présent à la relecture directe — tombstone annulée (parcours du cycle non fiable)',
            }),
          );
          keepPreviousRef.add(relPath);
          continue;
        } catch (readError) {
          const brut = readError instanceof Error ? readError.message : String(readError);
          if (!/introuvable|not found|could not be found|ENOENT/i.test(brut)) {
            // Illisible (≠ absent) : conservé ce cycle, retenté au suivant.
            journal.push(
              makeJournalEntry('info', { path: relPath, detail: `lecture en échec — fichier conservé ce cycle : ${brut.slice(0, 120)}` }),
            );
            keepPreviousRef.add(relPath);
            continue;
          }
        }
        if (remoteByPath.has(relPath)) {
          // RPC tombstone_file UNIQUEMENT (verrou optimiste) — clé EXACTE en
          // base : une ligne héritée à backslash est tombstonée sous sa
          // forme brute (sinon elle ressusciterait).
          const row = remoteByPath.get(relPath);
          const result = await tombstoneRemoteFile(remoteVaultId, row?.rawRelPath ?? relPath, row?.version ?? null, null);
          if (!result.ok) {
            journal.push(makeJournalEntry('info', { path: relPath, detail: 'modifié ailleurs entre-temps — suppression annulée' }));
            continue;
          }
        }
        tombstonedPaths.add(relPath);
        summary.deleted += 1;
        journal.push(makeJournalEntry('delete', { path: relPath, detail: 'suppression locale propagée' }));
      } catch (error) {
        console.error(`[sync] échec de la tombestone ${relPath} :`, error);
        summary.errors.push(`${relPath} (suppression) : ${errorMessage(error)}`);
        journal.push(makeJournalEntry('error', { path: relPath, detail: `suppression locale : ${errorMessage(error)}` }));
      }
    }
  }

  // 2) Tombestones distantes — AUCUNE suppression locale automatique
  //    (comme main, #193). Toute pierre tombale venue d'un autre appareil
  //    dont le fichier existe encore ici part en REVUE (pending-review.json
  //    → Paramètres → Journal de synchronisation : Approuver = corbeille
  //    locale, Refuser = restore_file dans le cloud). Pendant l'attente :
  //    ni push (le plan exclut les tombstonedPaths), ni suppression locale,
  //    et la base du dernier cycle est CONSERVÉE (keepPreviousRef).
  //    Index partiel : rien n'est mis en file (le fichier peut exister sans
  //    avoir été vu) — la file est reconstruite au premier parcours complet.
  const tombstoneRows = new Map(
    visibleRemoteFiles.filter((f) => f.deleted && tombstonedPaths.has(f.relPath)).map((f) => [f.relPath, f]),
  );
  const { paths: pendingRemoteDeletionPaths, candidates: remoteDeletionCandidates } = collectRemoteDeletionCandidates({
    tombstones: tombstoneRows,
    local: localByPath,
    base: syncState.files,
    queuedAt: new Date().toISOString(),
  });
  for (const relPath of pendingRemoteDeletionPaths) keepPreviousRef.add(relPath);
  summary.pendingRemoteDeletions = pendingRemoteDeletionPaths.size;

  // Une SEULE lecture/écriture de la file pour ce cycle. Illisible
  // (PendingReviewUnreadableError) : JAMAIS traitée comme vide ni écrasée —
  // erreur du cycle, rien n'est supprimé.
  try {
    const review = await loadPendingReview(bridges.vault);
    let next: PendingReview = review;
    if (fullyIndexed) {
      const { entries, added } = reconcileRemoteDeletions(
        review.remoteDeletions ?? [],
        remoteDeletionCandidates,
        pendingRemoteDeletionPaths,
      );
      if (!sameRemoteDeletions(review.remoteDeletions, entries)) next = { ...next, remoteDeletions: entries };
      for (const entry of added) {
        journal.push(
          makeJournalEntry('delete', {
            path: entry.path,
            detail: `supprimé sur ${entry.deletedByDevice ?? 'un autre appareil'} — EN ATTENTE DE VALIDATION (fichier conservé${entry.modified ? ', modifié ici' : ''})`,
          }),
        );
      }
      if (added.length > 0) {
        console.error(`[sync] ${added.length} suppression(s) distante(s) EN ATTENTE DE VALIDATION (fichiers conservés)`);
      }
    }
    if (approvedDeletions.size > 0) {
      // Approbations (garde-fou des suppressions LOCALES) consommées : on
      // ne garde que celles pas encore propagées (échec ponctuel).
      const stillPending = [...approvedDeletions].filter((p) => !tombstonedPaths.has(p) && !localByPath.has(p));
      next = {
        ...next,
        approvedDeletions: stillPending.length > 0 ? { at: new Date().toISOString(), paths: stillPending } : undefined,
      };
    }
    if (next !== review) await savePendingReview(bridges.vault, next);
  } catch (error) {
    console.error('[sync] file de revue des suppressions distantes :', error);
    summary.errors.push(`suppressions distantes en attente non enregistrées : ${errorMessage(error)}`);
    journal.push(makeJournalEntry('error', { detail: `file de revue : ${errorMessage(error)}` }));
  }

//////// 10. runSync : diff, décisions, nouvel état et clôture //////////////

  // 3) Diff SUR LES ENSEMBLES FILTRÉS : ni les tombestones (jamais de
  //    pull, jamais de push — push les réactiveraient), ni les fichiers
  //    supprimés localement (absents du disque). Le sync-state sert de
  //    RÉFÉRENCE au diff (3 voies) : une modification d'un fichier dont le
  //    cloud porte encore le hash connu est un push, pas un conflit.
  // Décisions de contenu issues du plan à trois états. Les conflits gardent
  // TOUJOURS les deux versions (fusion, sinon copie « (conflit …) »).
  const decisions = plan.actions
    .filter((x) => x.entryKind === 'file' && !tombstonedPaths.has(x.relPath))
    .flatMap((x): SyncDecision[] => {
      if (x.kind === 'push' || x.kind === 'pull') return [{ kind: x.kind, relPath: x.relPath }];
      if (x.kind === 'conflict') {
        const l = localByPath.get(x.relPath);
        const r = remoteByPath.get(x.relPath);
        const remoteTime = r ? new Date(r.updatedAt).getTime() : 0;
        // Premier cycle après la liaison d'un dossier non vide : la
        // priorité choisie dans le dialogue de fusion tranche (la version
        // perdante est TOUJOURS sauvegardée par le gestionnaire de conflit).
        const pref = syncSettings.linkPreference[remoteVaultId];
        if (pref === 'local') return [{ kind: 'conflict-push-wins', relPath: x.relPath }];
        if (pref === 'remote') return [{ kind: 'conflict-pull-wins', relPath: x.relPath }];
        return [{ kind: l && l.modifiedAt >= remoteTime ? 'conflict-push-wins' : 'conflict-pull-wins', relPath: x.relPath }];
      }
      return [{ kind: 'noop' as const, relPath: x.relPath }];
    });
  const pushOptions = new Map(
    plan.actions.filter((x) => x.kind === 'push').map((x) => [x.relPath, { expectedVersion: x.restore ? undefined : (x.expectedVersion ?? null), restore: x.restore }]),
  );
  // DOSSIERS : marqueurs poussés (vides) / dossiers créés localement.
  const folderStates: Record<string, string | null> = {};
  const folderActions = plan.actions.filter((a) => a.entryKind === 'folder');
  // ENVOI GROUPÉ : tous les marqueurs à pousser partent en une (ou quelques)
  // requête(s), sans upload Storage ; progression + journal en direct.
  const folderPushes = folderActions.filter((a) => a.kind === 'push');
  if (folderPushes.length > 0) {
    const label = 'Envoi des dossiers';
    setSyncProgress({ phase: label, done: 0, total: folderPushes.length });
    await appendJournalEntries([
      makeJournalEntry('upload-start', { detail: `${folderPushes.length} dossier(s)` }),
    ]).catch(() => undefined);
    let lastJournalAt = Date.now();
    const results = await withTimeout(
      pushFolderMarkers(
        remoteVaultId,
        ownerId,
        folderPushes.map((x) => ({ relPath: x.relPath, expectedVersion: x.expectedVersion ?? null, restore: x.restore })),
        (done, total) => {
          setSyncProgress({ phase: label, done, total });
          if (Date.now() - lastJournalAt >= PROGRESS_JOURNAL_MIN_MS) {
            lastJournalAt = Date.now();
            void appendJournalEntries([makeJournalEntry('info', { detail: `${label} : ${done}/${total}` })]).catch(() => undefined);
          }
        },
      ),
      STEP_TIMEOUT_MS,
      'envoi des dossiers',
    ).catch((error) => folderPushes.map((x) => ({ relPath: x.relPath, ok: false, error: errorMessage(error) })));
    let sent = 0;
    for (const r of results) {
      if (r.ok) {
        folderStates[r.relPath] = EMPTY_SHA256;
        sent += 1;
      } else {
        summary.errors.push(`${r.relPath} (dossier) : ${r.error ?? 'échec'}`);
        journal.push(makeJournalEntry('error', { path: r.relPath, detail: `dossier : ${r.error ?? 'échec'}` }));
      }
    }
    summary.pushed += sent;
    await appendJournalEntries([
      makeJournalEntry('upload-end', { detail: `${sent}/${folderPushes.length} dossier(s) envoyé(s)` }),
    ]).catch(() => undefined);
  }
  // Parents avant enfants : un dossier reçu dont le parent arrive au même
  // cycle doit trouver ce parent déjà créé.
  const otherFolderActions = folderActions
    .filter((a) => a.kind !== 'push')
    .sort((a, b) => a.relPath.split('/').length - b.relPath.split('/').length);
  const folderPullTotal = otherFolderActions.filter((a) => a.kind === 'pull').length;
  let folderPullDone = 0;
  if (folderPullTotal > 0) setSyncProgress({ phase: 'Réception des dossiers', done: 0, total: folderPullTotal });
  for (const x of otherFolderActions) {
    try {
      if (x.kind === 'pull') {
        folderPullDone += 1;
        setSyncProgress({ phase: 'Réception des dossiers', done: folderPullDone, total: folderPullTotal, current: markerToFolder(x.relPath) });
        const folder = markerToFolder(x.relPath);
        const cut = folder.lastIndexOf('/');
        // Idempotent : createFolder choisit un nom libre (« X 2 ») si le
        // dossier existe déjà. Échec = PAS de base (sinon le cycle suivant
        // le croit supprimé ici et le tombstone dans le cloud).
        if (!localFolderSet.has(folder)) {
          if (!bridges.vault.createFolder) throw new Error('création de dossier indisponible');
          const created = await bridges.vault.createFolder(folder.slice(cut + 1), cut >= 0 ? folder.slice(0, cut) : undefined);
          if (created && created.relPath !== folder) throw new Error(`créé sous un autre nom : ${created.relPath}`);
          localFolderSet.add(folder);
        }
        folderStates[x.relPath] = EMPTY_SHA256;
        journal.push(makeJournalEntry('modification-reçue', { path: folder, detail: 'dossier reçu' }));
      } else if (x.kind === 'noop') {
        folderStates[x.relPath] = EMPTY_SHA256;
      } else if (x.kind === 'delete-local') {
        // Dossier supprimé ailleurs : retiré ici SEULEMENT s'il est vide.
        const folder = markerToFolder(x.relPath);
        const prefix = `${folder}/`;
        const hasContent = localFilesCold.some((n) => n.relPath.startsWith(prefix)) || localFolders.some((f) => f.startsWith(prefix));
        if (!hasContent) await bridges.vault.delete(folder, { silent: true }).catch(() => undefined);
        folderStates[x.relPath] = null;
      } else if (x.kind === 'drop-base' || x.kind === 'tombstone-remote') {
        folderStates[x.relPath] = null;
      }
    } catch (error) {
      summary.errors.push(`${x.relPath} (dossier) : ${errorMessage(error)}`);
      journal.push(makeJournalEntry('error', { path: x.relPath, detail: `dossier : ${errorMessage(error)}` }));
    }
  }
  if (folderPullTotal > 0) {
    await appendJournalEntries([
      makeJournalEntry('info', { detail: `Réception des dossiers : ${folderPullDone}/${folderPullTotal}` }),
    ]).catch(() => undefined);
  }
  // Les fichiers VIVANTS passent avant les chemins `.trash/…` : sinon le
  // tri alphabétique place la corbeille du cloud (des centaines de lignes)
  // devant tout le contenu utile — le mobile y passe le cycle entier sans
  // jamais voir ses fichiers arriver.
  // Sort stable : l'ordre alphabétique est conservé au sein de chaque groupe.
  const orderedDecisions = [...decisions].sort(
    (a, b) => Number(a.relPath.startsWith('.trash/')) - Number(b.relPath.startsWith('.trash/')),
  );
  const mergedHashes: Record<string, string> = {};
  // Contexte de conflit : base attendue = hash du sync-state AU DÉBUT du
  // cycle (dernière version synchronisée) ; plus récent = mtime local vs
  // updated_at cloud, tolérance CLOCK_TOLERANCE_MS (configMerge.ts). La
  // priorité « cloud » du dialogue de fusion force le cloud.
  const conflictContext = (relPath: string): ConflictContext => ({
    expectedBaseHash: syncState.files[relPath],
    newer:
      syncSettings.linkPreference[remoteVaultId] === 'remote'
        ? 'remote'
        : newerSide(localByPath.get(relPath)?.modifiedAt, remoteByPath.get(relPath)?.updatedAt),
  });
  // Chemins RÉELLEMENT écrits sur le disque par un pull de ce cycle. Seuls
  // eux entrent dans le nouvel état de référence : un pull différé ou en
  // échec (ex. écriture SAF rejetée) référencé quand même ferait croire au
  // cycle suivant que le fichier a été « supprimé localement » — et la
  // revue des suppressions massives reviendrait en boucle.
  const pulledPaths = new Set<string>();

  // Les étapes réseau : le journal raconte le cycle comme Obsidian Sync
  // (« upload en cours », « upload terminé »).
  const pushCount = decisions.filter((d) => d.kind === 'push' || d.kind === 'conflict-push-wins').length;
  const pullCount = decisions.filter((d) => d.kind === 'pull' || d.kind === 'conflict-pull-wins').length;
  if (pushCount > 0) journal.push(makeJournalEntry('upload-start', { detail: `${pushCount} fichier(s)` }));
  if (pullCount > 0) journal.push(makeJournalEntry('download-start', { detail: `${pullCount} fichier(s)` }));

  const actionable = orderedDecisions.filter((d) => d.kind !== 'noop').length;
  let progressDone = 0;
  let lastProgressJournalAt = Date.now();
  let lastProgressJournalDone = 0;
  const phase = pullCount > 0 && pushCount === 0 ? 'Téléchargement' : pushCount > 0 && pullCount === 0 ? 'Envoi' : 'Synchronisation';
  if (actionable > 0) setSyncProgress({ phase, done: 0, total: actionable });
  // PARALLÉLISME RAISONNABLE : envois/réceptions simples par FILE_PARALLEL
  // en vol ; les conflits (archivage local + push) restent séquentiels.
  const isConflict = (d: (typeof orderedDecisions)[number]) => d.kind === 'conflict-push-wins' || d.kind === 'conflict-pull-wins';
  const runDecision = async (decision: (typeof orderedDecisions)[number]) => {
    if (decision.kind !== 'noop') {
      setSyncProgress({ phase, done: progressDone, total: actionable, current: decision.relPath });
      // JOURNAL PROGRESSIF : écrit pendant le cycle (toutes les N actions
      // ou 30 s), visible dans Paramètres → Journal sans attendre la fin.
      if (
        progressDone > lastProgressJournalDone &&
        (progressDone - lastProgressJournalDone >= PROGRESS_JOURNAL_EVERY || Date.now() - lastProgressJournalAt >= PROGRESS_JOURNAL_MIN_MS)
      ) {
        lastProgressJournalDone = progressDone;
        lastProgressJournalAt = Date.now();
        await appendJournalEntries([
          makeJournalEntry('info', { detail: `${phase} en cours : ${progressDone}/${actionable} fichiers` }),
        ]).catch(() => undefined);
      }
      progressDone += 1;
    }
    try {
      switch (decision.kind) {
        case 'noop':
          break;
        case 'push': {
          const note = localByPath.get(decision.relPath);
          if (!note) break;
          // Version distante précédente (best-effort, texte seul) :
          // permet au journal de raconter le changement (+/− caractères).
          let previousRemoteContent: string | null = null;
          const remoteRow = remoteByPath.get(decision.relPath);
          if (remoteRow && !isBinaryAttachmentRelPath(decision.relPath)) {
            previousRemoteContent = await downloadRemoteText(
              remoteVaultId,
              decision.relPath,
              remoteRow.storageObjectPath,
            ).catch(() => null);
          }
          await withTimeout(pushFile(remoteVaultId, ownerId, note, journal, previousRemoteContent, pushOptions.get(decision.relPath)), FILE_OP_TIMEOUT_MS, `envoi ${note.relPath}`);
          // Un push sous `.trash/` est le continu d'un déplacement en
          // corbeille — compté À PART, pas dans « envoyé(s) ».
          if (decision.relPath.startsWith('.trash/')) {
            summary.trashed += 1;
          } else {
            summary.pushed += 1;
          }
          break;
        }
        case 'pull':
          // ANTI-CONTAMINATION : un chemin contenant un `\` est un résidu
          // backslashed du mélange — le créer créerait un FICHIER PLAT au
          // nom impossible (légal sur Android, pas sur le fs desktop) qui
          // re-contaminerait le cloud à son tour. Ces lignes sont écartées
          // du diff dès le début du cycle ; ici, refus par double sécurité.
          if (decision.relPath.includes('\\')) {
            journal.push(
              makeJournalEntry('error', { path: decision.relPath, detail: 'pull bloqué : chemin contaminé (backslash)' }),
            );
            break;
          }
          // Fichier EN COURS D'ÉDITION ici : ne jamais écraser
          // localement (le diff le retrouvera changé au prochain cycle, et
          // c'est la version locale qui repartira).
          if (hotPaths.has(decision.relPath)) {
            journal.push(
              makeJournalEntry('info', { path: decision.relPath, detail: 'pull différé : fichier en cours d’édition sur cet appareil' }),
            );
            keepPreviousRef.add(decision.relPath);
            break;
          }
          // v0.4.84 (§15 du journal d'incidents) : un pull sur un fichier
          // ABSENT du parcours local peut écraser une édition fraîche que le
          // parcours a ratée (fichier écrit pendant l'indexation) — la
          // relecture directe AVANT tout pull : si le fichier répond, on
          // diffère et le cycle suivant le verra dans le parcours.
          if (!localByPath.has(decision.relPath)) {
            try {
              await bridges.vault.readNote(decision.relPath);
              journal.push(
                makeJournalEntry('info', { path: decision.relPath, detail: 'pull différé : le fichier répond localement (parcours du cycle non fiable)' }),
              );
              keepPreviousRef.add(decision.relPath);
              break;
            } catch {
              // réellement absent du disque : le pull est légitime
            }
          }
          await withTimeout(pullFile(remoteVaultId, decision.relPath, remoteByPath.get(decision.relPath)?.storageObjectPath), FILE_OP_TIMEOUT_MS, `réception ${decision.relPath}`);
          pulledPaths.add(decision.relPath);
          summary.pulled += 1;
          summary.modifications += 1;
          journal.push(makeJournalEntry('modification-reçue', { path: decision.relPath, detail: 'reçue depuis un autre appareil' }));
          break;
        case 'conflict-push-wins': {
          // Un fichier EN COURS D'ÉDITION ne fusionne JAMAIS à chaud : le
          // conflit est DIFFÉRÉ au cycle suivant, symétrique de la garde du
          // pull (ci-dessus). Fusionner quand même réécrirait le fichier
          // ouvert — ce qui relance le conflit à chaque cycle.
          if (hotPaths.has(decision.relPath)) {
            journal.push(
              makeJournalEntry('info', { path: decision.relPath, detail: 'conflit différé : fichier en cours d’édition sur cet appareil' }),
            );
            keepPreviousRef.add(decision.relPath);
            break;
          }
          // Fusion à trois voix d'abord (diff-match-patch) — deux
          // modifications de parties différentes sont réunies, aucune des
          // deux n'est archivée. Repli : gagnant local + perdant archivé.
          const mergedPushHash = await attemptConflictMerge(
            remoteVaultId,
            ownerId,
            decision.relPath,
            remoteByPath.get(decision.relPath)?.storageObjectPath,
            journal,
            syncSettings.linkPreference[remoteVaultId] === 'local',
            () => { summary.pulled += 1; },
            conflictContext(decision.relPath),
          );
          if (mergedPushHash) {
            mergedHashes[decision.relPath] = mergedPushHash;
            summary.conflicts += 1;
            break;
          }
          const note = localByPath.get(decision.relPath);
          if (!note) break;
          const losingRemoteContent = await downloadRemoteText(
            remoteVaultId,
            decision.relPath,
            remoteByPath.get(decision.relPath)?.storageObjectPath,
          );
          await backupLosingSide(decision.relPath, losingRemoteContent);
          // La version distante perdante sert aussi au journal
          // « modification » (+/− caractères de la version conservée).
          await withTimeout(pushFile(remoteVaultId, ownerId, note, journal, losingRemoteContent), FILE_OP_TIMEOUT_MS, `envoi ${note.relPath}`);
          summary.pushed += 1;
          summary.conflicts += 1;
          journal.push(makeJournalEntry('conflict', { path: decision.relPath, detail: 'version locale conservée, distante archivée' }));
          break;
        }
        case 'conflict-pull-wins': {
          const mergedPullHash = await attemptConflictMerge(
            remoteVaultId,
            ownerId,
            decision.relPath,
            remoteByPath.get(decision.relPath)?.storageObjectPath,
            journal,
            syncSettings.linkPreference[remoteVaultId] === 'local',
            () => { summary.pulled += 1; },
            conflictContext(decision.relPath),
          );
          if (mergedPullHash) {
            mergedHashes[decision.relPath] = mergedPullHash;
            summary.conflicts += 1;
            break;
          }
          const losingLocalContent = await bridges.vault.readNote(decision.relPath);
          // Jamais l'archivage d'un fichier en cours d'édition :
          // même garde que le pull simple ci-dessus.
          if (hotPaths.has(decision.relPath)) {
            journal.push(
              makeJournalEntry('info', { path: decision.relPath, detail: 'conflit différé : fichier en cours d’édition sur cet appareil' }),
            );
            keepPreviousRef.add(decision.relPath);
            break;
          }
          await backupLosingSide(decision.relPath, losingLocalContent);
          await withTimeout(pullFile(remoteVaultId, decision.relPath, remoteByPath.get(decision.relPath)?.storageObjectPath), FILE_OP_TIMEOUT_MS, `réception ${decision.relPath}`);
          pulledPaths.add(decision.relPath);
          summary.pulled += 1;
          summary.conflicts += 1;
          journal.push(makeJournalEntry('conflict', { path: decision.relPath, detail: 'version distante conservée, locale archivée' }));
          break;
        }
      }
    } catch (error) {
      // Issue non confirmée : l'ancienne référence est conservée — sinon le
      // cycle suivant prendrait le hash local pour référence et TIRERAIT
      // le cloud par-dessus la modification locale non poussée.
      keepPreviousRef.add(decision.relPath);
      if (isVersionConflictError(error)) {
        // Verrou optimiste : quelqu'un a écrit entre notre lecture et notre
        // écriture. RIEN n'est écrasé ; pas une erreur (pas de disjoncteur) :
        // le cycle suivant voit la nouvelle version et passe par fusion /
        // copie de conflit.
        journal.push(
          makeJournalEntry('conflict', { path: decision.relPath, detail: `${errorMessage(error)} — résolu au prochain cycle` }),
        );
        return;
      }
      console.error(`[sync] échec sur ${decision.relPath} (${decision.kind}) :`, error);
      summary.errors.push(`${decision.relPath} : ${errorMessage(error)}`);
      journal.push(makeJournalEntry('error', { path: decision.relPath, detail: `${decision.kind} : ${errorMessage(error)}` }));
    }
  };
  await runPool(orderedDecisions.filter((d) => !isConflict(d)), FILE_PARALLEL, runDecision);
  for (const decision of orderedDecisions.filter(isConflict)) await runDecision(decision);

  if (actionable > 0) setSyncProgress({ phase, done: actionable, total: actionable });
  if (pushCount > 0) journal.push(makeJournalEntry('upload-end', { detail: `${pushCount} fichier(s)` }));
  if (pullCount > 0) journal.push(makeJournalEntry('download-end', { detail: `${pullCount} fichier(s)` }));

  // Nouvel état de référence = ensemble local APRES le cycle : fichiers
  // locaux présents (push/noop/'skip' conservés, y compris ceux EN REVUE —
  // leur entrée est gardée pour que la revue dispose du hash de référence),
  // fichiers tirés avec le hash distant, suppressions retirées. Une erreur
  // avant ici laisse l'ancien état : le prochain cycle re-détecte tout
  // idempotemment.
  const nextFiles: Record<string, string> = {};
  for (const note of localFiles) {
    if (locallyDeleted.includes(note.relPath)) continue;
    nextFiles[note.relPath] = note.contentHash;
  }
  for (const decision of orderedDecisions) {
    if (decision.kind !== 'pull' && decision.kind !== 'conflict-pull-wins') continue;
    if (!pulledPaths.has(decision.relPath)) continue;
    const remote = remoteByPath.get(decision.relPath);
    if (remote) nextFiles[decision.relPath] = remote.contentHash;
  }
  // Le fichier FUSIONNÉ est la nouvelle vérité locale ET distante (il vient
  // d'être écrit et poussé). Le state enregistre le hash RÉEL du fichier
  // écrit, pas celui de l'indexation d'avant la fusion — sinon le cycle
  // suivant re-détecte une divergence déjà résolue et re-annonce le
  // conflit, en boucle.
  // Suppressions RETENUES (index partiel) : leur base est conservée pour
  // être rejugées au cycle suivant, une fois le parcours complet réussi.
  for (const relPath of heldDeletions) {
    if (!(relPath in nextFiles) && relPath in syncState.files) nextFiles[relPath] = syncState.files[relPath];
  }
  for (const [relPath, mergedHash] of Object.entries(mergedHashes)) {
    nextFiles[relPath] = mergedHash;
  }
  // Types désactivés / fichiers en édition : leur base est CONSERVÉE telle
  // quelle (sinon les réactiver ressemblerait à une suppression).
  for (const [relPath, hash] of Object.entries(syncState.files)) {
    if (!allow(relPath) && !(relPath in nextFiles) && !isFolderMarker(relPath)) nextFiles[relPath] = hash;
  }
  for (const [relPath, hash] of Object.entries(syncState.files)) {
    if (isFolderMarker(relPath) && !(relPath in folderStates)) nextFiles[relPath] = hash;
  }
  for (const [relPath, hash] of Object.entries(folderStates)) {
    if (hash) nextFiles[relPath] = hash;
    else delete nextFiles[relPath];
  }
  // Issue non confirmée (suppression distante en attente, pull différé,
  // relecture contradictoire…) : base précédente conservée à l'identique.
  for (const relPath of keepPreviousRef) {
    if (isFolderMarker(relPath)) continue;
    if (relPath in syncState.files) nextFiles[relPath] = syncState.files[relPath];
    else delete nextFiles[relPath];
  }
  try {
    await saveSyncState({ files: nextFiles, rootPath: vaultRootPath, version: stateVersion });
    if (syncSettings.linkPreference[remoteVaultId]) {
      const { [remoteVaultId]: _done, ...rest } = syncSettings.linkPreference;
      saveSyncSettings({ ...loadSyncSettings(), linkPreference: rest });
    }
  } catch (error) {
    console.error('[sync] échec de la sauvegarde de l’état de synchro :', error);
    journal.push(makeJournalEntry('error', { detail: `sauvegarde de l'état : ${errorMessage(error)}` }));
  }

  // DISJONCTEUR : une rafale d'erreurs dans un cycle FERME le
  // circuit pour les cycles suivants (revue manuelle pour rouvrir — jamais
  // de resynchronisation par-dessus un appareil en échec). Le message et
  // son ORIGINE partent dans le journal ET dans les logs (console.error
  // visible en logcat release).
  if (shouldTripBreaker(summary.errors.length)) {
    const blocked = {
      at: new Date().toISOString(),
      errorCount: summary.errors.length,
      samples: summary.errors.slice(0, 3),
    };
    try {
      const review = await loadPendingReview(bridges.vault);
      await savePendingReview(bridges.vault, { ...review, syncBlocked: blocked });
    } catch (error) {
      // Le bloc n'a pas pu être persisté (écritures en échec — c'est
      // justement le cas typique) : le log et le journal restent la trace.
      console.error('[sync] disjoncteur non persistable :', error);
    }
    console.error(
      `[sync] DISJONCTEUR OUVERT : ${blocked.errorCount} erreurs ce cycle — synchro bloquée jusqu'à revue. Origines : ${blocked.samples.join(' | ').slice(0, 400)}`,
    );
    journal.push(
      makeJournalEntry('error', {
        detail: `Disjoncteur ouvert : ${blocked.errorCount} erreur(s) — synchronisation bloquée jusqu'à revue manuelle. Ex. ${blocked.samples[0] ?? ''}`,
      }),
    );
  }

  // « Appareils connectés » (Paramètres → Coffres distants) : heartbeat
  // best-effort APRÈS le cycle de fichiers — jamais dans les erreurs du
  // résumé (voir heartbeatDevice).
  await withTimeout(heartbeatDevice(remoteVaultId, ownerId, summary), 30_000, 'heartbeat de fin').catch(() => undefined);

  // PASSERELLE À DISTANCE : exécute les commandes adressées à CET
  // appareil (dump-diagnostics, levée de bloc…) via le canal Supabase —
  // best-effort, jamais bloquant, sans adb (voir deviceGateway.ts).
  await withTimeout(processDeviceCommands(remoteVaultId, ownerId), 120_000, 'commandes appareil').catch(() => undefined);

  journal.push(
    makeJournalEntry('cycle-end', {
      detail: `${summary.pushed} envoyé(s), ${summary.pulled} reçu(s), ${summary.deleted} supprimé(s), ${summary.conflicts} conflit(s), ${summary.modifications} modification(s)${summary.errors.length > 0 ? `, ${summary.errors.length} erreur(s)` : ''}`,
    }),
  );

  // v0.4.89 — PUBLICATION DU JOURNAL (sync_journals) : chaque appareil
  // publie les entrées de SON dernier cycle dans la table cloud — le plugin
  // Obsidian « Sync Views » et les autres appareils lisent LES TROIS
  // journaux à un seul endroit (l'objectif : ne plus jamais interpréter la
  // situation de sync). Best-effort : l'échec de publication n'est jamais
  // une erreur de synchronisation.
  try {
    const device = (await bridges.vaults.deviceInfo?.()) ?? { id: remoteVaultId, name: 'appareil' };
    const { supabase: client } = requireBridges();
    // Android : version native (inchangé) ; desktop : updater.getVersion
    // via myAppVersion — avant, null sur desktop (fonction Android seule).
    const { installedAppVersion } = await import('../updaterAndroid');
    const { myAppVersion } = await import('./deviceGateway');
    const appVersion = installedAppVersion() ?? (await myAppVersion().catch(() => null));
    const { error: journalError } = await client.schema(APP_SCHEMA).from('sync_journals').upsert({
      vault_id: remoteVaultId,
      device_id: device.id,
      device_name: device.name ?? 'appareil',
      app_version: appVersion,
      entries: journal,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'vault_id,device_id' });
    if (journalError) throw journalError;
  } catch (error) {
    console.error('[sync] publication du journal (sync_journals) :', error);
  }

  // INVENTAIRE PAR APPAREIL (deviceInventory.ts) : ce que CE disque
  // contient réellement, publié à chaque fin de cycle. Best-effort.
  try {
    const { publishDeviceInventory } = await import('./deviceInventory');
    await publishDeviceInventory(remoteVaultId, localFiles);
  } catch (error) {
    console.error('[sync] inventaire appareil :', error);
  }

  // Cycle SANS aucune action : la « Connexion au serveur » est retirée — le
  // journal ne garde que les cycles qui ont réellement fait quelque chose
  // (pas de spam de cycles à vide).
  if (journal.length > 1) {
    await appendJournalEntries(journal.slice(1));
  } else {
    await truncateJournalEntries(journalStartLength);
  }

  return summary;
}
