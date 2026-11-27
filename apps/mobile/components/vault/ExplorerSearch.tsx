import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  isSearchResultOpenable,
  SEARCH_MATCH_LABEL,
  SEARCH_RESULT_ICON,
  searchResultKey,
  splitMatchSegments,
} from '../../lib/notes/searchResults';
import { errorMessage } from '../../lib/errorMessage';
import { insertSearchOperator, SEARCH_OPERATOR_HINTS } from '../../lib/search/queryParser';
import { useScrollIntoView } from '../../lib/ui/useScrollIntoView';
import { isFileResultKind } from '../../lib/ui/fileIcons';
import type { Theme } from '../../theme';
import { FileTypeIcon } from './FileIcons';

// ✒️ 123ECRITURE — components/vault/ExplorerSearch.tsx — recherche dans l'explorateur
//////////////////////////////////////////////////////////////////////////////
//
// Champ de recherche en tête du panneau explorateur (plus de boîte qui
// bloque la vue). Syntaxe façon Obsidian (lib/search/queryParser.ts) :
// bouton Aa (casse), bouton d'options, opérateurs cliquables, résultats
// avec nombre de correspondances et extraits surlignés.
//
//////////////////////////////////////////////////////////////////////////////

const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  theme: Theme;
  onOpenResult: (result: SearchResult) => void;
  onClose: () => void;
  // true dès qu'une requête est en cours (le parent peut masquer l'arbre).
  onHasQueryChange?: (hasQuery: boolean) => void;
};

function HighlightedText({
  text,
  needles,
  query,
  caseSensitive,
  theme,
  style,
  numberOfLines,
}: {
  text: string;
  needles?: string[];
  query: string;
  caseSensitive: boolean;
  theme: Theme;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const parts = needles && needles.length > 0 ? needles : query;
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {splitMatchSegments(text, parts, { caseSensitive }).map((segment, i) =>
        segment.isMatch ? (
          <Text key={i} style={[styles.matched, { backgroundColor: `${theme.accent}33` }]}>
            {segment.text}
          </Text>
        ) : (
          <Text key={i}>{segment.text}</Text>
        ),
      )}
    </Text>
  );
}

