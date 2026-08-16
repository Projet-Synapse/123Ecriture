import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../theme';

// Onglet "Occurrences" de la barre latérale (voir RightSidebar.tsx,
// NotesScreen.tsx) — dictionnaire personnel des {{mots}} (voir
// apps/desktop/electron/occurrences.js). Deux vues : la LISTE (tous les
// mots, "+ Ajouter un mot") et la FICHE d'un mot sélectionné (nom éditable,
// description éditable, notes qui le mentionnent) — `focusedWord` piloté
// par le parent : cliquer une pastille {{occurrence}} dans une note (voir
// NotesScreen.tsx, `handleOpenOccurrence`) bascule directement sur la fiche
// du mot concerné, pas juste sur la liste.
type Props = {
  theme: Theme;
  focusedWord: string | null;
  onFocusWord: (word: string | null) => void;
  onOpenNote: (relPath: string) => void;
  // Prévient le parent après toute mutation réussie (créer/renommer/décrire/
  // supprimer) — NotesScreen tient son PROPRE état du dictionnaire (partagé
  // avec NoteRenderer/MdxEditor pour savoir quelles {{...}} styler), séparé
  // du state local `entries` de ce panneau ; sans ce callback, un mot créé
  // ici n'obtiendrait sa pastille dans l'éditeur qu'au prochain montage.
  onChanged?: () => void;
};

