//////////////////////////////////////////////////////////////////////////////
//                                 vault.ts                                 //  
//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
//
// Backend PROCESS MAIN de tout ce qui touche aux fichiers du coffre actif :
// lire, créer, dupliquer, renommer, déplacer, supprimer, réordonner, et
// construire l'arborescence affichée par l'explorateur. Chaque opération est
// exposée au renderer par un handler IPC `vault:*` ; le renderer est
// sandboxé (contextIsolation, pas de nodeIntegration) et ne touche jamais
// au disque directement — tout passe par ici. Côté renderer :
// VaultTreeView.tsx (rendu de l'explorateur), NotesScreen.tsx
// (glisser-déposer, clic droit, ouverture par défaut), FilesLinksSection.tsx
// (réglages).
//
// Invariants du fichier :
//   • Aucun chemin de coffre en dur : getVaultPath() délègue au coffre
//     ACTIF du registre (vaults.ts) — un seul point de couture entre ce
//     backend et le registre multi-coffres.
//   • Tout relPath reçu d'IPC passe par resolveInVault : résolu puis borné
//     au dossier du coffre, refusé sinon — on ne fait jamais confiance à un
//     chemin venu du renderer.
//   • EXTENSION_TO_KIND est la liste faisant foi des extensions reconnues
//     comme contenu du coffre : walkTree (arborescence) et la synchro
//     (sync.ts, walkAndHash) couvrent exactement les mêmes extensions,
//     sinon un fichier est visible d'un côté et invisible de l'autre, en
//     silence.
//   • Supprimer ne détruit rien : l'élément est déplacé vers `.trash/`
//     (corbeille du coffre, structure miroir, synchronisée entre appareils)
//     — seule une suppression explicite depuis la corbeille détruit.
//   • L'état d'UI PAR coffre (dernier fichier ouvert, dossiers repliés,
//     onglets ouverts) vit dans `.123ecriture/state.json`, un seul objet lu
//     et écrit en read-modify-write.
//
// SOMMAIRE :
//   1. Types de fichiers et gabarits (extensions, kind, contenu initial)
//   2. Résolution de chemin et utilitaires
//   3. Ordre des fichiers (tri automatique + ordre manuel order.json)
//   4. État par coffre (state.json : dernier ouvert, replis, onglets)
//   5. Arborescence (walkTree : disque + tri + ordre)
//   6. Handlers IPC — lecture
//   7. Handlers IPC — création/écriture
//   8. Handlers IPC — organisation (renommer/déplacer/supprimer)
//
//////////////////////////////////////////////////////////////////////////////

import { dialog, ipcMain, type BrowserWindow } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import {
  getAttachmentsFolder,
  guessMimeType,
  defaultContentForKind,
  getVaultPath,
  resolveInVault,
  findAttachmentByRelPath,
  moveToVaultTrash,
  pruneEmptyAncestors,
  escapeRegExp,
  findAvailableName,
  readOrder,
  writeOrder,
  readLastOpened,
  writeLastOpened,
  readCollapsedRelPaths,
  writeCollapsedRelPaths,
  readOpenTabRelPaths,
  writeOpenTabRelPaths,
  walkTree,
  EXTENSION_TO_KIND,
  KIND_TO_EXTENSION,
  TRASH_FOLDER,
} from './coffre-outils';
export { EXTENSION_TO_KIND, resolveInVault, getVaultPath, walkTree } from './coffre-outils';
import * as vaults from './vaults';
import type { VaultEntryKind } from '../types';
import { isCodeFile } from '../../../mobile/lib/editor/codeLanguages';
// Critères de résolution des cibles d'embed façon Obsidian (chemin exact →
// suffixe → nom seul, casse ignorée) — fonction PURE partagée avec le port
// web (webVaultAdapter.ts) et le Live Preview, importée telle quelle comme
// frontmatterMigration/propertyScanMerge (esbuild bundle l'import
// cross-package).
// Liste des extensions reconnues comme fichiers CODE (.py/.ts/.js/…) —
// source de vérité unique partagée avec les adaptateurs web/natif (même
// modèle d'import cross-package que embedResolution ci-dessus).

