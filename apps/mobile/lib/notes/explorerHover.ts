// ✒️ 123ECRITURE — lib/notes/explorerHover.ts — infobulle au survol de l'explorateur
//////////////////////////////////////////////////////////////////////////////
//
// Texte et délais de la bulle affichée au survol d'une ligne de
// l'explorateur (desktop uniquement, voir ExplorerHoverHost.tsx) :
// nom complet, dates de modification et de création, contenu d'un
// dossier. Pur et testé — le composant ne fait qu'afficher.
//
//////////////////////////////////////////////////////////////////////////////

export const EXPLORER_HOVER_DELAY_MS = 500;

export type FolderCounts = { notes: number; folders: number };

// Compte récursif (déjà en mémoire dans l'arbre) : pas d'I/O, pas de
// parcours disque au survol d'un gros coffre.
export function countFolderContents(children: VaultTreeNode[]): FolderCounts {
  let notes = 0;
  let folders = 0;
  for (const child of children) {
    if (child.type === 'folder') {
      folders += 1;
      const nested = countFolderContents(child.children);
      notes += nested.notes;
      folders += nested.folders;
    } else {
      notes += 1;
    }
  }
  return { notes, folders };
}

export function formatFolderCounts(counts: FolderCounts): string {
  const notePart = counts.notes === 0 ? 'Aucune note' : counts.notes === 1 ? '1 note' : `${counts.notes} notes`;
  const folderPart =
    counts.folders === 0 ? 'aucun sous-dossier' : counts.folders === 1 ? '1 sous-dossier' : `${counts.folders} sous-dossiers`;
  return `${notePart}, ${folderPart}`;
}

// Heure locale de la machine (AAAA-MM-JJ HH:MM), comme demandé.
export function formatExplorerTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${min}`;
}

export function extensionOfRelPath(relPath: string): string {
  const nom = relPath.split('/').pop() ?? '';
  const dot = nom.lastIndexOf('.');
  return dot > 0 ? nom.slice(dot) : '';
}

export function explorerHoverTitle(node: Pick<VaultTreeNode, 'name' | 'type' | 'relPath'>): string {
  if (node.type === 'note') return `${node.name}${extensionOfRelPath(node.relPath)}`;
  return node.name;
}

export type ExplorerTooltipInput = {
  name: string;
  type: 'note' | 'folder';
  relPath: string;
  createdAt?: number | null;
  modifiedAt?: number | null;
  folderCounts?: FolderCounts;
};

export function buildExplorerTooltipLines(input: ExplorerTooltipInput): string[] {
  const lines = [explorerHoverTitle(input)];
  if (typeof input.modifiedAt === 'number' && Number.isFinite(input.modifiedAt)) {
    lines.push(`Dernière modification le ${formatExplorerTimestamp(input.modifiedAt)}`);
  }
  if (typeof input.createdAt === 'number' && Number.isFinite(input.createdAt)) {
    lines.push(`Créé le ${formatExplorerTimestamp(input.createdAt)}`);
  }
  if (input.type === 'folder' && input.folderCounts) {
    lines.push(formatFolderCounts(input.folderCounts));
  }
  return lines;
}

// Couleur de survol : assombrit légèrement un fond clair, éclaircit un
// fond sombre — assez discret pour ne pas concurrencer la sélection.
export function explorerHoverRowColor(isDark: boolean): string {
  return isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
}
