// //1. 📖 SOMMAIRE — window.vault web (File System Access API)
// ////////////////////////////////////////////////////////////////////////
// Port de apps/desktop/electron/vault.ts sur des handles FSA. Même contrat
// que le pont Electron (types/global.d.ts), mêmes conventions :
// - //2. Types de fichiers et gabarits (EXTENSION_TO_KIND, gabarits)
// - //3. Lecture (listTree, readNote, state.json)
// - //4. Création/écriture (writeNote, createNote/-folder, duplicate,
//      note journalière, pièces jointes)
// - //5. Organisation (rename, move, set-path, delete)
// - //6. Choix de dossier (chooseFolder → showDirectoryPicker)
//
// Écarts assumés par rapport au desktop (documentés) :
// - PAS de rename natif dans la FSA : renommer/déplacer = copier puis
//   supprimer. lastModified n'est pas préservable → une note renommée
//   remonte au tri « Plus récent d'abord ».
// - La confirmation de suppression est window.confirm (native desktop =
//   dialog.showMessageBox) — même garantie : jamais de suppression
//   silencieuse.
// - `path` du registre/getCurrentPath = NOM du dossier choisi (le navigateur
//   n'expose jamais le chemin disque réel).

// Les types des ponts (VaultBridge, VaultTreeNode...) sont GLOBAUX (voir
// types/global.d.ts) — comme partout dans l'app, pas d'import nécessaire.

import { parseFrontmatter } from '../frontmatter';
import {
  type FsaDirectoryHandleLike,
  type FsaFileHandleLike,
  applyManualOrder,
  copyDirectoryInto,
  entryExists,
  findAvailableName,
  getDirByRelPath,
  getFileByRelPath,
  listNoteRelPaths,
  readFileText,
  removeEntryRecursive,
  sortNodes,
  splitRelPath,
  writeFileText,
} from './webFs';
import { webVaultRegistry } from './webVaultRegistry';
import { randomUUID } from './webUuid';

// L'ordre manuel des enfants (.123ecriture/order.json) — une clé par
// dossier PARENT ("" = racine). Le type équivalent côté desktop vit dans
// electron/types.ts (VaultOrder) : pas de type global partagé, forme
// répliquée ici (même convention que types/global.d.ts, hand-mirrored).
type VaultOrder = Record<string, string[]>;

// Clé localStorage des préférences web — partagée avec webAppAdapter.ts
// (qui expose window.preferences). Déclarée ici en tête : le tri des
// fichiers (walkTree) et le dossier de pièces jointes (importAttachment)
// la lisent directement, comme le desktop lit son config.json.
export const WEB_PREFERENCES_KEY = '123ecriture.preferences';

// //2. 🗺️ TYPES DE FICHIERS ET GABARITS
// ////////////////////////////////////////////////////////////////////////

// Port direct des tables de vault.ts — un fichier `.md` importé d'Obsidian
// est reconnu en LECTURE, mais les nouvelles notes restent en `.mdx`.
const EXTENSION_TO_KIND: Record<string, VaultEntryKind> = {
  '.mdx': 'markdown',
  '.md': 'markdown',
  '.canvas': 'canvas',
  '.chart': 'chart',
  '.excalidraw': 'excalidraw',
};

const KIND_TO_EXTENSION: Record<VaultEntryKind, string> = {
  markdown: '.mdx',
  canvas: '.canvas',
  chart: '.chart',
  excalidraw: '.excalidraw',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

function guessMimeType(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const extension = dot === -1 ? '' : fileName.slice(dot).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

function defaultContentForKind(kind: VaultEntryKind, safeName: string): string {
  if (kind === 'canvas') {
    return JSON.stringify({ nodes: [], edges: [] }, null, 2);
  }
  if (kind === 'chart') {
    return JSON.stringify(
      {
        columns: [
          { id: randomUUID(), name: 'Colonne A' },
          { id: randomUUID(), name: 'Colonne B' },
        ],
        rows: [],
        chart: null,
      },
      null,
      2,
    );
  }
  if (kind === 'excalidraw') {
    return JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {} }, null, 2);
  }
  return `---\ntitle: ${safeName}\ncreated: ${new Date().toISOString()}\n---\n\n`;
}

