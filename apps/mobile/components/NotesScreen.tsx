import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import {
  applyHeading,
  insertLink,
  toggleLinePrefix,
  toggleNumberedList,
  wrapSelection,
  type FormattingResult,
  type Selection,
} from '../lib/mdxFormatting';
import { darkTheme, lightTheme } from '../theme';

// Écran Notes — Phase 1 : vault local + édition MDX avec barre de
// formatage (pas encore de rendu enrichi/live-preview, voir
// docs/ARCHITECTURE.md §4 et la feuille de route). Le vault n'existe que
// côté Electron desktop pour l'instant (window.vault, exposé par
// apps/desktop/electron/preload.js) — sur web/mobile, cette section reste
// indisponible jusqu'à la Phase 2.
const AUTOSAVE_DELAY_MS = 600;

type Status = 'idle' | 'saving' | 'saved' | 'error';

const TOOLBAR_ACTIONS: { id: string; label: string; run: (text: string, selection: Selection) => FormattingResult }[] = [
  { id: 'h1', label: 'H1', run: (text, sel) => applyHeading(text, sel, 1) },
  { id: 'h2', label: 'H2', run: (text, sel) => applyHeading(text, sel, 2) },
  { id: 'h3', label: 'H3', run: (text, sel) => applyHeading(text, sel, 3) },
  { id: 'bold', label: 'G', run: (text, sel) => wrapSelection(text, sel, '**') },
  { id: 'italic', label: 'I', run: (text, sel) => wrapSelection(text, sel, '_') },
  { id: 'code', label: '</>', run: (text, sel) => wrapSelection(text, sel, '`') },
  { id: 'quote', label: '❝', run: (text, sel) => toggleLinePrefix(text, sel, '> ') },
  { id: 'bullet', label: '•', run: (text, sel) => toggleLinePrefix(text, sel, '- ') },
  { id: 'numbered', label: '1.', run: (text, sel) => toggleNumberedList(text, sel) },
  { id: 'link', label: '🔗', run: (text, sel) => insertLink(text, sel) },
];