type GetWindow = () => BrowserWindow | null;

export function registerVaultHandlers(getWindow: GetWindow): void {
  //////// 6. Handlers IPC — lecture ///////////////////////////////////////

  // Ajoute+active le dossier choisi dans le registre multi-coffres (via
  // vaults.ts) et diffuse le changement — consommé par NotesScreen.tsx/
  // TasksScreen.tsx (écran vide "Choisir un dossier"). Aucun `vaultPath`
  // isolé n'est écrit ici : tout passe par le registre.
  ipcMain.handle('vault:choose-folder', async () => {
    const vault = await vaults.pickAndAddExistingVault();
    if (vault) vaults.broadcastVaultsChanged(getWindow);
    return getVaultPath();
  });

  ipcMain.handle('vault:get-current-path', () => getVaultPath());

  ipcMain.handle('vault:list-tree', async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return walkTree(vaultPath, vaultPath, readOrder(vaultPath));
  });

  // Persiste l'ordre manuel des enfants d'un dossier (glisser pour
  // réordonner, voir NotesScreen.tsx) et renvoie l'arborescence à jour —
  // même forme de réponse que vault:list-tree, pour éviter un aller-retour
  // supplémentaire côté renderer après un reorder.
  ipcMain.handle('vault:reorder', async (_event, parentRelPath: string | undefined, orderedNames: unknown) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    if (!Array.isArray(orderedNames)) throw new Error('Ordre invalide.');

    const order = readOrder(vaultPath);
    order[parentRelPath ?? ''] = orderedNames as string[];
    await writeOrder(vaultPath, order);
    return walkTree(vaultPath, vaultPath, order);
  });

  ipcMain.handle('vault:read-note', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    return fs.readFile(resolveInVault(vaultPath, relPath), 'utf8');
  });

  // PIÈCES JOINTES SYNCHRONISÉES : lecture/écriture BINAIRE (base64) pour
  // les fichiers non-texte (images, PDF, audio…) — le moteur de synchro
  // les utilise pour les push/pull des pièces jointes.
  ipcMain.handle('vault:read-note-binary', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    return (await fs.readFile(resolveInVault(vaultPath, relPath))).toString('base64');
  });

  ipcMain.handle('vault:write-note-binary', async (_event, relPath: string, base64: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const fullPath = resolveInVault(vaultPath, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.from(base64, 'base64'));
  });

  // Dates du fichier (matérialisation de created/modified dans le
  // frontmatter à la sauvegarde, voir NotesScreen.tsx) — birthtime peut
  // valoir 0 sur certains systèmes de fichiers/réseaux : repli sur mtime
  // plutôt que d'écrire une date de création impossible.
  ipcMain.handle('vault:get-timestamps', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const stat = await fs.stat(resolveInVault(vaultPath, relPath));
    return {
      createdAt: stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs,
      modifiedAt: stat.mtimeMs,
    };
  });

  //////// 7. Handlers IPC — création/écriture /////////////////////////////

  ipcMain.handle('vault:write-note', async (_event, relPath: string, content: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const fullPath = resolveInVault(vaultPath, relPath);
    // Le pull cloud dépose des notes dans des sous-dossiers qui n'existent
    // pas encore localement (récupération d'un coffre distant dans un
    // dossier vide) — sans mkdir, writeFile échoue avec ENOENT.
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  });

  // `parentRelPath` optionnel : crée à la racine du vault si omis, sinon
  // dans le dossier visé (clic droit sur un dossier → "Nouvelle note ici").
  // `kind` optionnel (défaut 'markdown') : voir EXTENSION_TO_KIND/
  // defaultContentForKind — même handler pour note/canvas/graphique, seul le
  // gabarit change (clic droit → "Nouveau canvas"/"Nouveau graphique").
  ipcMain.handle(
    'vault:create-note',
    async (_event, name: string, parentRelPath: string | undefined, kind: string | undefined) => {
      const vaultPath = getVaultPath();
      if (!vaultPath) throw new Error('Aucun vault sélectionné');
      const parentFull = parentRelPath ? resolveInVault(vaultPath, parentRelPath) : vaultPath;

      const safeKind: VaultEntryKind = kind && kind in KIND_TO_EXTENSION ? (kind as VaultEntryKind) : 'markdown';
      const safeName = name && name.trim().length > 0 ? name.trim() : 'Sans titre';
      // Pour le CODE, l'extension vient du NOM fourni (`Sans titre.py`) —
      // chaque langage a la sienne ; elle est reprise telle quelle si
      // reconnue (lib/codeLanguages.ts), sinon retenue par défaut .js. Pour
      // les autres kinds, l'extension est fixe (KIND_TO_EXTENSION).
      let extension: string;
      let baseName: string;
      if (safeKind === 'code') {
        const fromName = (safeName.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
        extension = isCodeFile(`x${fromName}`) ? fromName : KIND_TO_EXTENSION.code;
        baseName = fromName ? safeName.slice(0, safeName.length - fromName.length) : safeName;
        if (!baseName.trim()) baseName = 'Sans titre';
      } else {
        extension = KIND_TO_EXTENSION[safeKind];
        baseName = safeName;
      }
      const safeNameForFile = baseName;
      const fileName = findAvailableName(parentFull, safeNameForFile, extension);
      const fullPath = path.join(parentFull, fileName);
      await fs.writeFile(fullPath, defaultContentForKind(safeKind, safeNameForFile), 'utf8');
      const stat = await fs.stat(fullPath);

      return {
        relPath: path.relative(vaultPath, fullPath),
        name: fileName.slice(0, -extension.length),
        modifiedAt: stat.mtimeMs,
        kind: safeKind,
      };
    },
  );

  // Duplique une note/canvas/graphique/excalidraw existant dans SON PROPRE
  // dossier — utile pour partir d'un gabarit sans repartir de zéro (voir
  // NotesScreen.tsx, menu contextuel "Dupliquer"). Suffixe explicite
  // " (copie)", puis " (copie 2)"... en cas de collision, plutôt que
  // `findAvailableName` telle quelle (qui suffixerait juste " 2", " 3"...) :
  // une copie doit rester identifiable comme telle, pas ressembler à une
  // note distincte du même nom numéroté.
  ipcMain.handle('vault:duplicate', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const sourceFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(sourceFull) || !fsSync.statSync(sourceFull).isFile()) {
      throw new Error('Élément introuvable.');
    }

    const extension = path.extname(sourceFull);
    const baseName = path.basename(sourceFull, extension);
    const dir = path.dirname(sourceFull);
    const kind: VaultEntryKind = EXTENSION_TO_KIND[extension] ?? 'markdown';

    let candidateName = `${baseName} (copie)`;
    let counter = 2;
    while (fsSync.existsSync(path.join(dir, `${candidateName}${extension}`))) {
      candidateName = `${baseName} (copie ${counter})`;
      counter += 1;
    }

    const content = await fs.readFile(sourceFull, 'utf8');
    const destFull = path.join(dir, `${candidateName}${extension}`);
    await fs.writeFile(destFull, content, 'utf8');
    const stat = await fs.stat(destFull);

    return {
      relPath: path.relative(vaultPath, destFull),
      name: candidateName,
      modifiedAt: stat.mtimeMs,
      kind,
    };
  });

  ipcMain.handle('vault:create-folder', async (_event, name: string, parentRelPath: string | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const parentFull = parentRelPath ? resolveInVault(vaultPath, parentRelPath) : vaultPath;

    const safeName = name && name.trim().length > 0 ? name.trim() : 'Nouveau dossier';
    const folderName = findAvailableName(parentFull, safeName);
    const fullPath = path.join(parentFull, folderName);
    await fs.mkdir(fullPath);

    return { relPath: path.relative(vaultPath, fullPath), name: folderName };
  });

  // Note journalière — voir apps/mobile/components/CalendarScreen.tsx.
  // Convention de CHEMIN plutôt que propriété frontmatter interrogeable (le
  // vault n'a pas encore de système de propriétés — hors périmètre) : un
  // dossier fixe `Journal/`, un fichier par jour nommé AAAA-MM-JJ.mdx.
  // Idempotent : si la note existe déjà, la renvoie telle quelle sans la
  // toucher (jamais d'écrasement d'une note journalière déjà écrite).
  ipcMain.handle('vault:ensure-daily-note', async (_event, dateIso: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso ?? '')) {
      throw new Error('Date invalide (attendu AAAA-MM-JJ).');
    }

    const folderFull = path.join(vaultPath, 'Journal');
    await fs.mkdir(folderFull, { recursive: true });
    const mdxPath = path.join(folderFull, `${dateIso}.mdx`);
    // Une note journalière du jour peut déjà exister en `.md` (import
    // Obsidian, plugin Daily Notes natif) — la retrouver plutôt que de
    // créer un doublon `.mdx` à côté.
    const mdPath = path.join(folderFull, `${dateIso}.md`);
    const fullPath = fsSync.existsSync(mdPath) && !fsSync.existsSync(mdxPath) ? mdPath : mdxPath;

    if (!fsSync.existsSync(fullPath)) {
      const template = `---\ntitle: ${dateIso}\ncreated: ${new Date().toISOString()}\n---\n\n`;
      await fs.writeFile(fullPath, template, 'utf8');
    }
    const stat = await fs.stat(fullPath);

    return {
      relPath: path.relative(vaultPath, fullPath),
      name: dateIso,
      modifiedAt: stat.mtimeMs,
    };
  });

  // Pièce jointe (image/audio/fichier) pour une note — voir
  // apps/mobile/components/NoteRenderer.tsx (rendu de `![[...]]`, syntaxe
  // d'embed Obsidian). Copiée dans un dossier `attachments/` à la RACINE du
  // vault (pas à côté de la note) : une pièce jointe référencée par son seul
  // nom reste valide même si la note qui la référence est ensuite déplacée/
  // renommée — un dossier par note casserait ce lien à chaque déplacement.
  ipcMain.handle('vault:import-attachment', async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;

    const sourcePath = result.filePaths[0];
    const attachmentsDir = path.join(vaultPath, getAttachmentsFolder());
    await fs.mkdir(attachmentsDir, { recursive: true });
    const extension = path.extname(sourcePath);
    const baseName = path.basename(sourcePath, extension);
    const finalName = findAvailableName(attachmentsDir, baseName, extension);
    const destPath = path.join(attachmentsDir, finalName);
    await fs.copyFile(sourcePath, destPath);

    return { relPath: path.relative(vaultPath, destPath), name: finalName };
  });

  // Contenu d'une pièce jointe en URI `data:` (image/audio affichés inline
  // dans NoteRenderer.tsx et le widget image du Live Preview) — plus simple
  // et plus fiable ici qu'un protocole personnalisé dédié (le renderer
  // charge déjà tout via `app://`/le serveur de dev Expo, un `file://`
  // direct se heurterait aux règles de sécurité de Chromium selon
  // l'origine). RÉSOLUTION FAÇON OBSIDIAN (voir lib/embedResolution.ts) :
  // 1) le chemin tel que référencé, 2) `attachments/<nom>` (convention de
  // l'app, voir import-attachment), 3) recherche PAR NOM dans tout le
  // coffre — les coffres importés d'Obsidian écrivent `![[image.png]]`
  // alors que l'image vit n'importe où (« Pièces jointes/ », sous-dossier,
  // à côté de la note…) : sans l'étape 3, tout embed d'un coffre importé
  // reste « pièce jointe introuvable ».
  ipcMain.handle('vault:read-attachment-data-url', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const wanted = (relPath ?? '').trim();
    if (!wanted) throw new Error('Pièce jointe : chemin vide.');

    const candidates = [wanted];
    if (!wanted.includes('/')) candidates.push(path.join(getAttachmentsFolder(), wanted));
    for (const candidate of candidates) {
      const fullPath = resolveInVault(vaultPath, candidate);
      if (fsSync.existsSync(fullPath) && fsSync.statSync(fullPath).isFile()) {
        const buffer = await fs.readFile(fullPath);
        return `data:${guessMimeType(fullPath)};base64,${buffer.toString('base64')}`;
      }
    }

    const found = await findAttachmentByRelPath(vaultPath, wanted);
    if (!found) throw new Error(`Pièce jointe introuvable : ${wanted}`);
    const buffer = await fs.readFile(found);
    return `data:${guessMimeType(found)};base64,${buffer.toString('base64')}`;
  });

  //////// 8. Handlers IPC — organisation (renommer/déplacer/supprimer) ////

  // Renomme une note ou un dossier (détection automatique du type via
  // fs.stat) — reste dans le même dossier parent, pas de déplacement.
  ipcMain.handle('vault:rename', async (_event, relPath: string, newName: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const oldFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(oldFull)) throw new Error('Élément introuvable.');
    const isNote = fsSync.statSync(oldFull).isFile();
    // Préserve l'extension RÉELLE du fichier (`.mdx`, `.md`, `.canvas`,
    // `.chart`...) plutôt que de forcer `.mdx` sur tout — forcer `.mdx`
    // donnerait `truc.canvas.mdx`, extension reconnue par aucun kind : le
    // fichier disparaîtrait de l'arborescence.
    const extension = isNote ? path.extname(oldFull) : '';

    // Un nom ne doit pas pouvoir contenir de séparateur de chemin : un
    // renommage reste un renommage, pas un déplacement déguisé.
    const trimmed = (newName ?? '').trim().replace(/[/\\]/g, '');
    if (!trimmed) throw new Error('Le nom ne peut pas être vide.');

    const baseName = isNote && extension ? trimmed.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : trimmed;
    const finalName = isNote ? `${baseName}${extension}` : baseName;
    const parentDir = path.dirname(oldFull);
    const newFull = path.join(parentDir, finalName);

    if (newFull !== oldFull && fsSync.existsSync(newFull)) {
      throw new Error(`"${finalName}" existe déjà à cet endroit.`);
    }

    await fs.rename(oldFull, newFull);
    return { relPath: path.relative(vaultPath, newFull), name: baseName };
  });

  // Déplace une note ou un dossier vers un autre dossier du vault (ou la
  // racine si destinationParentRelPath est omis). Contrairement à
  // vault:rename, ça change le dossier parent — le nom reste le même sauf
  // collision à destination.
  ipcMain.handle('vault:move', async (_event, relPath: string, destinationParentRelPath: string | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const oldFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(oldFull)) throw new Error('Élément introuvable.');

    const destFull = destinationParentRelPath
      ? resolveInVault(vaultPath, destinationParentRelPath)
      : vaultPath;
    if (!fsSync.existsSync(destFull) || !fsSync.statSync(destFull).isDirectory()) {
      throw new Error('Destination invalide.');
    }

    // Un dossier ne peut pas être déplacé dans lui-même ni dans l'un de ses
    // propres sous-dossiers (casserait l'arborescence).
    if (destFull === oldFull || destFull.startsWith(oldFull + path.sep)) {
      throw new Error('Impossible de déplacer un dossier dans lui-même ou l’un de ses sous-dossiers.');
    }

    const isNote = fsSync.statSync(oldFull).isFile();
    // Préserve l'extension réelle (voir vault:rename ci-dessus).
    const extension = isNote ? path.extname(oldFull) : '';
    const baseName = isNote ? path.basename(oldFull, extension) : path.basename(oldFull);
    const finalName = findAvailableName(destFull, baseName, extension);
    const newFull = path.join(destFull, finalName);

    if (newFull === oldFull) {
      // Déjà à cet endroit — no-op plutôt qu'une erreur fs.rename inutile.
      return { relPath: path.relative(vaultPath, oldFull), name: baseName };
    }

    await fs.rename(oldFull, newFull);
    return {
      relPath: path.relative(vaultPath, newFull),
      name: extension ? finalName.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : finalName,
    };
  });

  // Édition manuelle du chemin complet (dossier + nom) en une seule
  // opération, à partir d'un chemin tapé à la main — voir
  // apps/mobile/components/EditPathDialog.tsx. Contrairement à vault:rename
  // (jamais de séparateur, reste dans le même dossier) et vault:move (choisit
  // parmi les dossiers EXISTANTS), ceci accepte un chemin arbitraire et crée
  // les dossiers intermédiaires manquants — comportement attendu d'une
  // édition "manuelle" de chemin. Contrairement à create-note/create-folder,
  // AUCUN renommage automatique en " 2"/" 3" en cas de collision : c'est une
  // erreur, l'utilisatrice a tapé ce chemin précis exprès.
  ipcMain.handle('vault:set-path', async (_event, relPath: string, newRelPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const oldFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(oldFull)) throw new Error('Élément introuvable.');
    const isNote = fsSync.statSync(oldFull).isFile();
    // Préserve l'extension réelle (voir vault:rename plus haut).
    const extension = isNote ? path.extname(oldFull) : '';

    const trimmed = (newRelPath ?? '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (!trimmed) throw new Error('Le chemin ne peut pas être vide.');
    if (trimmed.split('/').some((segment) => segment.trim() === '' || segment === '.' || segment === '..')) {
      throw new Error('Chemin invalide.');
    }

    const strippedTrimmed =
      isNote && extension ? trimmed.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : trimmed;
    const finalRelPath = isNote ? `${strippedTrimmed}${extension}` : trimmed;
    const newFull = resolveInVault(vaultPath, finalRelPath);

    if (newFull === oldFull) {
      // Déjà à cet endroit — no-op plutôt qu'une erreur fs.rename inutile.
      return {
        relPath: path.relative(vaultPath, newFull),
        name: isNote ? path.basename(newFull, extension) : path.basename(newFull),
      };
    }

    if (!isNote && (newFull === oldFull || newFull.startsWith(oldFull + path.sep))) {
      throw new Error('Impossible de déplacer un dossier dans lui-même ou l’un de ses sous-dossiers.');
    }
    if (fsSync.existsSync(newFull)) {
      throw new Error(`"${finalRelPath}" existe déjà.`);
    }

    await fs.mkdir(path.dirname(newFull), { recursive: true });
    await fs.rename(oldFull, newFull);
    return {
      relPath: path.relative(vaultPath, newFull),
      name: isNote ? path.basename(newFull, extension) : path.basename(newFull),
    };
  });

  // Suppression. Règle cardinale : supprimer ne détruit RIEN — l'élément
  // est DÉPLACÉ vers `.trash/` (corbeille DU coffre, elle-même synchronisée
  // : la corbeille est partagée entre tous les appareils du compte, chaque
  // suppression y atterrit partout). La restauration est un simple
  // vault:set-path hors de `.trash/` (la structure miroir garde le chemin
  // d'origine lisible).
  //
  // Confirmation NATIVE (`dialog.showMessageBox`, même mécanisme que
  // `vault:choose-folder`) avant toute suppression réelle — jamais
  // silencieuse, et le message distingue explicitement "note" de "dossier
  // ET tout son contenu" pour qu'une suppression de dossier ne surprenne
  // personne. Recours à `fs.rm(..., {recursive:true})` : fonctionne aussi
  // bien pour un fichier qu'un dossier, pas besoin de deux chemins de code
  // séparés.
  //
  // `options.silent` : suppression SANS confirmation, réservée au moteur de
  // synchro qui applique des tombestones distantes — une confirmation PAR
  // FICHIER rendrait une synchro à 100 suppressions inutilisable, et la
  // suppression a déjà été validée par l'appareil émetteur. En mode
  // silencieux on élague aussi les dossiers devenus vides (sinon le dossier
  // supprimé resterait en coquille vide après la suppression de ses
  // fichiers) : pruneEmptyAncestors remonte les parents du chemin supprimé
  // en retirant chaque dossier vide — jamais la racine du coffre, jamais un
  // dossier caché (.123ecriture…), arrêt au premier dossier non vide.
  //
  // `options.permanent` (et toute suppression ciblant déjà `.trash/`) :
  // destruction réelle — c'est le SEUL chemin destructif, réservé à
  // « Supprimer définitivement » depuis la corbeille.
  ipcMain.handle(
    'vault:delete',
    async (
      _event,
      relPath: string,
      options?: { silent?: boolean; permanent?: boolean },
    ) => {
      const vaultPath = getVaultPath();
      if (!vaultPath) throw new Error('Aucun vault sélectionné');

      const fullPath = resolveInVault(vaultPath, relPath);
      if (!fsSync.existsSync(fullPath)) throw new Error('Élément introuvable.');
      const isFolder = fsSync.statSync(fullPath).isDirectory();
      const name = path.basename(fullPath);
      const alreadyInTrash = relPath.split(/[\\/]/)[0] === TRASH_FOLDER;

      if (!options?.silent) {
        const win = getWindow();
        const messageBoxOptions = {
          type: 'warning' as const,
          buttons: ['Annuler', 'Supprimer'],
          defaultId: 0,
          cancelId: 0,
          message: isFolder ? `Supprimer le dossier « ${name} » ?` : `Supprimer « ${name} » ?`,
          detail: isFolder
            ? 'Ce dossier et tout son contenu seront déplacés vers la corbeille du coffre (.trash, synchronisée avec vos autres appareils).'
            : 'Cette note sera déplacée vers la corbeille du coffre (.trash, synchronisée avec vos autres appareils).',
        };
        const { response } = win
          ? await dialog.showMessageBox(win, messageBoxOptions)
          : await dialog.showMessageBox(messageBoxOptions);
        if (response !== 1) return { deleted: false };
      }

      if (options?.permanent || alreadyInTrash) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await moveToVaultTrash(vaultPath, fullPath, relPath);
      }

      if (options?.silent) {
        await pruneEmptyAncestors(vaultPath, path.dirname(fullPath));
      }
      return { deleted: true };
    },
  );

  // Corbeille du coffre actif — liste plate des fichiers sous `.trash/`
  // pour l'écran Paramètres → Corbeille (l'explorateur masque les dossiers
  // cachés). relPath complets, préfixe `.trash/` compris, pour que
  // « Restaurer » puisse déplacer via vault:set-path sans ambiguïté.
  ipcMain.handle('vault:list-trash', async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    const trashPath = path.join(vaultPath, TRASH_FOLDER);
    if (!fsSync.existsSync(trashPath)) return [];
    const results: { relPath: string; sizeBytes: number; modifiedAt: string }[] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const childPath = path.join(dir, entry.name);
        const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(childPath, childRel);
        } else if (entry.isFile()) {
          const stat = await fs.stat(childPath);
          results.push({
            relPath: `${TRASH_FOLDER}/${childRel}`,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        }
      }
    };
    await walk(trashPath, '');
    results.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return results;
  });

  // Voir "Fichier ouvert par défaut" ci-dessus (readLastOpened/
  // writeLastOpened) — le renderer appelle `setLastOpened` à chaque
  // ouverture RÉUSSIE d'une note (voir NotesScreen.tsx, `openNote`), et
  // `getLastOpened` une fois au démarrage/changement de coffre pour savoir
  // quoi rouvrir.
  ipcMain.handle('vault:get-last-opened', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return readLastOpened(vaultPath);
  });

  ipcMain.handle('vault:set-last-opened', async (_event, relPath: string | null) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return;
    await writeLastOpened(vaultPath, relPath);
  });

  // Dossiers repliés de l'explorateur (voir readCollapsedRelPaths) —
  // écrits à chaque bascule de repli (toggleCollapse de NotesScreen.tsx),
  // best-effort côté renderer : une écriture qui échoue ne doit pas casser
  // le repli à l'écran.
  ipcMain.handle('vault:get-collapsed-paths', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return readCollapsedRelPaths(vaultPath);
  });

  ipcMain.handle('vault:set-collapsed-paths', async (_event, relPaths: string[]) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return;
    await writeCollapsedRelPaths(vaultPath, Array.isArray(relPaths) ? relPaths : []);
  });

  // Onglets de notes ouverts (voir readOpenTabRelPaths) — réécrits à chaque
  // ouverture/fermeture/réordonnancement d'onglet côté renderer
  // (NotesScreen.tsx), best-effort comme set-collapsed-paths.
  ipcMain.handle('vault:get-open-tabs', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return readOpenTabRelPaths(vaultPath);
  });

  ipcMain.handle('vault:set-open-tabs', async (_event, relPaths: string[]) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return;
    await writeOpenTabRelPaths(vaultPath, Array.isArray(relPaths) ? relPaths : []);
  });
}