// Mode de tri des fichiers : l'équivalent de getFileSortMode() (config
// app-level desktop) — les préférences web vivent dans localStorage
// (voir webAppAdapter.ts, qui expose la clé partagée ici).
export function readWebFileSortMode(): 'alphabetical' | 'recent' | 'oldest' | 'manual' {
  try {
    const stored = JSON.parse(localStorage.getItem(WEB_PREFERENCES_KEY) ?? '{}');
    const mode = stored?.fileSortMode;
    return mode === 'recent' || mode === 'oldest' || mode === 'manual' ? mode : 'alphabetical';
  } catch {
    return 'alphabetical';
  }
}

export function readWebAttachmentsFolder(): string {
  try {
    const stored = JSON.parse(localStorage.getItem(WEB_PREFERENCES_KEY) ?? '{}');
    const folder = stored?.attachmentsFolder;
    return typeof folder === 'string' && folder.trim() ? folder.trim() : 'attachments';
  } catch {
    return 'attachments';
  }
}

// //3. 📖 LECTURE — arborescence, contenu, état par coffre
// ////////////////////////////////////////////////////////////////////////

async function walkTree(
  dir: FsaDirectoryHandleLike,
  prefix: string,
  order: VaultOrder,
): Promise<VaultTreeNode[]> {
  const nodes: VaultTreeNode[] = [];

  for await (const entry of dir.values()) {
    // Même règle que walkTree desktop : ignorer les fichiers/dossiers
    // cachés (.123ecriture/ config vault, .git...).
    if (entry.name.startsWith('.')) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.kind === 'directory') {
      nodes.push({
        type: 'folder',
        relPath,
        name: entry.name,
        children: await walkTree(entry, relPath, order),
      });
    } else {
      const dot = entry.name.lastIndexOf('.');
      const extension = dot === -1 ? '' : entry.name.slice(dot).toLowerCase();
      const kind = EXTENSION_TO_KIND[extension];
      if (!kind) continue;
      const file = await entry.getFile();
      nodes.push({
        type: 'note',
        relPath,
        name: entry.name.slice(0, -extension.length),
        modifiedAt: file.lastModified,
        kind,
      });
    }
  }

  const sortMode = readWebFileSortMode();
  const sorted = sortNodes(nodes, sortMode);
  // Le tri manuel (order.json) ne s'applique qu'en mode 'manual', comme
  // côté desktop — un ordre enregistré reste ignoré (pas supprimé) dans
  // les autres modes.
  if (sortMode === 'manual') {
    return applyManualOrder(sorted, order[prefix]);
  }
  return sorted;
}

async function requireActiveRoot(): Promise<FsaDirectoryHandleLike> {
  const root = await webVaultRegistry.getActiveHandle();
  if (!root) throw new Error('Aucun vault sélectionné');
  return root;
}

// .123ecriture/state.json — port direct de readVaultState/writeVaultState
// (vault.ts) : DEUX champs (dernier fichier ouvert + dossiers repliés) dans
// UN fichier lu en read-modify-write, pour que deux écrivains indépendants
// ne s'écrasent pas mutuellement.
type VaultState = {
  lastOpenedRelPath?: string | null;
  collapsedRelPaths?: string[];
};

