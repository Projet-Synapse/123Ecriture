import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, Text, View } from 'react-native';

import { journalEntryLabel, type SyncJournalEntry, type SyncJournalEntryType } from '../../lib/sync/journal';
import { SYNC_JOURNAL_READ_PATH } from '../../lib/sync/syncEngine';
import { buildLocalDiagnostics } from '../../lib/sync/deviceGateway';
import { formatDiagnosticsReport } from '../../lib/sync/diagnostics';
import { useVaults } from '../../lib/sync/VaultsContext';
import { exporterDiagnosticDansCoffre } from '../../lib/sync/diagnosticExport';
import { usePreferences } from '../../preferences/PreferencesContext';
import { SyncReviewSection } from './SyncReviewSection';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/SyncJournalSection.tsx — le journal de synchronisation
//////////////////////////////////////////////////////////////////////////////
//
// Écran « Journal de synchronisation » — l'équivalent du journal d'Obsidian
// Sync : chaque cycle (avec son déclencheur), envoi, réception,
// suppression, conflit, erreur, pause et restauration y est tracé, du plus
// récent au plus ancien.
//
// Invariants du fichier :
//   • Le journal vit dans `.123ecriture/sync-journal.json` du coffre ACTIF :
//     il est propre à chaque appareil (comme Obsidian).
//   • Relecture périodique (2,5 s) tant que l'écran est ouvert — assez
//     pour voir un cycle « en direct » quand un autre appareil pousse des
//     changements.
//   • La date COMPLÈTE (jour inclus) s'affiche en plus de l'heure : un
//     journal qui s'étale sur plusieurs jours doit dire quel jour chaque
//     événement a eu lieu.
//   • Le diagnostic copiable (🩺) assemble l'état complet (version,
//     coffres, permission, revue, journal) dans le presse-papiers, prêt à
//     transmettre.
//   • La revue de sécurité (SyncReviewSection) s'affiche au-dessus du
//     journal : rien à trancher = rien de visible.
//
// SOMMAIRE :
//   1. Les filtres, icônes et formatage du journal
//   2. SyncJournalSection — la carte (revue, filtres, recherche, copie)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Les filtres, icônes et formatage du journal ///////////////////////////////////

type FilterId = 'tout' | 'envois' | 'receptions' | 'suppressions' | 'conflits' | 'erreurs';

const FILTERS: { id: FilterId; label: string; types?: SyncJournalEntryType[] }[] = [
  { id: 'tout', label: 'Tout' },
  { id: 'envois', label: 'Envois', types: ['push', 'modification'] },
  { id: 'receptions', label: 'Réceptions', types: ['pull'] },
  // « corbeille » = le continu d'un déplacement en corbeille (le push du
  // chemin `.trash/…`) — lu avec les suppressions, pas avec les envois,
  // pour raconter UN geste et non deux.
  { id: 'suppressions', label: 'Suppressions', types: ['delete', 'restore', 'corbeille'] },
  { id: 'conflits', label: 'Conflits', types: ['conflict'] },
  { id: 'erreurs', label: 'Erreurs', types: ['error'] },
];

const ICON_BY_TYPE: Record<SyncJournalEntryType, string> = {
  'cycle-start': '🔄',
  'cycle-end': '✅',
  push: '⬆️',
  modification: '✏️',
  'modification-reçue': '✏️',
  corbeille: '🗑️',
  pull: '⬇️',
  delete: '🗑️',
  conflict: '⚠️',
  error: '❌',
  pause: '⏸️',
  resume: '▶️',
  restore: '↩️',
  info: 'ℹ️',
  connexion: '🔌',
  'upload-start': '⬆️',
  'upload-end': '✅',
  'download-start': '⬇️',
  'download-end': '✅',
};

// La date COMPLÈTE (jour inclus) s'affiche en plus de l'heure — un journal
// qui s'étale sur plusieurs jours doit dire quel jour chaque événement a
// eu lieu.
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
}

