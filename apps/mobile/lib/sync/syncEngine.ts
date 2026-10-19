import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import {
  APP_SCHEMA,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  supabase,
  VAULT_DEVICES_TABLE,
  VAULT_FILES_BUCKET,
  VAULT_FILES_TABLE,
  VAULTS_TABLE,
} from './supabaseClient';
import { diffVault, type LocalHashedNote, type RemoteVaultFile } from './diff';
import { splitEditHot } from './editQuiet';
import { installedAppVersion } from '../updaterAndroid';
import { errorMessage } from '../errorMessage';
import { sortDevicesByLastSeen, type RemoteVaultDevice } from './devices';
import { fetchRemoteFiles, downloadRemoteText, downloadRemoteBinary, pushFile, pullFile, isBinaryAttachmentRelPath, loadSyncBase } from './cloud';
import { fetchDevicesByVault, heartbeatDevice, fetchMyDeviceLock } from './cloud';
import { requireBridges } from './bridges';

// Le compte de lignes backslashed signalé au cycle précédent : le signal
// « N lignes ignorées » ne se répète que si le nombre change.
let lastBackslashReport = -1;
import { type SyncSummary, type RemoteVaultSummary } from './syncTypes';
import { computeLocalDeletions, isMassiveDeletion, remoteDeletionAction } from './deletions';
import {
  loadPendingReview,
  savePendingReview,
  SYNC_ERROR_BLOCK_THRESHOLD,
  type PendingReview,
} from './pendingReview';
import { pickActiveRemoteVault } from './activeVault';
import {
  capJournalEntries,
  makeJournalEntry,
  type SyncJournal,
  type SyncJournalEntry,
} from './journal';
import { tryThreeWayMerge } from './merge';
import { textChangeStats, textChangeDetail } from './changeStats';
import { processDeviceCommands } from './deviceGateway';
import { vaultStorageObjectKey } from './storageKeys';
// Liste des pièces jointes synchronisées (source unique : nativeVaultAdapter).
import { SYNC_ATTACHMENT_EXTENSIONS } from '../storage/nativeVaultAdapter';
// randomUUID portable — crypto.randomUUID n'existe pas sous Hermes natif
// (le helper web tombe sur Math.random), voir lib/storage/webUuid.ts.
import { randomUUID as uuid } from '../storage/webUuid';

// ✒️ 123ECRITURE — lib/sync/syncEngine.ts — le moteur du cycle de synchronisation
//////////////////////////////////////////////////////////////////////////////
//
// Un cycle (runSync) déroule toujours la même séquence : résoudre ENSEMBLE
// le coffre local actif et sa ligne distante, passer les gardes d'entrée
// (disjoncteur, verrou à distance, verrou anti-bascule), hacher le coffre
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
//   3. Les appareils : heartbeat, verrou à distance, levée du disjoncteur
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
  rootPath?: string | null;
};

