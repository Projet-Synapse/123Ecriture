import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../theme';

// Recherche globale — voir .claude/References/Sources.md §2 : "un petit
// bouton en haut de la gestion de fichiers... chercher fichiers, pièces
// jointes, mots-clés... bouton 'filtre' pour choisir par propriétés".
// Même coquille modale que MoveDialog.tsx/EditPathDialog.tsx (backdrop
// cliquable pour fermer, boîte centrale) — champ de requête en haut avec
// debounce (même idiome `useRef<Timeout>` clear-and-reschedule que
// l'autosave de NotesScreen.tsx/CanvasEditor.tsx/ChartEditor.tsx, première
// UI "recherche en direct" du code), liste de résultats scrollable, filtre
// par propriété replié par défaut. Toute la recherche vit côté Electron
// (window.search — voir apps/desktop/electron/search.ts) : ce composant
// n'est que l'UI, il ne parcourt jamais le coffre lui-même.
const SEARCH_DEBOUNCE_MS = 300;

const RESULT_ICON: Record<SearchResultKind, string> = {
  markdown: '📝',
  canvas: '🎨',
  chart: '📊',
  excalidraw: '🖍️',
  folder: '📁',
  attachment: '📎',
};

const MATCH_LABEL: Record<SearchMatchType, string> = {
  title: 'titre',
  content: 'contenu',
  tag: 'mot-clé',
  property: 'propriété',
};

type Props = {
  theme: Theme;
  onOpenResult: (relPath: string) => void;
  onCancel: () => void;
};

export function SearchDialog({ theme, onOpenResult, onCancel }: Props) {
  const searchBridge = typeof window !== 'undefined' ? window.search : undefined;
  const propertiesBridge = typeof window !== 'undefined' ? window.properties : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<PropertyDefinition | null>(null);
  const [propertyValue, setPropertyValue] = useState('');

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Vrai dès qu'il y a une requête active (texte ou filtre) — la liste de
  // résultats affichée se base là-dessus plutôt que de vider `results` via
  // un setState synchrone dans l'effet ci-dessous (juste dérivé pendant le
  // rendu, pas d'aller-retour effet inutile pour un simple "champ vide").
  const hasQuery = Boolean(query.trim()) || selectedProperty !== null;

  useEffect(() => {
    if (!propertiesBridge) return;
    void propertiesBridge.list().then(setProperties).catch(() => setProperties([]));
  }, [propertiesBridge]);

  useEffect(() => {
    if (!searchBridge || !hasQuery) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      setLoading(true);
      void searchBridge
        .run(query, selectedProperty ? { propertyId: selectedProperty.id, propertyValue: propertyValue || undefined } : undefined)
        .then((found) => {
          setResults(found);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, selectedProperty, propertyValue, searchBridge, hasQuery]);

  const pickProperty = () => {
    if (!contextMenuBridge) return;
    void contextMenuBridge
      .show([{ id: '', label: 'Aucune (retirer le filtre)' }, ...properties.map((p) => ({ id: p.id, label: p.name }))])
      .then((chosenId) => {
        if (chosenId === null) return;
        if (chosenId === '') {
          setSelectedProperty(null);
          setPropertyValue('');
          return;
        }
        const found = properties.find((p) => p.id === chosenId);
        if (found) setSelectedProperty(found);
      });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[styles.dialog, { backgroundColor: theme.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un fichier, du texte, un #mot-clé…"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />

          {propertiesBridge && (
            <>
              <Pressable onPress={() => setFiltersOpen((open) => !open)} style={styles.filtersToggle}>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {filtersOpen ? '▾' : '▸'} Filtres{selectedProperty ? ` — ${selectedProperty.name}` : ''}
                </Text>
              </Pressable>
              {filtersOpen && (
                <View style={styles.filtersRow}>
                  <Pressable
                    onPress={pickProperty}
                    style={[styles.chip, { borderColor: theme.border }, selectedProperty && { borderColor: theme.accent }]}
                  >
                    <Text style={{ color: selectedProperty ? theme.accent : theme.text, fontSize: 13 }}>
                      {selectedProperty ? selectedProperty.name : 'Choisir une propriété…'}
                    </Text>
                  </Pressable>
                  {selectedProperty && (
                    <TextInput
                      value={propertyValue}
                      onChangeText={setPropertyValue}
                      placeholder="Valeur (optionnel)"
                      placeholderTextColor={theme.textMuted}
                      style={[styles.valueInput, { color: theme.text, borderColor: theme.border }]}
                    />
                  )}
                </View>
              )}
            </>
          )}

          <ScrollView style={styles.resultsList}>
            {loading && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={{ color: theme.textMuted }}>Recherche…</Text>
              </View>
            )}
            {!loading && error && <Text style={styles.error}>⚠️ {error}</Text>}
            {!loading && !error && hasQuery && results.length === 0 && (
              <Text style={[styles.muted, { color: theme.textMuted }]}>Aucun résultat.</Text>
            )}
            {!loading &&
              hasQuery &&
              results.map((result) => {
                // Seuls markdown/canvas/graphique s'ouvrent réellement dans
                // Notes (openNoteByRelPath) — dossiers et pièces jointes
                // n'ont pas d'éditeur dédié aujourd'hui, la ligne reste donc
                // informative plutôt que de prétendre à un clic qui ne
                // ferait rien (règle CLAUDE.md : un bouton doit faire ce
                // qu'il annonce).
                const isOpenable =
                  result.kind === 'markdown' ||
                  result.kind === 'canvas' ||
                  result.kind === 'chart' ||
                  result.kind === 'excalidraw';
                return (
                  <Pressable
                    key={result.relPath}
                    onPress={isOpenable ? () => onOpenResult(result.relPath) : undefined}
                    style={[styles.result, { borderColor: theme.border }, !isOpenable && styles.resultDisabled]}
                  >
                    <Text style={styles.resultIcon}>{RESULT_ICON[result.kind]}</Text>
                    <View style={styles.resultBody}>
                      <Text style={{ color: theme.text }} numberOfLines={1}>
                        {result.name}
                      </Text>
                      {result.snippet && (
                        <Text style={[styles.snippet, { color: theme.textMuted }]} numberOfLines={2}>
                          {result.snippet}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.matchType, { color: theme.textMuted }]}>{MATCH_LABEL[result.matchType]}</Text>
                  </Pressable>
                );
              })}
          </ScrollView>

          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={{ color: theme.textMuted }}>Fermer</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: 480,
    maxHeight: 520,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  filtersToggle: {
    alignSelf: 'flex-start',
  },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  valueInput: {
    flex: 1,
    minWidth: 140,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  resultsList: {
    maxHeight: 340,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
  },
  muted: {
    fontSize: 13,
    padding: 8,
  },
  error: {
    color: '#dc2626',
    padding: 8,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  resultDisabled: {
    opacity: 0.5,
  },
  resultIcon: {
    fontSize: 16,
  },
  resultBody: {
    flex: 1,
  },
  snippet: {
    fontSize: 12,
    marginTop: 2,
  },
  matchType: {
    fontSize: 11,
  },
  cancelButton: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});