export function ExplorerSearch({ theme, onOpenResult, onClose, onHasQueryChange }: Props) {
  const searchBridge = typeof window !== 'undefined' ? window.search : undefined;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const { scrollRef, recordItemLayout, handleListLayout, handleListScroll, ensureVisible } = useScrollIntoView();
  const hasQuery = Boolean(query.trim());

  useEffect(() => {
    onHasQueryChange?.(hasQuery);
  }, [hasQuery, onHasQueryChange]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!searchBridge || !hasQuery) {
      // Invalide une recherche en vol ; l'affichage des résultats est
      // déjà masqué quand !hasQuery (pas de setState synchrone ici).
      searchSeq.current += 1;
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      searchSeq.current += 1;
      const seq = searchSeq.current;
      setLoading(true);
      void searchBridge
        .run(query, { caseSensitive })
        .then((found) => {
          if (seq !== searchSeq.current) return;
          setResults(found);
          setError(null);
        })
        .catch((err) => {
          if (seq === searchSeq.current) setError(errorMessage(err));
        })
        .finally(() => {
          if (seq === searchSeq.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, caseSensitive, searchBridge, hasQuery]);

  const [lastResults, setLastResults] = useState(results);
  if (lastResults !== results) {
    setLastResults(results);
    if (selectedIndex !== 0) setSelectedIndex(0);
  }

  const visibleResults = hasQuery ? results : [];

  const openResult = (result: SearchResult | undefined) => {
    if (result && isSearchResultOpenable(result.kind)) onOpenResult(result);
  };

  const insertOperator = (insert: string) => {
    setQuery((current) => insertSearchOperator(current, insert));
    setOptionsOpen(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const inEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Échap ferme la recherche sauf si l'utilisateur tape déjà dans
        // un autre champ (éditeur) — la croix reste disponible.
        if (event.defaultPrevented) return;
        if (!inputFocused && !optionsOpen && inEditable(event.target)) return;
        event.preventDefault();
        if (optionsOpen) setOptionsOpen(false);
        else onClose();
        return;
      }
      if (!inputFocused && !optionsOpen) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.min(visibleResults.length - 1, selectedIndex + 1);
        setSelectedIndex(next);
        ensureVisible(next);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, selectedIndex - 1);
        setSelectedIndex(next);
        ensureVisible(next);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        openResult(visibleResults[selectedIndex]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleResults, selectedIndex, optionsOpen, onClose, inputFocused]);

  const showOptions = optionsOpen;

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <TextInput
          ref={inputRef}
          autoFocus
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            if (text.trim()) setOptionsOpen(false);
          }}
          onFocus={() => {
            setInputFocused(true);
            if (!query.trim()) setOptionsOpen(true);
          }}
          onBlur={() => setInputFocused(false)}
          onSubmitEditing={() => openResult(visibleResults[selectedIndex])}
          placeholder="Saisir pour lancer la recherche"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Recherche dans le coffre"
          style={[styles.input, { color: theme.text }]}
        />
        <Pressable
          onPress={() => setCaseSensitive((v) => !v)}
          accessibilityLabel="Respecter la casse"
          accessibilityState={{ selected: caseSensitive }}
          style={[styles.iconBtn, caseSensitive && { backgroundColor: `${theme.accent}33` }]}
        >
          <Text style={{ color: caseSensitive ? theme.accent : theme.text, fontWeight: '700', fontSize: 13 }}>Aa</Text>
        </Pressable>
        <Pressable
          onPress={() => setOptionsOpen((o) => !o)}
          accessibilityLabel="Options de recherche"
          style={styles.iconBtn}
        >
          <Text style={{ color: theme.text }}>⚙</Text>
        </Pressable>
        <Pressable onPress={onClose} accessibilityLabel="Fermer la recherche" style={styles.iconBtn}>
          <Text style={{ color: theme.textMuted, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>

      {showOptions && (
        <View style={[styles.options, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.optionsTitle, { color: theme.textMuted }]}>Options de recherche</Text>
          {SEARCH_OPERATOR_HINTS.map((op) => (
            <Pressable
              key={op.token}
              onPress={() => insertOperator(op.insert)}
              style={styles.optionRow}
              accessibilityLabel={`Insérer ${op.token}`}
            >
              <Text style={[styles.optionToken, { color: theme.accent }]}>{op.token}</Text>
              <Text style={[styles.optionHint, { color: theme.textMuted }]}>{op.hint}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {hasQuery && (
        <ScrollView
          ref={scrollRef}
          onLayout={(event) => handleListLayout(event)}
          onScroll={(event) => handleListScroll(event)}
          style={styles.results}
          keyboardShouldPersistTaps="handled"
        >
          {loading && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Recherche…</Text>
            </View>
          )}
          {!loading && error && <Text style={[styles.error, { color: theme.danger }]}>⚠️ {error}</Text>}
          {!loading && !error && visibleResults.length === 0 && (
            <Text style={[styles.muted, { color: theme.textMuted }]}>Aucun résultat.</Text>
          )}
          {!loading && !error && visibleResults.length > 0 && (
            <Text style={[styles.resultCount, { color: theme.textMuted }]}>
              {visibleResults.length} fichier{visibleResults.length > 1 ? 's' : ''}
            </Text>
          )}
          {!loading &&
            visibleResults.map((result, index) => {
              const isOpenable = isSearchResultOpenable(result.kind);
              const isSelected = index === selectedIndex;
              const count = result.matchCount ?? 0;
              return (
                <Pressable
                  key={searchResultKey(result)}
                  onLayout={(event) => recordItemLayout(index, event)}
                  onPress={isOpenable ? () => onOpenResult(result) : undefined}
                  style={[
                    styles.result,
                    { borderColor: theme.border },
                    !isOpenable && styles.resultDisabled,
                    isSelected && { backgroundColor: `${theme.accent}22` },
                  ]}
                >
                  {isFileResultKind(result.kind) ? (
                    <View style={styles.resultIconBox}>
                      <FileTypeIcon kind={result.kind} relPath={result.relPath} size={16} />
                    </View>
                  ) : (
                    <Text style={styles.resultIcon}>{SEARCH_RESULT_ICON[result.kind]}</Text>
                  )}
                  <View style={styles.resultBody}>
                    <HighlightedText
                      text={result.name}
                      needles={result.needles}
                      query={query}
                      caseSensitive={caseSensitive}
                      theme={theme}
                      numberOfLines={1}
                      style={{ color: theme.text }}
                    />
                    {result.snippet ? (
                      <HighlightedText
                        text={result.snippet}
                        needles={result.needles}
                        query={query}
                        caseSensitive={caseSensitive}
                        theme={theme}
                        numberOfLines={2}
                        style={[styles.snippet, { color: theme.textMuted }]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.meta}>
                    {count > 0 && result.matchType === 'content' ? (
                      <Text style={[styles.matchType, { color: theme.textMuted }]}>
                        {count} correspondance{count > 1 ? 's' : ''}
                      </Text>
                    ) : (
                      <Text style={[styles.matchType, { color: theme.textMuted }]}>
                        {SEARCH_MATCH_LABEL[result.matchType]}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
    flexGrow: 1,
    minHeight: 0,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 0,
  },
  iconBtn: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 6,
  },
  options: {
    borderBottomWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 2,
  },
  optionsTitle: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  optionRow: {
    paddingVertical: 6,
    gap: 2,
  },
  optionToken: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
  },
  optionHint: {
    fontSize: 11,
  },
  results: {
    flexGrow: 1,
    flexShrink: 1,
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
  resultCount: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingBottom: 4,
    paddingTop: 6,
  },
  matched: {
    fontWeight: '700',
  },
  error: {
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
  resultIconBox: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultIcon: {
    fontSize: 16,
  },
  resultBody: {
    flex: 1,
    minWidth: 0,
  },
  snippet: {
    fontSize: 12,
    marginTop: 2,
  },
  meta: {
    maxWidth: 90,
    alignItems: 'flex-end',
  },
  matchType: {
    fontSize: 11,
    textAlign: 'right',
  },
});