export function OccurrencesPanel({ theme, focusedWord, onFocusWord, onOpenNote, onChanged }: Props) {
  const occurrencesBridge = typeof window !== 'undefined' ? window.occurrences : undefined;

  const [entries, setEntries] = useState<OccurrenceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newWord, setNewWord] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [wordDraft, setWordDraft] = useState('');
  const [notesForFocused, setNotesForFocused] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!occurrencesBridge) return;
    setEntries(await occurrencesBridge.list());
  }, [occurrencesBridge]);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        console.error('[occurrences] échec du chargement initial :', err);
      }
    })();
  }, [refresh]);

  const focused = entries.find((e) => e.word.toLowerCase() === focusedWord?.toLowerCase()) ?? null;

  // Resynchronise les brouillons (nom/description) et la liste des notes
  // liées quand la fiche affichée change VRAIMENT — ajustement pendant le
  // rendu plutôt qu'un effet (voir la même remarque dans PropertiesPanel.tsx
  // sur react-hooks/set-state-in-effect).
  const [syncedFocusedId, setSyncedFocusedId] = useState<string | null>(null);
  if (focused && focused.id !== syncedFocusedId) {
    setSyncedFocusedId(focused.id);
    setWordDraft(focused.word);
    setDescriptionDraft(focused.description);
  } else if (!focused && syncedFocusedId !== null) {
    setSyncedFocusedId(null);
  }

  // Ne réinitialise pas notesForFocused en tête d'effet (setState direct,
  // évité par convention dans ce projet — voir EmbedNode dans
  // NoteRenderer.tsx pour le même choix) : de toute façon non affiché tant
  // qu'aucun mot n'est sélectionné (voir le rendu plus bas), et resynchronisé
  // dès que `focused` redevient une entrée valide.
  useEffect(() => {
    if (!occurrencesBridge || !focused) return;
    void occurrencesBridge
      .findNotes(focused.word)
      .then(setNotesForFocused)
      .catch((err) => console.error('[occurrences] échec de la recherche des notes liées :', err));
  }, [occurrencesBridge, focused]);

  const runAction = useCallback(
    async (action: () => Promise<OccurrenceEntry[]>) => {
      setError(null);
      try {
        setEntries(await action());
        onChanged?.();
      } catch (err) {
        console.error('[occurrences] échec :', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [onChanged],
  );

  const submitCreate = useCallback(async () => {
    const word = newWord.trim();
    if (!word || !occurrencesBridge) return;
    setNewWord('');
    await runAction(() => occurrencesBridge.create(word));
  }, [newWord, occurrencesBridge, runAction]);

  const submitRename = useCallback(async () => {
    if (!focused || !occurrencesBridge) return;
    const trimmed = wordDraft.trim();
    if (!trimmed || trimmed === focused.word) return;
    await runAction(() => occurrencesBridge.update(focused.id, { word: trimmed }));
    onFocusWord(trimmed);
  }, [focused, wordDraft, occurrencesBridge, runAction, onFocusWord]);

  const submitDescription = useCallback(async () => {
    if (!focused || !occurrencesBridge) return;
    if (descriptionDraft === focused.description) return;
    await runAction(() => occurrencesBridge.update(focused.id, { description: descriptionDraft }));
  }, [focused, descriptionDraft, occurrencesBridge, runAction]);

  const handleRemove = useCallback(async () => {
    if (!focused || !occurrencesBridge) return;
    await runAction(() => occurrencesBridge.remove(focused.id));
    onFocusWord(null);
  }, [focused, occurrencesBridge, runAction, onFocusWord]);

  if (!occurrencesBridge) {
    return (
      <View style={styles.container}>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant.
        </Text>
      </View>
    );
  }

  if (focused) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Pressable onPress={() => onFocusWord(null)} style={styles.backButton}>
          <Text style={{ color: theme.accent, fontSize: 12 }}>← Tous les mots</Text>
        </Pressable>
        {error && <Text style={styles.error}>⚠️ {error}</Text>}
        <TextInput
          value={wordDraft}
          onChangeText={setWordDraft}
          onBlur={() => void submitRename()}
          onSubmitEditing={() => void submitRename()}
          style={[styles.wordInput, { color: theme.text, borderColor: theme.border }]}
        />
        <TextInput
          value={descriptionDraft}
          onChangeText={setDescriptionDraft}
          onBlur={() => void submitDescription()}
          multiline
          placeholder="Description…"
          placeholderTextColor={theme.textMuted}
          style={[styles.descriptionInput, { color: theme.text, borderColor: theme.border }]}
        />
        <Pressable onPress={() => void handleRemove()} style={styles.deleteButton}>
          <Text style={{ color: '#dc2626', fontSize: 12 }}>🗑️ Supprimer ce mot</Text>
        </Pressable>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Notes qui mentionnent ce mot</Text>
        {notesForFocused.length === 0 ? (
          <Text style={[styles.muted, { color: theme.textMuted }]}>Aucune pour l’instant.</Text>
        ) : (
          notesForFocused.map((relPath) => (
            <Pressable key={relPath} onPress={() => onOpenNote(relPath)} style={styles.noteRow}>
              <Text style={{ color: theme.accent, fontSize: 12 }} numberOfLines={1}>
                📝 {relPath}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error && <Text style={styles.error}>⚠️ {error}</Text>}
      {entries.length === 0 && (
        <Text style={[styles.muted, { color: theme.textMuted }]}>Aucun mot pour l’instant.</Text>
      )}
      {entries.map((entry) => (
        <Pressable key={entry.id} onPress={() => onFocusWord(entry.word)} style={styles.entryRow}>
          <Text style={[styles.entryWord, { color: theme.text }]} numberOfLines={1}>
            🔤 {entry.word}
          </Text>
          {entry.description ? (
            <Text style={[styles.entryDescription, { color: theme.textMuted }]} numberOfLines={1}>
              {entry.description}
            </Text>
          ) : null}
        </Pressable>
      ))}

      <View style={styles.createRow}>
        <TextInput
          value={newWord}
          onChangeText={setNewWord}
          onSubmitEditing={() => void submitCreate()}
          placeholder="Ajouter un mot…"
          placeholderTextColor={theme.textMuted}
          style={[styles.createInput, { color: theme.text, borderColor: theme.border }]}
        />
        <Pressable onPress={() => void submitCreate()} style={[styles.createButton, { backgroundColor: theme.accent }]}>
          <Text style={styles.createButtonText}>Ajouter</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 12,
    gap: 8,
  },
  muted: {
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: '#dc2626',
    fontSize: 12,
  },
  entryRow: {
    paddingVertical: 6,
  },
  entryWord: {
    fontSize: 13,
    fontWeight: '600',
  },
  entryDescription: {
    fontSize: 11,
  },
  createRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  createInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  createButton: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  backButton: {
    paddingVertical: 4,
  },
  wordInput: {
    fontSize: 14,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  descriptionInput: {
    fontSize: 12,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    minHeight: 60,
  },
  deleteButton: {
    paddingVertical: 4,
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  noteRow: {
    paddingVertical: 4,
  },
});