// Hermes (Android) n'expose PAS `AbortSignal.timeout` (méthode statique du
// DOM) : l'appeler fait échouer CHAQUE cycle de synchro sur Android.
// Helper qui renvoie le signal quand il existe, sinon undefined (pas
// d'abandon — le délai d'attente strict reste un chantier pour une
// polyfill dédiée).
function abortAfter(ms: number): AbortSignal | undefined {
  const ctor = globalThis.AbortSignal as { timeout?: (ms: number) => AbortSignal } | undefined;
  return typeof ctor?.timeout === 'function' ? ctor.timeout(ms) : undefined;
}

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
      files[relPath] = hash;
    }
    return { files, rootPath: parsed.rootPath ?? null };
  } catch {
    // Absent à la première synchro du coffre — repart à vide.
    return { files: {} };
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
  if (!wasDeduped) {
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
    await pushFile(remoteVaultId, ownerId, restored);
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
async function attemptConflictMerge(
  remoteVaultId: string,
  ownerId: string,
  relPath: string,
  remoteObjectPath: string | undefined,
  journal: SyncJournalEntry[],
): Promise<string | null> {
  if (isBinaryAttachmentRelPath(relPath)) return null; // jamais de fusion binaire
  const base = await loadSyncBase(relPath);
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
  const summary: SyncSummary = { pushed: 0, pulled: 0, deleted: 0, trashed: 0, conflicts: 0, errors: [] };
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
  const pendingReview = await loadPendingReview(bridges.vault).catch(() => ({}) as PendingReview);
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
  await bridges.sync.setVaultLock?.(true);

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

  const [remoteFiles, syncState] = await Promise.all([
    fetchRemoteFiles(remoteVaultId),
    loadSyncState(),
  ]);

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
  const localFiles = (await bridges.sync.hashVaultTree()).map((note) => ({
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
    journal.push(
      makeJournalEntry('info', {
        detail: `${hotPaths.size} fichier(s) en cours d'édition — synchronisation différée (silence de 60 s requis) : ${[...hotPaths].slice(0, 2).join(' | ').slice(0, 140)}`,
      }),
    );
  }
  const localByPath = new Map(localFilesCold.map((note) => [note.relPath, note]));
  const localPaths = new Set(localFilesCold.map((note) => note.relPath));

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
    journal.push(
      makeJournalEntry('info', {
        detail: `${backslashedRows.length} ligne(s) résiduelle(s) à backslash ignorée(s) dans le cloud (inoffensives) — nettoyage manuel disponible sur demande`,
      }),
    );
  }
  const activeRemoteFiles = remoteFiles.filter(
    (file) => !file.deleted && !(file.rawRelPath ?? '').includes('\\'),
  );
  const remoteByPath = new Map(activeRemoteFiles.map((file) => [file.relPath, file]));
  const tombstonedPaths = new Set(
    remoteFiles.filter((file) => file.deleted).map((file) => file.relPath),
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
  const locallyDeleted = computeLocalDeletions(syncState.files, localPaths);
  if (isMassiveDeletion(locallyDeleted.length, localFiles.length)) {
    const review: PendingReview = {
      suspiciousDeletions: {
        at: new Date().toISOString(),
        count: locallyDeleted.length,
        paths: locallyDeleted.slice(0, 200),
      },
    };
    await savePendingReview(bridges.vault, review).catch(() => undefined);
    const message = `${locallyDeleted.length} fichier(s) manquent localement (coffre : ${localFiles.length} fichiers) — suppressions BLOQUÉES et mises EN REVUE MANUELLE (pending-review.json). Si cette suppression est VOLONTAIRE, valide-la depuis Paramètres → Journal de synchronisation ; sinon, relance la synchro : tes fichiers seront restaurés depuis le cloud.`;
    summary.errors.push(message);
    journal.push(makeJournalEntry('error', { detail: message }));
  } else {
    for (const relPath of locallyDeleted) {
      try {
        // REVÉRIFICATION DIRECTE AVANT TOUTE TOMBSTONE : un parcours peut
        // manquer un fichier (édité pendant le scan). Si le fichier RÉPOND
        // à une lecture directe, il existe : le parcours s'est trompé, on
        // ne détruit rien et on le signale — sinon les AUTRES appareils
        // effacent un fichier vivant.
        try {
          await bridges.vault.readNote(relPath);
          journal.push(
            makeJournalEntry('info', {
              path: relPath,
              detail: 'présent à la relecture directe — tombstone annulée (parcours du cycle non fiable)',
            }),
          );
          continue;
        } catch (readError) {
          const brut = readError instanceof Error ? readError.message : String(readError);
          if (!/introuvable|not found|could not be found|ENOENT/i.test(brut)) {
            // Illisible (≠ absent) : conservé ce cycle, retenté au suivant.
            journal.push(
              makeJournalEntry('info', { path: relPath, detail: `lecture en échec — fichier conservé ce cycle : ${brut.slice(0, 120)}` }),
            );
            continue;
          }
        }
        if (remoteByPath.has(relPath)) {
          const { error } = await bridges.supabase
            .schema(APP_SCHEMA)
            .from(VAULT_FILES_TABLE)
            .update({ deleted: true, updated_at: new Date().toISOString() })
            .eq('vault_id', remoteVaultId)
            .eq('rel_path', relPath);
          if (error) throw error;
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

  // 2) Tombestones distantes — PROPAGATION NORMALE, application locale
  //    CONSERVATRICE (remoteDeletionAction) : un fichier jamais apporté par
  //    la synchro n'est jamais effacé, un fichier modifié laisse une copie
  //    « (conflit …) » avant de partir. L'élagueur de dossiers parents vides
  //    est conservé.
  const appliedDeletions = new Set<string>();
  const revueSuppressionsDistantes: { path: string; modified: boolean; at: string }[] = [];
  for (const relPath of tombstonedPaths) {
    const local = localByPath.get(relPath);
    if (!local) continue;
    try {
      const action = remoteDeletionAction({
        localExists: true,
        lastSyncedHash: syncState.files[relPath],
        localHash: local.contentHash,
      });
      if (action === 'skip') continue;
      if (action === 'keep-copy') {
        // RÈGLE ABSOLUE : un fichier modifié ici et supprimé ailleurs n'est
        // JAMAIS archivé ni effacé automatiquement — il reste en place et
        // part en REVUE (l'écran « Revue de sécurité » propose « Supprimer
        // vraiment » ou « Restaurer dans le cloud »).
        journal.push(
          makeJournalEntry('modification', {
            path: relPath,
            detail: 'modifié ici, supprimé ailleurs — EN ATTENTE DE VALIDATION (fichier conservé)',
          }),
        );
        revueSuppressionsDistantes.push({ path: relPath, modified: true, at: new Date().toISOString() });
        continue;
      }
      await bridges.vault.delete(relPath, { silent: true });
      appliedDeletions.add(relPath);
      summary.deleted += 1;
      journal.push(makeJournalEntry('delete', { path: relPath, detail: 'suppression distante appliquée (corbeille)' }));
    } catch (error) {
      console.error(`[sync] échec de la suppression distante ${relPath} :`, error);
      summary.errors.push(`${relPath} (suppression distante) : ${errorMessage(error)}`);
      journal.push(makeJournalEntry('error', { path: relPath, detail: `suppression distante : ${errorMessage(error)}` }));
    }
  }

  // Les suppressions distantes en attente de validation sont publiées dans
  // pending-review.json (l'écran « Revue de sécurité » les affiche avec
  // « Supprimer vraiment / Restaurer dans le cloud »).
  if (revueSuppressionsDistantes.length > 0) {
    try {
      const review = await loadPendingReview(bridges.vault).catch(() => ({}) as PendingReview);
      const byPath = new Map((review.remoteDeletions ?? []).map((r) => [r.path, r]));
      for (const entry of revueSuppressionsDistantes) byPath.set(entry.path, entry);
      await savePendingReview(bridges.vault, {
        ...review,
        remoteDeletions: [...byPath.values()].slice(0, 500),
      });
      console.error(
        `[sync] ${revueSuppressionsDistantes.length} suppression(s) distante(s) EN ATTENTE DE VALIDATION (fichiers conservés)`,
      );
    } catch (error) {
      console.error('[sync] écriture de la file de revue :', error);
    }
  }

//////// 10. runSync : diff, décisions, nouvel état et clôture //////////////

  // 3) Diff SUR LES ENSEMBLES FILTRÉS : ni les tombestones (jamais de
  //    pull, jamais de push — push les réactiveraient), ni les fichiers
  //    supprimés localement (absents du disque). Le sync-state sert de
  //    RÉFÉRENCE au diff (3 voies) : une modification d'un fichier dont le
  //    cloud porte encore le hash connu est un push, pas un conflit.
  const diffLocalFiles = localFiles.filter((note) => !tombstonedPaths.has(note.relPath));
  const diffRemoteFiles = activeRemoteFiles.filter((file) => !tombstonedPaths.has(file.relPath));
  const decisions = diffVault(diffLocalFiles, diffRemoteFiles, syncState.files);
  // Les fichiers VIVANTS passent avant les chemins `.trash/…` : sinon le
  // tri alphabétique place la corbeille du cloud (des centaines de lignes)
  // devant tout le contenu utile — le mobile y passe le cycle entier sans
  // jamais voir ses fichiers arriver.
  // Sort stable : l'ordre alphabétique est conservé au sein de chaque groupe.
  const orderedDecisions = [...decisions].sort(
    (a, b) => Number(a.relPath.startsWith('.trash/')) - Number(b.relPath.startsWith('.trash/')),
  );
  const mergedHashes: Record<string, string> = {};

  // Les étapes réseau : le journal raconte le cycle comme Obsidian Sync
  // (« upload en cours », « upload terminé »).
  const pushCount = decisions.filter((d) => d.kind === 'push' || d.kind === 'conflict-push-wins').length;
  const pullCount = decisions.filter((d) => d.kind === 'pull' || d.kind === 'conflict-pull-wins').length;
  if (pushCount > 0) journal.push(makeJournalEntry('upload-start', { detail: `${pushCount} fichier(s)` }));
  if (pullCount > 0) journal.push(makeJournalEntry('download-start', { detail: `${pullCount} fichier(s)` }));

  for (const decision of orderedDecisions) {
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
          await pushFile(remoteVaultId, ownerId, note, journal, previousRemoteContent);
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
              break;
            } catch {
              // réellement absent du disque : le pull est légitime
            }
          }
          await pullFile(remoteVaultId, decision.relPath, remoteByPath.get(decision.relPath)?.storageObjectPath);
          summary.pulled += 1;
          journal.push(makeJournalEntry('pull', { path: decision.relPath }));
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
          await pushFile(remoteVaultId, ownerId, note, journal, losingRemoteContent);
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
            break;
          }
          await backupLosingSide(decision.relPath, losingLocalContent);
          await pullFile(remoteVaultId, decision.relPath, remoteByPath.get(decision.relPath)?.storageObjectPath);
          summary.pulled += 1;
          summary.conflicts += 1;
          journal.push(makeJournalEntry('conflict', { path: decision.relPath, detail: 'version distante conservée, locale archivée' }));
          break;
        }
      }
    } catch (error) {
      console.error(`[sync] échec sur ${decision.relPath} (${decision.kind}) :`, error);
      summary.errors.push(`${decision.relPath} : ${errorMessage(error)}`);
      journal.push(makeJournalEntry('error', { path: decision.relPath, detail: `${decision.kind} : ${errorMessage(error)}` }));
    }
  }

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
    if (locallyDeleted.includes(note.relPath) || appliedDeletions.has(note.relPath)) continue;
    nextFiles[note.relPath] = note.contentHash;
  }
  for (const decision of orderedDecisions) {
    if (decision.kind !== 'pull' && decision.kind !== 'conflict-pull-wins') continue;
    const remote = remoteByPath.get(decision.relPath);
    if (remote) nextFiles[decision.relPath] = remote.contentHash;
  }
  // Le fichier FUSIONNÉ est la nouvelle vérité locale ET distante (il vient
  // d'être écrit et poussé). Le state enregistre le hash RÉEL du fichier
  // écrit, pas celui de l'indexation d'avant la fusion — sinon le cycle
  // suivant re-détecte une divergence déjà résolue et re-annonce le
  // conflit, en boucle.
  for (const [relPath, mergedHash] of Object.entries(mergedHashes)) {
    nextFiles[relPath] = mergedHash;
  }
  try {
    await saveSyncState({ files: nextFiles, rootPath: vaultRootPath });
  } catch (error) {
    console.error('[sync] échec de la sauvegarde de l’état de synchro :', error);
    journal.push(makeJournalEntry('error', { detail: `sauvegarde de l'état : ${errorMessage(error)}` }));
  }

  // DISJONCTEUR : une rafale d'erreurs dans un cycle FERME le
  // circuit pour les cycles suivants (revue manuelle pour rouvrir — jamais
  // de resynchronisation par-dessus un appareil en échec). Le message et
  // son ORIGINE partent dans le journal ET dans les logs (console.error
  // visible en logcat release).
  if (summary.errors.length >= SYNC_ERROR_BLOCK_THRESHOLD) {
    const blocked = {
      at: new Date().toISOString(),
      errorCount: summary.errors.length,
      samples: summary.errors.slice(0, 3),
    };
    try {
      const review = await loadPendingReview(bridges.vault).catch(() => ({}) as PendingReview);
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
  await heartbeatDevice(remoteVaultId, ownerId, summary);

  // PASSERELLE À DISTANCE : exécute les commandes adressées à CET
  // appareil (dump-diagnostics, levée de bloc…) via le canal Supabase —
  // best-effort, jamais bloquant, sans adb (voir deviceGateway.ts).
  await processDeviceCommands(remoteVaultId, ownerId);

  journal.push(
    makeJournalEntry('cycle-end', {
      detail: `${summary.pushed} envoyé(s), ${summary.pulled} reçu(s), ${summary.deleted} supprimé(s), ${summary.conflicts} conflit(s)${summary.errors.length > 0 ? `, ${summary.errors.length} erreur(s)` : ''}`,
    }),
  );

  // Cycle SANS aucune action : la « Connexion au serveur » est retirée — le
  // journal ne garde que les cycles qui ont réellement fait quelque chose
  // (pas de spam de cycles à vide).
  if (journal.length > 1) {
    await appendJournalEntries(journal.slice(1));
  } else {
    await truncateJournalEntries(journalStartLength);
  }

  await bridges.sync.setVaultLock?.(false);
  return summary;
}