async function readVaultState(root: FsaDirectoryHandleLike): Promise<VaultState> {
  try {
    const data = JSON.parse(await readFileText(root, '.123ecriture/state.json')) as VaultState;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

async function writeVaultState(root: FsaDirectoryHandleLike, patch: VaultState): Promise<void> {
  const next = { ...(await readVaultState(root)), ...patch };
  await writeFileText(root, '.123ecriture/state.json', JSON.stringify(next, null, 2));
}

async function readOrder(root: FsaDirectoryHandleLike): Promise<VaultOrder> {
  try {
    return JSON.parse(await readFileText(root, '.123ecriture/order.json')) as VaultOrder;
  } catch {
    return {};
  }
}

// //4. ✍️ CRÉATION / ÉCRITURE
// ////////////////////////////////////////////////////////////////////////

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function baseNameWithoutExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

async function statModifiedAt(root: FsaDirectoryHandleLike, relPath: string): Promise<number> {
  try {
    const file = await (await getFileByRelPath(root, relPath)).getFile();
    return file.lastModified;
  } catch {
    return Date.now();
  }
}

export const webVaultAdapter = {
  // Port de vault:choose-folder → pickAndAddExistingVault : ouvre le
  // sélecteur de dossier du navigateur (geste utilisateur requis — c'est le
  // cas de tous les boutons qui appellent cette méthode), ajoute + active le
  // coffre dans le registre, puis notifie via onChanged (VaultsContext se
  // met à jour, comme avec l'évènement vaults:changed d'Electron).
  chooseFolder: async (): Promise<string | null> => {
    if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
      throw new Error(
        'Ce navigateur ne prend pas en charge le choix de dossier local (File System Access API). Utilises Chrome, Edge ou un Chromium récent.',
      );
    }
    // mode 'readwrite' dès l'ouverture : la permission d'écriture est le
    // seul usage réel du coffre, la demander séparément produirait deux
    // boîtes de dialogue pour rien.
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await webVaultRegistry.addExisting(handle);
    return handle.name;
  },

  getCurrentPath: async (): Promise<string | null> => {
    const root = await webVaultRegistry.getActiveHandle();
    return root ? root.name : null;
  },

  listTree: async (): Promise<VaultTreeNode[]> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return [];
    return walkTree(root, '', await readOrder(root));
  },

  reorder: async (parentRelPath: string | undefined, orderedNames: string[]): Promise<VaultTreeNode[]> => {
    const root = await requireActiveRoot();
    if (!Array.isArray(orderedNames)) throw new Error('Ordre invalide.');
    const order = await readOrder(root);
    order[parentRelPath ?? ''] = orderedNames;
    await writeFileText(root, '.123ecriture/order.json', JSON.stringify(order, null, 2));
    return walkTree(root, '', order);
  },

  readNote: async (relPath: string): Promise<string> => {
    const root = await requireActiveRoot();
    return readFileText(root, relPath);
  },

  writeNote: async (relPath: string, content: string): Promise<void> => {
    const root = await requireActiveRoot();
    await writeFileText(root, relPath, content);
  },

  createNote: async (name: string, parentRelPath?: string, kind?: VaultEntryKind): Promise<VaultEntry> => {
    const root = await requireActiveRoot();
    const parent = parentRelPath ? await getDirByRelPath(root, parentRelPath, true) : root;

    const safeKind = kind && kind in KIND_TO_EXTENSION ? kind : 'markdown';
    const extension = KIND_TO_EXTENSION[safeKind];
    const safeName = name && name.trim().length > 0 ? name.trim() : 'Sans titre';
    const fileName = await findAvailableName(parent, safeName, extension);
    const relPath = parentRelPath ? `${parentRelPath}/${fileName}` : fileName;
    await writeFileText(root, relPath, defaultContentForKind(safeKind, safeName));

    return {
      relPath,
      name: fileName.slice(0, -extension.length),
      modifiedAt: await statModifiedAt(root, relPath),
      kind: safeKind,
    };
  },

  createFolder: async (name: string, parentRelPath?: string): Promise<VaultFolderEntry> => {
    const root = await requireActiveRoot();
    const parent = parentRelPath ? await getDirByRelPath(root, parentRelPath, true) : root;
    const safeName = name && name.trim().length > 0 ? name.trim() : 'Nouveau dossier';
    const folderName = await findAvailableName(parent, safeName);
    await parent.getDirectoryHandle(folderName, { create: true });
    return {
      relPath: parentRelPath ? `${parentRelPath}/${folderName}` : folderName,
      name: folderName,
    };
  },

  // Copie identifiable « (copie) », « (copie 2) »... dans le MÊME dossier —
  // port direct du handler vault:duplicate (même commentaire côté desktop :
  // partir d'un gabarit sans repartir de zéro).
  duplicate: async (relPath: string): Promise<VaultEntry> => {
    const root = await requireActiveRoot();
    const fileName = splitRelPath(relPath).pop() ?? '';
    const extension = extensionOf(fileName);
    const baseName = baseNameWithoutExtension(fileName);
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const parent = await getDirByRelPath(root, parentRelPath);

    let candidateName = `${baseName} (copie)`;
    let counter = 2;
    while (await entryExists(parent, `${candidateName}${extension}`)) {
      candidateName = `${baseName} (copie ${counter})`;
      counter += 1;
    }

    const content = await readFileText(root, relPath);
    const finalRelPath = parentRelPath ? `${parentRelPath}/${candidateName}${extension}` : `${candidateName}${extension}`;
    await writeFileText(root, finalRelPath, content);

    return {
      relPath: finalRelPath,
      name: candidateName,
      modifiedAt: await statModifiedAt(root, finalRelPath),
      kind: EXTENSION_TO_KIND[extension] ?? 'markdown',
    };
  },

  // Note journalière Journal/AAAA-MM-JJ.mdx, idempotente, avec repli sur un
  // `.md` déjà existant — port direct de vault:ensure-daily-note.
  ensureDailyNote: async (dateIso: string): Promise<VaultEntry> => {
    const root = await requireActiveRoot();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso ?? '')) {
      throw new Error('Date invalide (attendu AAAA-MM-JJ).');
    }
    await getDirByRelPath(root, 'Journal', true);
    const mdxRelPath = `Journal/${dateIso}.mdx`;
    const mdRelPath = `Journal/${dateIso}.md`;
    const mdExists = await entryExists(root, mdRelPath);
    const mdxExists = await entryExists(root, mdxRelPath);
    const targetRelPath = mdExists && !mdxExists ? mdRelPath : mdxRelPath;

    if (!(await entryExists(root, targetRelPath))) {
      const template = `---\ntitle: ${dateIso}\ncreated: ${new Date().toISOString()}\n---\n\n`;
      await writeFileText(root, targetRelPath, template);
    }
    return {
      relPath: targetRelPath,
      name: dateIso,
      modifiedAt: await statModifiedAt(root, targetRelPath),
      kind: 'markdown',
    };
  },

  // Pièce jointe : showOpenFilePicker (équivalent navigateur du
  // dialog.showOpenDialog desktop) → copie dans le dossier de pièces
  // jointes (préférences, défaut `attachments/`) à la racine du coffre,
  // dédoublonnage inclus — même disposition que desktop pour qu'une note
  // référencée par `![[nom]]` reste valide sur les deux plateformes.
  importAttachment: async (): Promise<{ relPath: string; name: string } | null> => {
    const root = await requireActiveRoot();
    if (typeof window === 'undefined' || typeof window.showOpenFilePicker !== 'function') {
      throw new Error('Ce navigateur ne prend pas en charge l’import de fichier local.');
    }
    const [handle] = await window.showOpenFilePicker({ multiple: false });
    const file = await handle.getFile();

    const attachmentsDir = await getDirByRelPath(root, readWebAttachmentsFolder(), true);
    const extension = extensionOf(file.name);
    const baseName = baseNameWithoutExtension(file.name);
    const finalName = await findAvailableName(attachmentsDir, baseName, extension);
    const writable = await attachmentsDir.getFileHandle(finalName, { create: true }).then((h) => h.createWritable());
    await writable.write(file);
    await writable.close();

    const folder = readWebAttachmentsFolder();
    return { relPath: `${folder}/${finalName}`, name: finalName };
  },

  // Contenu d'une pièce jointe en URI data: — lecture binaire + base64 par
  // tranches (String.fromCharCode direct casse au-delà de ~100 Ko).
  readAttachmentDataUrl: async (relPath: string): Promise<string> => {
    const root = await requireActiveRoot();
    const folder = readWebAttachmentsFolder();
    const target = relPath && relPath.includes('/') ? relPath : `${folder}/${relPath ?? ''}`;
    const file = await (await getFileByRelPath(root, target)).getFile();
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const CHUNK = 0x8000;
    for (let offset = 0; offset < buffer.length; offset += CHUNK) {
      binary += String.fromCharCode(...buffer.subarray(offset, offset + CHUNK));
    }
    return `data:${guessMimeType(file.name)};base64,${btoa(binary)}`;
  },

  // //5. 🔀 ORGANISATION (rename / move / set-path / delete)
  ////////////////////////////////////////////////////////////////////////

  // Renomme dans le même dossier, jamais de séparateur dans le nom,
  // extension réelle préservée (`.canvas` reste `.canvas` — le bug desktop
  // historique documenté dans vault:rename). FSA : copier puis supprimer.
  rename: async (relPath: string, newName: string) => {
    const root = await requireActiveRoot();
    const segments = splitRelPath(relPath);
    const oldName = segments.pop();
    if (!oldName) throw new Error('Élément introuvable.');
    const parentRelPath = segments.join('/');
    const parent = await getDirByRelPath(root, parentRelPath);

    const extension = extensionOf(oldName);
    const isNote = extension !== '' && (await fileExistsAt(parent, oldName));
    const trimmed = (newName ?? '').trim().replace(/[/\\]/g, '');
    if (!trimmed) throw new Error('Le nom ne peut pas être vide.');

    const baseName =
      isNote && extension ? trimmed.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : trimmed;
    const finalName = isNote ? `${baseName}${extension}` : trimmed;

    if (finalName !== oldName && (await entryExists(parent, finalName))) {
      throw new Error(`"${finalName}" existe déjà à cet endroit.`);
    }

    if (finalName !== oldName) {
      await moveWithinParent(parent, oldName, finalName);
    }
    const newRelPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    return { relPath: newRelPath, name: baseName };
  },

  // Déplace vers un autre dossier (ou la racine) — mêmes garde-fous que
  // desktop : pas de dossier dans lui-même, collision dédoublonnée à
  // destination (" 2", " 3"...).
  move: async (relPath: string, destinationParentRelPath?: string) => {
    const root = await requireActiveRoot();
    const segments = splitRelPath(relPath);
    const name = segments.pop();
    if (!name) throw new Error('Élément introuvable.');
    const parentRelPath = segments.join('/');
    const parent = await getDirByRelPath(root, parentRelPath);
    const destination = destinationParentRelPath
      ? await getDirByRelPath(root, destinationParentRelPath)
      : root;

    // Un dossier ne peut pas être déplacé dans lui-même ni dans un de ses
    // sous-dossiers : en web, la destination est un ancêtre du chemin source
    // si ses segments sont un PRÉFIXE de ceux du chemin COMPLET (comparaison
    // de segments, jamais de chaînes) — attention à utiliser le chemin
    // source entier, pas le parent déjà amputé du nom.
    const sourceFullSegments = splitRelPath(relPath);
    const destinationSegments = destinationParentRelPath ? splitRelPath(destinationParentRelPath) : [];
    if (
      destinationSegments.length >= sourceFullSegments.length &&
      destinationSegments.slice(0, sourceFullSegments.length).join('/') === sourceFullSegments.join('/')
    ) {
      throw new Error('Impossible de déplacer un dossier dans lui-même ou l’un de ses sous-dossiers.');
    }

    // Déjà dans le dossier de destination — no-op (même comportement que
    // desktop : jamais de dédoublonnage erroné "notes 2.md" pour un
    // déplacement vers le dossier d'origine). Comparaison de CHEMINS, pas
    // d'objets handle (FSA ne garantit pas l'identité d'objet).
    if ((destinationParentRelPath ?? '') === parentRelPath) {
      return { relPath, name: baseNameWithoutExtension(name) };
    }

    const oldEntry = await getChildHandle(parent, name);
    const isNote = oldEntry.kind === 'file';
    const extension = isNote ? extensionOf(name) : '';
    const baseName = isNote ? baseNameWithoutExtension(name) : name;
    const finalName = isNote
      ? await findAvailableName(destination, baseName, extension)
      : await findAvailableName(destination, baseName);

    await moveHandle(parent, name, destination, finalName);
    const finalRelPath = destinationParentRelPath
      ? `${destinationParentRelPath}/${finalName}`
      : finalName;
    return {
      relPath: finalRelPath,
      name: isNote && extension ? finalName.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : finalName,
    };
  },

  // Édition manuelle du chemin complet — crée les dossiers intermédiaires,
  // AUCUN dédoublonnage (collision = erreur, port direct de vault:set-path).
  setPath: async (relPath: string, newRelPath: string) => {
    const root = await requireActiveRoot();
    const sourceSegments = splitRelPath(relPath);
    const oldName = sourceSegments.pop();
    if (!oldName) throw new Error('Élément introuvable.');
    const parentRelPath = sourceSegments.join('/');
    const parent = await getDirByRelPath(root, parentRelPath);

    const extension = extensionOf(oldName);
    const isNote = extension !== '' && (await fileExistsAt(parent, oldName));

    const trimmed = (newRelPath ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!trimmed) throw new Error('Le chemin ne peut pas être vide.');
    if (trimmed.split('/').some((segment) => segment.trim() === '' || segment === '.' || segment === '..')) {
      throw new Error('Chemin invalide.');
    }

    const strippedTrimmed =
      isNote && extension ? trimmed.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : trimmed;
    const finalRelPath = isNote ? `${strippedTrimmed}${extension}` : trimmed;

    if (finalRelPath === relPath) {
      return {
        relPath,
        name: isNote ? baseNameWithoutExtension(oldName) : oldName,
      };
    }

    const destinationSegments = splitRelPath(finalRelPath);
    const destinationName = destinationSegments.pop() as string;
    if (
      !isNote &&
      destinationSegments.length >= sourceSegments.length &&
      destinationSegments.slice(0, sourceSegments.length).join('/') === sourceSegments.join('/')
    ) {
      throw new Error('Impossible de déplacer un dossier dans lui-même ou l’un de ses sous-dossiers.');
    }
    const destinationParent = await getDirByRelPath(root, destinationSegments.join('/'), true);
    if (await entryExists(destinationParent, destinationName)) {
      throw new Error(`"${finalRelPath}" existe déjà.`);
    }

    await moveHandle(parent, oldName, destinationParent, destinationName);
    return {
      relPath: finalRelPath,
      name: isNote ? baseNameWithoutExtension(destinationName) : destinationName,
    };
  },

  // Confirmation window.confirm avant toute suppression (équivalent de la
  // boîte native desktop — jamais de suppression silencieuse), puis
  // removeEntry récursif.
  delete: async (relPath: string) => {
    const root = await requireActiveRoot();
    const segments = splitRelPath(relPath);
    const name = segments.pop();
    if (!name) throw new Error('Élément introuvable.');
    const parent = await getDirByRelPath(root, segments.join('/'));

    const entry = await getChildHandle(parent, name);
    const isFolder = entry.kind === 'directory';
    const confirmed = window.confirm(
      isFolder
        ? `Supprimer le dossier « ${name} » ?\n\nCe dossier et TOUT son contenu (notes, sous-dossiers, pièces jointes qu’il contient) seront supprimés définitivement.`
        : `Supprimer « ${name} » ?\n\nCette note sera supprimée définitivement.`,
    );
    if (!confirmed) return { deleted: false };

    await removeEntryRecursive(parent, name);
    return { deleted: true };
  },

  getLastOpened: async (): Promise<string | null> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return null;
    return (await readVaultState(root)).lastOpenedRelPath ?? null;
  },

  setLastOpened: async (relPath: string | null): Promise<void> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return;
    await writeVaultState(root, { lastOpenedRelPath: relPath });
  },

  getCollapsedPaths: async (): Promise<string[]> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return [];
    const collapsed = (await readVaultState(root)).collapsedRelPaths;
    return Array.isArray(collapsed) ? collapsed.filter((p): p is string => typeof p === 'string') : [];
  },

  setCollapsedPaths: async (relPaths: string[]): Promise<void> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return;
    await writeVaultState(root, { collapsedRelPaths: Array.isArray(relPaths) ? relPaths : [] });
  },

  // Vue Tags — port direct de listTags (search.ts desktop), réutilisant le
  // même parseur frontmatter que le reste de l'app (apps/mobile/lib, ici on
  // EST dans le bon paquet : pas de duplication nécessaire).
  listTags: async (): Promise<TagGroup[]> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return [];
    const TAG_PATTERN = /(^|[\s])#([\p{L}\p{N}_-]+)/gu;
    const notesByTag = new Map<string, { relPath: string; name: string }[]>();

    for (const relPath of await listNoteRelPathsAll(root)) {
      let content: string;
      try {
        content = await readFileText(root, relPath);
      } catch {
        continue; // Fichier illisible entre le listage et la lecture — ignoré.
      }
      const name = baseNameWithoutExtension(splitRelPath(relPath).pop() ?? '');
      const { body } = parseFrontmatter(content);
      const tags = new Set<string>();
      for (const match of body.matchAll(TAG_PATTERN)) {
        tags.add(match[2].toLowerCase());
      }
      for (const tag of tags) {
        const notes = notesByTag.get(tag) ?? [];
        notes.push({ relPath, name });
        notesByTag.set(tag, notes);
      }
    }

    return [...notesByTag.entries()]
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
  },
} satisfies VaultBridge;

