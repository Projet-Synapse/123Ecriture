import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../theme';
import {
  availableChoices,
  choiceLabel,
  reasonLabel,
  suggestRenamedPath,
  type ConflictChoice,
  type ConflictQueue,
  type ConflictSide,
  type PendingConflict,
} from '../lib/sync/conflictQueue';
import { conflictStore } from '../lib/sync/conflictStore';

// ✒️ 123ECRITURE — components/ConflictSheet.tsx — conflits de nom en attente
//////////////////////////////////////////////////////////////////////////////
//
// Feuille ancrée en bas de la page COURANTE (mobile, web, desktop) — pas une
// Modal : le reste de l'app reste utilisable. Montre le premier conflit de
// la file persistée, un aperçu court des deux côtés, et les choix possibles.
// « Plus tard » réduit la feuille en pastille ; rien n'est jamais tranché
// tant que l'utilisateur n'a pas choisi.

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR');
}

function SideCard({ title, side, theme }: { title: string; side: ConflictSide; theme: Theme }) {
  return (
    <View style={[styles.side, { borderColor: theme.border }]}>
      <Text style={[styles.sideTitle, { color: theme.textMuted }]}>{title}</Text>
      <Text style={[styles.path, { color: theme.text }]} numberOfLines={2}>
        {side.relPath}
      </Text>
      <Text style={[styles.meta, { color: theme.textMuted }]}>
        {formatSize(side.sizeBytes)} · {formatDate(side.modifiedAt)}
      </Text>
      <Text style={[styles.meta, { color: theme.textMuted }]}>{side.device}</Text>
    </View>
  );
}

export function ConflictSheet({ theme }: { theme: Theme }) {
  const [queue, setQueue] = useState<ConflictQueue>(conflictStore.getQueue());
  const [minimized, setMinimized] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  // Saisie et erreur rattachées à l'id du conflit affiché : passer au
  // suivant repart de la suggestion, sans effet de synchronisation.
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    const unsubscribe = conflictStore.subscribe(setQueue);
    conflictStore.load().catch(() => undefined);
    return unsubscribe;
  }, []);

  const current: PendingConflict | undefined = queue.conflicts[0];
  const remaining = queue.conflicts.length;

  const suggestion = useMemo(() => {
    if (!current) return '';
    const taken = new Set<string>([current.existing.relPath]);
    for (const c of queue.conflicts) taken.add(c.existing.relPath);
    return suggestRenamedPath(current.incoming.relPath, taken);
  }, [current, queue.conflicts]);

  if (!current) return null;
  const newName = edit?.id === current.id ? edit.name : suggestion;
  const setNewName = (name: string) => setEdit({ id: current.id, name });
  const error = failure?.id === current.id ? failure.message : null;
  const setError = (message: string | null) => setFailure(message ? { id: current.id, message } : null);

  if (minimized) {
    return (
      <Pressable
        style={[styles.pill, { backgroundColor: theme.accent }]}
        onPress={() => setMinimized(false)}
        accessibilityLabel={`${remaining} conflit(s) de nom en attente`}
      >
        <Text style={styles.pillText}>⚠ {remaining} conflit{remaining > 1 ? 's' : ''} de nom</Text>
      </Pressable>
    );
  }

  const choices = availableChoices(current);
  const merge = !choices.includes('merge');
  const ordered: ConflictChoice[] = ['merge', 'rename', 'replace', 'keep-both', 'cancel'];

  const choose = async (choice: ConflictChoice) => {
    setBusy(true);
    setError(null);
    try {
      const res = await conflictStore.resolve(
        current.id,
        { choice, newName: choice === 'rename' ? newName.trim() || undefined : undefined },
        applyToAll,
      );
      if (res.failed.length > 0) setFailure({ id: res.failed[0].id, message: res.failed.map((f) => f.message).join('\n') });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
      accessibilityRole="alert"
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>
          Conflit de nom{remaining > 1 ? ` (1/${remaining})` : ''}
        </Text>
        <Pressable onPress={() => setMinimized(true)} accessibilityLabel="Plus tard">
          <Text style={[styles.later, { color: theme.accent }]}>Plus tard</Text>
        </Pressable>
      </View>
      <Text style={[styles.meta, { color: theme.textMuted }]}>{reasonLabel(current.reason)}</Text>

      <View style={styles.sides}>
        <SideCard title="Existant" side={current.existing} theme={theme} />
        <SideCard title="Entrant" side={current.incoming} theme={theme} />
      </View>
      {current.diffSummary && (
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          Différences : +{current.diffSummary.addedChars} / −{current.diffSummary.removedChars} caractères
        </Text>
      )}
      {merge && current.reason !== 'invalid-name' && (
        <Text style={[styles.meta, { color: theme.textMuted }]}>Fusion indisponible (fichier non texte).</Text>
      )}

      {choices.includes('rename') && (
        <TextInput
          value={newName}
          onChangeText={setNewName}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          accessibilityLabel="Nouveau nom"
          autoCapitalize="none"
        />
      )}

      <View style={styles.buttons}>
        {ordered.map((choice) => {
          const enabled = choices.includes(choice) && !busy;
          return (
            <Pressable
              key={choice}
              disabled={!enabled}
              onPress={() => void choose(choice)}
              style={[
                styles.button,
                { borderColor: theme.border, opacity: enabled ? 1 : 0.4 },
                choice === 'cancel' && { borderColor: theme.accent },
              ]}
            >
              <Text style={{ color: theme.text }}>{choiceLabel(choice, current.origin)}</Text>
            </Pressable>
          );
        })}
      </View>

      {remaining > 1 && (
        <Pressable
          style={styles.checkRow}
          onPress={() => setApplyToAll((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: applyToAll }}
        >
          <Text style={{ color: theme.text }}>{applyToAll ? '☑' : '☐'} Appliquer à tous les conflits restants</Text>
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    maxWidth: 640,
    alignSelf: 'center',
    marginHorizontal: 'auto',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    zIndex: 50,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
  later: { fontSize: 14 },
  sides: { flexDirection: 'row', gap: 8 },
  side: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 8, gap: 2 },
  sideTitle: { fontSize: 11, textTransform: 'uppercase' },
  path: { fontSize: 13, fontWeight: '500' },
  meta: { fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  button: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  checkRow: { paddingVertical: 4 },
  error: { color: '#c0392b', fontSize: 12 },
  pill: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 50,
    elevation: 12,
  },
  pillText: { color: '#fff', fontWeight: '600' },
});
