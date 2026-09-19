import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, Text, View } from 'react-native';

import { journalEntryLabel, type SyncJournalEntry, type SyncJournalEntryType } from '../../lib/sync/journal';
import { SYNC_JOURNAL_READ_PATH } from '../../lib/sync/syncEngine';
import { useVaults } from '../../lib/sync/VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { settingsStyles as s } from './settingsStyles';

// Écran « Journal de synchronisation » (v0.4.27) — l'équivalent du journal
// d'Obsidian Sync : chaque cycle (avec son déclencheur), envoi, réception,
// suppression, conflit, erreur, pause et restauration y est tracé, du plus
// récent au plus ancien. Le journal vit dans `.123ecriture/sync-journal.json`
// du coffre ACTIF : il est propre à chaque appareil (comme Obsidian) et se
// rafraîchit ici toutes les 2,5 s tant l'écran est ouvert — assez pour voir
// un cycle « en direct » quand un autre appareil pousse des changements.

type FilterId = 'tout' | 'envois' | 'receptions' | 'suppressions' | 'conflits' | 'erreurs';

const FILTERS: { id: FilterId; label: string; types?: SyncJournalEntryType[] }[] = [
  { id: 'tout', label: 'Tout' },
  { id: 'envois', label: 'Envois', types: ['push'] },
  { id: 'receptions', label: 'Réceptions', types: ['pull'] },
  { id: 'suppressions', label: 'Suppressions', types: ['delete', 'restore'] },
  { id: 'conflits', label: 'Conflits', types: ['conflict'] },
  { id: 'erreurs', label: 'Erreurs', types: ['error'] },
];

const ICON_BY_TYPE: Record<SyncJournalEntryType, string> = {
  'cycle-start': '🔄',
  'cycle-end': '✅',
  push: '⬆️',
  pull: '⬇️',
  delete: '🗑️',
  conflict: '⚠️',
  error: '❌',
  pause: '⏸️',
  resume: '▶️',
  restore: '↩️',
  info: 'ℹ️',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0')
  );
}

export function SyncJournalSection() {
  const { theme } = usePreferences();
  const { activeVault } = useVaults();
  const [entries, setEntries] = useState<SyncJournalEntry[] | null>(null);
  const [filter, setFilter] = useState<FilterId>('tout');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const searchRef = useRef(search);

  // Relecture périodique tant l'écran est ouvert — c'est ce qui donne le
  // rendu « en direct » (le moteur écrit le journal à chaque cycle).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault?.readNote) return;
      try {
        const raw = await window.vault.readNote(SYNC_JOURNAL_READ_PATH);
        const parsed = JSON.parse(raw) as { entries?: SyncJournalEntry[] };
        if (!cancelled) setEntries(Array.isArray(parsed.entries) ? parsed.entries : []);
      } catch {
        if (!cancelled) setEntries([]);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeVault?.id]);

  const reversed = useMemo(() => (entries ? [...entries].reverse() : []), [entries]);
  const activeFilter = FILTERS.find((f) => f.id === filter);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reversed.filter((entry) => {
      if (activeFilter?.types && !activeFilter.types.includes(entry.type)) return false;
      if (!query) return true;
      return journalEntryLabel(entry).toLowerCase().includes(query);
    });
  }, [reversed, activeFilter, search]);

  const copyJournal = async () => {
    try {
      const text = reversed
        .map((entry) => `${formatTime(entry.t)} ${journalEntryLabel(entry)}`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      searchRef.current = search;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible — silencieux, le bouton n'est pas vital.
    }
  };

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🔄 Journal de synchronisation</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Activité de ce coffre sur cet appareil — cycles (et leur déclencheur), envois, réceptions, suppressions,
        conflits et erreurs. Se rafraîchit en direct. Le journal est propre à chaque appareil.
      </Text>

      <View style={s.row}>
        {FILTERS.map((f) => {
          const isActive = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[s.modeButton, { borderColor: theme.border }, isActive && { backgroundColor: theme.accent, borderColor: theme.accent }]}
            >
              <Text style={{ color: isActive ? '#fff' : theme.text }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Rechercher un fichier…"
        placeholderTextColor={theme.textMuted}
        style={[s.input, { color: theme.text, borderColor: theme.border, flex: 0, minWidth: 220 }]}
      />

      {entries === null ? (
        <ActivityIndicator color={theme.accent} />
      ) : visible.length === 0 ? (
        <Text style={[s.hint, { color: theme.textMuted }]}>
          {entries.length === 0
            ? 'Aucune activité enregistrée pour ce coffre — le journal se remplira au prochain cycle.'
            : 'Aucune entrée ne correspond au filtre.'}
        </Text>
      ) : (
        <View style={{ gap: 2, maxHeight: 420 }}>
          {visible.slice(0, 200).map((entry, index) => (
            <View key={`${entry.t}-${index}`} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: theme.textMuted, fontFamily: 'monospace', fontSize: 12, minWidth: 86 }}>
                {formatTime(entry.t)}
              </Text>
              <Text style={{ color: entry.type === 'error' ? theme.danger : theme.text, fontSize: 13, flex: 1 }}>
                {ICON_BY_TYPE[entry.type]} {journalEntryLabel(entry)}
              </Text>
            </View>
          ))}
          {visible.length > 200 && (
            <Text style={[s.hint, { color: theme.textMuted }]}>+ {visible.length - 200} entrée(s) plus anciennes…</Text>
          )}
        </View>
      )}

      <Pressable onPress={() => void copyJournal()} style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}>
        <Text style={{ color: theme.text }}>{copied ? '✓ Copié' : 'Copier le journal'}</Text>
      </Pressable>
    </View>
  );
}