// //6. 🔧 UTILITAIRES LOCAUX (handles enfants, déplacement)
// ////////////////////////////////////////////////////////////////////////

async function getChildHandle(
  parent: FsaDirectoryHandleLike,
  name: string,
): Promise<FsaFileHandleLike | FsaDirectoryHandleLike> {
  try {
    return await parent.getFileHandle(name);
  } catch {
    return parent.getDirectoryHandle(name);
  }
}

async function fileExistsAt(parent: FsaDirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await parent.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

// Déplacement au sein d'un même parent (rename) — la FSA n'a pas de rename
// natif : copier le contenu puis supprimer l'original (fichier binaire via
// Blob, dossier par copie récursive).
async function moveWithinParent(
  parent: FsaDirectoryHandleLike,
  oldName: string,
  finalName: string,
): Promise<void> {
  const child = await getChildHandle(parent, oldName);
  if (child.kind === 'directory') {
    await copyDirectoryInto(child, parent, finalName);
  } else {
    const file = await child.getFile();
    const writable = await parent.getFileHandle(finalName, { create: true }).then((h) => h.createWritable());
    await writable.write(file);
    await writable.close();
  }
  await removeEntryRecursive(parent, oldName);
}

// Déplacement vers un autre parent (move/setPath) — même stratégie.
async function moveHandle(
  parent: FsaDirectoryHandleLike,
  name: string,
  destination: FsaDirectoryHandleLike,
  finalName: string,
): Promise<void> {
  const child = await getChildHandle(parent, name);
  if (child.kind === 'directory') {
    await copyDirectoryInto(child, destination, finalName);
  } else {
    const file = await child.getFile();
    const writable = await destination.getFileHandle(finalName, { create: true }).then((h) => h.createWritable());
    await writable.write(file);
    await writable.close();
  }
  await removeEntryRecursive(parent, name);
}

// Liste les notes (`.mdx` + `.md`) de tout le coffre — wrapper fin autour de
// listNoteRelPaths (webFs.ts) avec les DEUX extensions (même raison que
// walkNoteFiles côté properties.ts) : une note importée en `.md` porte ses
// tags comme une `.mdx`.
async function listNoteRelPathsAll(root: FsaDirectoryHandleLike): Promise<string[]> {
  return listNoteRelPaths(root, ['.mdx', '.md']);
}