export function NotesScreen() {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;
  const vault = typeof window !== 'undefined' ? window.vault : undefined;

  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [notes, setNotes] = useState<VaultEntry[]>([]);
  const [activeNote, setActiveNote] = useState<VaultEntry | null>(null);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sélection courante de l'éditeur — en ref (pas en state) pour ne pas
  // re-render à chaque déplacement de curseur. `forcedSelection` sert
  // uniquement à repositionner le curseur juste après une action de la
  // barre d'outils (voir applyFormatting) ; elle est relâchée aussitôt
  // après pour laisser la frappe normale non contrôlée — un TextInput dont
  // la prop `selection` reste en permanence contrôlée fait sauter le
  // curseur pendant la frappe (piège classique React Native).
  const selectionRef = useRef<Selection>({ start: 0, end: 0 });
  const [forcedSelection, setForcedSelection] = useState<Selection | undefined>(undefined);
  const inputRef = useRef<TextInput>(null);

  const refreshNotes = useCallback(async () => {
    if (!vault) return;
    const list = await vault.listNotes();
    setNotes([...list].sort((a, b) => b.modifiedAt - a.modifiedAt));
  }, [vault]);

  useEffect(() => {
    if (!vault) return;
    void (async () => {
      try {
        const current = await vault.getCurrentPath();
        setVaultPath(current);
        if (current) await refreshNotes();
      } catch (error) {
        console.error('[vault] échec du chargement initial :', error);
      }
    })();
    // refreshNotes est stable (useCallback sur `vault`) : pas besoin de le
    // relancer à chaque render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

  const handleChooseFolder = async () => {
    if (!vault) return;
    try {
      const chosen = await vault.chooseFolder();
      setVaultPath(chosen);
      if (chosen) await refreshNotes();
    } catch (error) {
      console.error('[vault] échec du choix de dossier :', error);
    }
  };

  const openNote = async (entry: VaultEntry) => {
    if (!vault) return;
    try {
      const text = await vault.readNote(entry.relPath);
      setActiveNote(entry);
      setContent(text);
      setStatus('idle');
      selectionRef.current = { start: text.length, end: text.length };
    } catch (error) {
      console.error('[vault] échec de lecture de la note :', error);
      setStatus('error');
    }
  };

  const handleCreateNote = async () => {
    if (!vault) return;
    try {
      const entry = await vault.createNote('Sans titre');
      await refreshNotes();
      await openNote(entry);
    } catch (error) {
      console.error('[vault] échec de création de la note :', error);
    }
  };

  const scheduleSave = useCallback(
    (text: string) => {
      if (!vault || !activeNote) return;
      setStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            await vault.writeNote(activeNote.relPath, text);
            setStatus('saved');
            await refreshNotes();
          } catch (error) {
            console.error('[vault] échec de sauvegarde :', error);
            setStatus('error');
          }
        })();
      }, AUTOSAVE_DELAY_MS);
    },
    [vault, activeNote, refreshNotes],
  );

  const handleChangeContent = (text: string) => {
    setContent(text);
    scheduleSave(text);
  };

  const applyFormatting = (run: (text: string, selection: Selection) => FormattingResult) => {
    const result = run(content, selectionRef.current);
    setContent(result.text);
    scheduleSave(result.text);
    selectionRef.current = result.selection;
    setForcedSelection(result.selection);
    inputRef.current?.focus();
    setTimeout(() => setForcedSelection(undefined), 0);
  };

  if (!vault) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📝 Notes</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Le vault local n’est disponible que sur la version desktop pour l’instant (Phase 2 pour
          mobile/web).
        </Text>
      </View>
    );
  }

  if (!vaultPath) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📝 Notes</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Choisis un dossier local pour en faire ton vault.
        </Text>
        <Pressable
          onPress={() => void handleChooseFolder()}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>Choisir un dossier</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={[styles.list, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <View style={styles.listHeader}>
          <Text style={[styles.vaultPath, { color: theme.textMuted }]} numberOfLines={1}>
            {vaultPath}
          </Text>
          <Pressable
            onPress={() => void handleCreateNote()}
            style={[styles.newButton, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>+ Nouvelle note</Text>
          </Pressable>
        </View>
        <ScrollView>
          {notes.map((note) => (
            <Pressable
              key={note.relPath}
              onPress={() => void openNote(note)}
              style={[
                styles.noteItem,
                activeNote?.relPath === note.relPath && { backgroundColor: `${theme.accent}22` },
              ]}
            >
              <Text style={{ color: theme.text }} numberOfLines={1}>
                {note.name}
              </Text>
            </Pressable>
          ))}
          {notes.length === 0 && (
            <Text style={[styles.muted, { color: theme.textMuted, padding: 16 }]}>
              Aucune note pour l’instant.
            </Text>
          )}
        </ScrollView>
      </View>
      <View style={styles.editor}>
        {activeNote ? (
          <>
            <View style={styles.editorHeader}>
              <Text style={[styles.editorTitle, { color: theme.text }]}>{activeNote.name}</Text>
              <Text style={[styles.status, { color: theme.textMuted }]}>
                {status === 'saving' && 'Enregistrement…'}
                {status === 'saved' && 'Enregistré'}
                {status === 'error' && '⚠️ Échec de la sauvegarde'}
              </Text>
            </View>
            <View style={[styles.toolbar, { borderColor: theme.border }]}>
              {TOOLBAR_ACTIONS.map((action) => (
                <Pressable
                  key={action.id}
                  onPress={() => applyFormatting(action.run)}
                  style={[styles.toolbarButton, { backgroundColor: theme.surface }]}
                >
                  <Text style={[styles.toolbarButtonText, { color: theme.text }]}>
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              ref={inputRef}
              multiline
              value={content}
              onChangeText={handleChangeContent}
              onSelectionChange={(event) => {
                selectionRef.current = event.nativeEvent.selection;
              }}
              selection={forcedSelection}
              style={[styles.textArea, { color: theme.text }]}
              placeholder="Écris en MDX ici…"
              placeholderTextColor={theme.textMuted}
              textAlignVertical="top"
            />
          </>
        ) : (
          <View style={styles.centered}>
            <Text style={[styles.muted, { color: theme.textMuted }]}>
              Sélectionne ou crée une note.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 360,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    width: 260,
    borderRightWidth: 1,
  },
  listHeader: {
    padding: 12,
    gap: 8,
  },
  vaultPath: {
    fontSize: 11,
  },
  newButton: {
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  noteItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  editor: {
    flex: 1,
  },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  editorTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  status: {
    fontSize: 12,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  toolbarButton: {
    minWidth: 32,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  toolbarButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  textArea: {
    flex: 1,
    padding: 16,
    fontSize: 15,
    lineHeight: 22,
  },
});
