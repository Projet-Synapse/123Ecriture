import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../theme';
import { FolderOpenIcon, NoteIconByKind } from './FileIcons';

// APERÇU DE DOSSIER (v0.4.36, demande de l'utilisatrice — « comme le plugin
// Make.md d'Obsidian ») : cliquer un dossier de l'explorateur affiche CETTE
// vue à la place de l'éditeur — une grille de cartes, une par fichier du
// dossier (avec sous-dossiers), cliquer une carte ouvre la note. Le contenu
// de chaque carte : les premières lignes de la note (aperçu de texte).

type Props = {
  folderRelPath: string;
  tree: VaultTreeNode[];
  theme: Theme;
  onOpenNote: (node: VaultNoteNode) => void;
  onOpenFolder: (node: VaultFolderNode) => void;
};

function collectFolderContent(nodes: VaultTreeNode[]): { folders: VaultFolderNode[]; notes: VaultNoteNode[] } {
  const folders: VaultFolderNode[] = [];
  const notes: VaultNoteNode[] = [];
  for (const n of nodes) {
    if (n.type === 'folder') folders.push(n);
    else notes.push(n);
  }
  return { folders, notes };
}

function findFolder(nodes: VaultTreeNode[], relPath: string): VaultFolderNode | null {
  for (const n of nodes) {
    if (n.type === 'folder') {
      if (n.relPath === relPath) return n;
      const found = findFolder(n.children ?? [], relPath);
      if (found) return found;
    }
  }
  return null;
}

export function FolderPreview({ folderRelPath, tree, theme, onOpenNote, onOpenFolder }: Props) {
  const folder = useMemo(() => findFolder(tree, folderRelPath), [tree, folderRelPath]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault?.readNote) return;
      const out: Record<string, string> = {};
      for (const note of (folder.children ?? []).filter((n) => n.type === 'note').slice(0, 30)) {
        try {
          const raw = await window.vault.readNote(note.relPath);
          // Enlever le frontmatter pour l'aperçu
          const sansFront = raw.replace(/^---[\s\S]*?---\s*/, '');
          out[note.relPath] = sansFront.trim().slice(0, 140);
        } catch {
          out[note.relPath] = '';
        }
      }
      if (!cancelled) setPreviews(out);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [folder?.relPath, folder]);

  if (!folder) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: theme.textMuted }}>Dossier introuvable (déplacé ou supprimé).</Text>
      </View>
    );
  }

  const { folders, notes } = collectFolderContent(folder.children ?? []);
  const q = recherche.trim().toLowerCase();
  const filteredNotes = q ? notes.filter((n) => n.name.toLowerCase().includes(q) || n.relPath.toLowerCase().includes(q)) : notes;
  const filteredFolders = q ? folders.filter((n) => n.name.toLowerCase().includes(q)) : folders;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.wrap} style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <FolderGlyph size={28} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>{folder.name}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>
              {filteredFolders.length} dossier(s) · {filteredNotes.length} fichier(s)
            </Text>
          </View>
        </View>

        <TextInput
          value={recherche}
          onChangeText={setRecherche}
          placeholder="Filtrer le contenu du dossier…"
          placeholderTextColor={theme.textMuted}
          style={[styles.search, { color: theme.text, borderColor: theme.border, backgroundColor: `${theme.border}22` }]}
        />

        {filteredFolders.length > 0 && (
          <>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 12, marginBottom: 6 }}>DOSSIERS</Text>
            <View style={styles.grid}>
              {filteredFolders.map((f) => (
                <Pressable
                  key={f.relPath}
                  onPress={() => onOpenFolder(f)}
                  accessibilityRole="button"
                  style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <FolderGlyph size={22} />
                    <Text style={{ color: theme.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                      {f.name}
                    </Text>
                  </View>
                  <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 4 }}>
                    {(f.children ?? []).filter((c) => c.type === 'note').length} fichier(s)
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {filteredNotes.length > 0 && (
          <>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 14, marginBottom: 6 }}>FICHIERS</Text>
            <View style={styles.grid}>
              {filteredNotes.map((n) => (
                <Pressable
                  key={n.relPath}
                  onPress={() => onOpenNote(n)}
                  accessibilityRole="button"
                  style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <NoteIconByKind kind={n.kind} size={16} />
                    <Text style={{ color: theme.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                      {n.name}
                    </Text>
                  </View>
                  {previews[n.relPath] ? (
                    <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 4 }} numberOfLines={3}>
                      {previews[n.relPath]}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </>
        )}

        {filteredFolders.length === 0 && filteredNotes.length === 0 && (
          <Text style={{ color: theme.textMuted, marginTop: 20, textAlign: 'center' }}>
            {q ? 'Aucun résultat pour cette recherche.' : 'Ce dossier est vide.'}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function FolderGlyph({ size = 24 }: { size?: number }) {
  return <FolderOpenIcon size={size} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  wrap: {
    padding: 20,
    gap: 4,
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 8,
  },
  search: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    width: 240,
    maxWidth: '100%',
    gap: 4,
  },
});