// v0.4.91 — JOURNAL LISIBLE D'UN COUP D'ŒIL : la direction de chaque
// événement se voit à la COULEUR, pas seulement à l'icône — envoi vert,
// réception bleue, suppression/corbeille orange, conflit violet (l'erreur
// garde la couleur du thème). Les pastilles sont lisibles sur les deux
// thèmes.
const COULEUR_PAR_TYPE: Partial<Record<SyncJournalEntryType, string>> = {
  push: '#2e7d32',
  modification: '#2e7d32',
  'modification-reçue': '#1565c0',
  pull: '#1565c0',
  corbeille: '#e65100',
  delete: '#e65100',
  conflict: '#6a1b9a',
};

// Le jour d'une entrée (l'en-tête de groupe quand le jour change).
function formatJour(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Le détail d'un cycle-end (« X envoyé(s), Y reçu(s), … ») en compteurs
// exploitables pour la bande résumé du dernier cycle.
function parseCycleEnd(detail: string): { sent: number; pulled: number; deleted: number; conflicts: number; modifications: number } | null {
  const nombre = (motif: RegExp) => {
    const m = detail.match(motif);
    return m ? parseInt(m[1], 10) : 0;
  };
  if (!/envoyé/.test(detail)) return null;
  return {
    sent: nombre(/(\d+) envoyé/),
    pulled: nombre(/(\d+) reçu/),
    deleted: nombre(/(\d+) supprimé/),
    conflicts: nombre(/(\d+) conflit/),
    modifications: nombre(/(\d+) modification/),
  };
}

//////// 2. SyncJournalSection — la carte (revue, filtres, recherche, copie) ///////////////

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

  // v0.4.91 — BANDE RÉSUMÉ : le bilan du dernier cycle en pastilles, sans
  // lire la liste. Disparaît quand aucun cycle n'est enregistré.
  const dernierCycle = useMemo(() => {
    const fin = reversed.find((entry) => entry.type === 'cycle-end');
    return fin ? { at: fin.t, bilan: parseCycleEnd(fin.detail ?? '') } : null;
  }, [reversed]);

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

  // 🩺 diagnostic copiable (l'app devient ses propres yeux) : assemble
  // l'état complet (version, coffres, permission, revue, journal) dans le
  // presse-papiers, prêt à transmettre.
  const [diagCopied, setDiagCopied] = useState(false);
  const [diagExporté, setDiagExporté] = useState(false);
  const copyDiagnostic = async () => {
    try {
      const report = await buildLocalDiagnostics();
      await navigator.clipboard.writeText(formatDiagnosticsReport(report));
      setDiagCopied(true);
      setTimeout(() => setDiagCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible — silencieux.
    }
  };

  // §16 : l'export des états privés (registre, index, session masquée,
  // sync-state, revue) dans le coffre — lisible par le câble (adb) et par
  // le PC, jamais synchronisé (hors liste blanche).
  const exporterDiagnostic = async () => {
    try {
      const chemin = await exporterDiagnosticDansCoffre();
      setDiagExporté(true);
      setTimeout(() => setDiagExporté(false), 2500);
      Alert.alert('Diagnostic exporté', 'Écrit dans le coffre : ' + chemin);
    } catch (error) {
      Alert.alert('Export impossible', String((error as Error)?.message ?? error));
    }
  };

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <SyncReviewSection />
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

      {/* v0.4.72 — recherche + copie sur la même ligne : le bouton « Copier
          le journal » devient une icône (il flottait par-dessus l'historique,
          vécu 17/10), et la liste défile DANS son cadre au lieu de déborder. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher un fichier…"
          placeholderTextColor={theme.textMuted}
          style={[s.input, { color: theme.text, borderColor: theme.border, flex: 1, minWidth: 0 }]}
        />
        <Pressable
          onPress={() => void copyDiagnostic()}
          accessibilityLabel="Copier le diagnostic"
          style={[s.modeButton, { borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 8 }]}
        >
          <Text style={{ color: theme.text, fontSize: 16 }}>{diagCopied ? '✅' : '🩺'}</Text>
        </Pressable>
        <Pressable
          onPress={() => void exporterDiagnostic()}
          accessibilityLabel="Exporter le diagnostic complet dans le coffre"
          style={[s.modeButton, { borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 8 }]}
        >
          <Text style={{ color: theme.text, fontSize: 16 }}>{diagExporté ? '✅' : '🗄️'}</Text>
        </Pressable>
        <Pressable
          onPress={() => void copyJournal()}
          accessibilityLabel="Copier le journal"
          style={[s.modeButton, { borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 8 }]}
        >
          <Text style={{ color: theme.text, fontSize: 16 }}>{copied ? '✅' : '📋'}</Text>
        </Pressable>
      </View>

      {/* v0.4.91 — RÉSUMÉ DU DERNIER CYCLE : le bilan en pastilles colorées,
          lisible sans parcourir la liste. */}
      {dernierCycle && dernierCycle.bilan && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
          }}
        >
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>Dernier cycle {formatTime(dernierCycle.at)}</Text>
          <Text style={{ color: '#2e7d32', fontSize: 12, fontWeight: '600' }}>⬆️ {dernierCycle.bilan.sent}</Text>
          <Text style={{ color: '#1565c0', fontSize: 12, fontWeight: '600' }}>⬇️ {dernierCycle.bilan.pulled}</Text>
          <Text style={{ color: '#e65100', fontSize: 12, fontWeight: '600' }}>🗑️ {dernierCycle.bilan.deleted}</Text>
          <Text style={{ color: '#6a1b9a', fontSize: 12, fontWeight: '600' }}>⚠️ {dernierCycle.bilan.conflicts}</Text>
          <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600' }}>✏️ {dernierCycle.bilan.modifications}</Text>
        </View>
      )}

      {entries === null ? (
        <ActivityIndicator color={theme.accent} />
      ) : visible.length === 0 ? (
        <Text style={[s.hint, { color: theme.textMuted }]}>
          {entries.length === 0
            ? 'Aucune activité enregistrée pour ce coffre — le journal se remplira au prochain cycle.'
            : 'Aucune entrée ne correspond au filtre.'}
        </Text>
      ) : (
        <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
          {visible.slice(0, 200).map((entry, index) => {
            // v0.4.91 — SÉPARATEUR DE JOUR : quand le jour change entre
            // deux entrées consécutives (du plus récent au plus ancien),
            // un en-tête de date évite de deviner « quel jour » on lit.
            const jour = formatJour(entry.t);
            const jourPrécédent = index > 0 ? formatJour(visible[index - 1].t) : null;
            const nouveauJour = jour && jour !== jourPrécédent;
            const couleur = COULEUR_PAR_TYPE[entry.type] ?? (entry.type === 'error' ? theme.danger : theme.text);
            return (
              <View key={`${entry.t}-${index}`}>
                {nouveauJour && (
                  <Text
                    style={{
                      color: theme.textMuted,
                      fontSize: 11,
                      fontWeight: '700',
                      textTransform: 'capitalize',
                      marginTop: index === 0 ? 0 : 10,
                      marginBottom: 4,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: theme.border,
                      paddingTop: index === 0 ? 0 : 6,
                    }}
                  >
                    {jour}
                  </Text>
                )}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ color: theme.textMuted, fontFamily: 'monospace', fontSize: 12, minWidth: 86 }}>
                    {formatTime(entry.t)}
                  </Text>
                  <Text style={{ color: couleur, fontSize: 13, flex: 1 }}>
                    {ICON_BY_TYPE[entry.type]} {journalEntryLabel(entry)}
                  </Text>
                </View>
              </View>
            );
          })}
          {visible.length > 200 && (
            <Text style={[s.hint, { color: theme.textMuted }]}>+ {visible.length - 200} entrée(s) plus anciennes…</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}
