import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { lockingPath, normalizeLockedPaths } from '../../lib/ai/aiLock';
import {
  AI_ACTIONS,
  AI_JOURNAL_PATH,
  AI_PERMISSION_LABELS,
  generateAiToken,
  normalizeAiGateway,
  parseAiJournal,
  type AiGatewaySettings,
  type AiJournalEntry,
  type AiPermission,
} from '../../lib/ai/aiPolicy';
import { sha256HexOfText } from '../../lib/sync/nativeSha256';
import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';
import { VaultPicker, type Choice } from './TemplatesSection';

// ✒️ 123ECRITURE — components/settings/AiSection.tsx — 🤖 IA : verrouillage
//////////////////////////////////////////////////////////////////////////////
//
// Section « 🤖 IA / Passerelle ». Partie 1 (v0.4.100) : la liste des
// dossiers et fichiers VERROUILLÉS pour l'IA (lib/ai/aiLock.ts) —
// ajouter, retirer. Même réglage que le clic droit « 🔒 Verrouiller pour
// l'IA » de l'explorateur ; stocké dans les préférences, répliquées dans
// le coffre (.123ecriture/preferences.json) donc synchronisées.
//
// Invariant : un élément verrouillé est TOUJOURS exclu de ce que l'IA
// peut voir ou toucher, quelles que soient les autres autorisations.
//
//////////////////////////////////////////////////////////////////////////////

function useVaultEntries(): Choice[] | null {
  const [entries, setEntries] = useState<Choice[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault?.listTree) {
        setEntries([]);
        return;
      }
      try {
        const tree = await window.vault.listTree();
        const out: Choice[] = [];
        const walk = (items: VaultTreeNode[]) => {
          for (const item of items) {
            out.push({ value: item.relPath, label: item.type === 'folder' ? `📁 ${item.relPath}` : item.relPath });
            if (item.type === 'folder') walk(item.children ?? []);
          }
        };
        walk(tree);
        if (!cancelled) setEntries(out);
      } catch {
        if (!cancelled) setEntries([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return entries;
}

export function AiLockSection() {
  const { preferences, theme, setAiLockedPaths } = usePreferences();
  const locked = useMemo(() => normalizeLockedPaths(preferences.aiLockedPaths), [preferences.aiLockedPaths]);
  const entries = useVaultEntries();
  // Déjà couverts (directement ou par un dossier parent) : pas proposés.
  const addable = useMemo(() => (entries ?? []).filter((e) => !lockingPath(e.value, locked)), [entries, locked]);
  const known = useMemo(() => new Set((entries ?? []).map((e) => e.value.toLowerCase())), [entries]);

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🔒 Verrouillé pour l’IA</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        L’IA ne peut ni voir, ni lire, ni chercher, ni modifier ces dossiers et fichiers. Un dossier verrouillé
        verrouille tout ce qu’il contient. Le verrou suit les renommages et déplacements, et se synchronise avec tes
        autres appareils. Raccourci : clic droit (ou appui long) sur un élément de l’explorateur.
      </Text>
      {locked.length === 0 && <Text style={[s.hint, { color: theme.textMuted }]}>Rien n’est verrouillé.</Text>}
      {locked.map((path) => (
        <View key={path} style={[s.row, { alignItems: 'center' }]}>
          <Text style={{ color: theme.text, flex: 1 }} numberOfLines={1}>
            🔒 {path}
            {entries && !known.has(path.toLowerCase()) ? (
              <Text style={{ color: theme.textMuted, fontSize: 12 }}> (introuvable)</Text>
            ) : null}
          </Text>
          <Pressable
            onPress={() => void setAiLockedPaths(locked.filter((p) => p !== path))}
            accessibilityRole="button"
            accessibilityLabel={`Déverrouiller ${path}`}
            style={[s.modeButton, { borderColor: theme.border, paddingHorizontal: 10 }]}
          >
            <Text style={{ color: theme.text }}>🔓 Déverrouiller</Text>
          </Pressable>
        </View>
      ))}
      <Text style={[s.label, { color: theme.textMuted }]}>Verrouiller un dossier ou un fichier</Text>
      <View style={s.row}>
        <VaultPicker
          value=""
          choices={addable}
          placeholder={entries ? 'Choisir dans le coffre…' : 'Chargement…'}
          onSelect={(path) => {
            if (path) void setAiLockedPaths([...locked, path]);
          }}
        />
      </View>
    </View>
  );
}

//////// Passerelle : activation, autorisations, dossiers, jeton, journal ////////

function TriState({ value, onChange }: { value: AiPermission; onChange: (v: AiPermission) => void }) {
  const { theme } = usePreferences();
  return (
    <View style={[s.row, { gap: 4 }]}>
      {(['deny', 'ask', 'allow'] as AiPermission[]).map((p) => (
        <Pressable
          key={p}
          onPress={() => onChange(p)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === p }}
          style={[
            s.modeButton,
            {
              borderColor: value === p ? theme.accent : theme.border,
              backgroundColor: value === p ? theme.accent : 'transparent',
              paddingHorizontal: 8,
            },
          ]}
        >
          <Text style={{ color: value === p ? '#fff' : theme.text, fontSize: 12 }}>{AI_PERMISSION_LABELS[p]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function useAiJournal(): { entries: AiJournalEntry[]; reload: () => void; clear: () => void } {
  const [entries, setEntries] = useState<AiJournalEntry[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const vault = typeof window !== 'undefined' ? window.vault : undefined;
    if (!vault?.readNote) return;
    vault
      .readNote(AI_JOURNAL_PATH)
      .then((text) => !cancelled && setEntries(parseAiJournal(text)))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  const clear = () => {
    const vault = typeof window !== 'undefined' ? window.vault : undefined;
    if (!vault?.writeNote) return;
    void vault.writeNote(AI_JOURNAL_PATH, '[]').then(() => setTick((t) => t + 1));
  };
  return { entries, reload: () => setTick((t) => t + 1), clear };
}

export function AiGatewaySection() {
  const { preferences, theme, setAiGateway } = usePreferences();
  const gateway = useMemo(() => normalizeAiGateway(preferences.aiGateway), [preferences.aiGateway]);
  const save = (patch: Partial<AiGatewaySettings>) => void setAiGateway({ ...gateway, ...patch });
  const entries = useVaultEntries();
  const folderChoices = useMemo(
    () =>
      (entries ?? []).filter(
        (e) => e.label.startsWith('📁') && !gateway.allowedFolders.some((f) => f.toLowerCase() === e.value.toLowerCase()),
      ),
    [entries, gateway.allowedFolders],
  );
  // Jeton affiché UNE seule fois, juste après sa création (seule son
  // empreinte est enregistrée).
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const journal = useAiJournal();
  const isDesktop = typeof window !== 'undefined' && !!window.preferences;

  const createToken = () => {
    const token = generateAiToken();
    if (!token) {
      setTokenError('Pas de générateur aléatoire sûr ici : crée le jeton depuis l’app PC.');
      return;
    }
    setTokenError(null);
    setFreshToken(token);
    save({ tokenHash: sha256HexOfText(token), tokenHint: token.slice(-4), tokenCreatedAt: new Date().toISOString() });
  };
  const revokeToken = () => {
    setFreshToken(null);
    save({ tokenHash: undefined, tokenHint: undefined, tokenCreatedAt: undefined });
  };
  const button = (label: string, onPress: () => void, a11y?: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      style={[s.modeButton, { borderColor: theme.border, paddingHorizontal: 10 }]}
    >
      <Text style={{ color: theme.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🤖 Passerelle IA</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Permet à une IA locale (le Qwen de ton PC, via Ollama) d’accéder à ton coffre, selon les règles ci-dessous.
        Les éléments verrouillés restent toujours inaccessibles.
        {isDesktop ? '' : ' La passerelle tourne sur l’app PC ; ces réglages sont partagés par la synchronisation.'}
      </Text>
      <SettingsToggle
        label="Activer la passerelle IA"
        value={gateway.enabled}
        onChange={(enabled) => save({ enabled })}
        theme={theme}
      />

      <Text style={[s.label, { color: theme.textMuted }]}>Autorisations</Text>
      {AI_ACTIONS.map((a) => (
        <View key={a.id} style={[s.row, { alignItems: 'center', flexWrap: 'wrap' }]}>
          <Text style={{ color: theme.text, flex: 1, minWidth: 180 }}>{a.label}</Text>
          <TriState
            value={gateway.permissions[a.id]}
            onChange={(v) => save({ permissions: { ...gateway.permissions, [a.id]: v } })}
          />
        </View>
      ))}

      <Text style={[s.label, { color: theme.textMuted }]}>Dossiers autorisés</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        {gateway.allowedFolders.length === 0
          ? 'Aucun : tout le coffre (sauf le verrouillé). Ajoute un dossier pour limiter l’IA à ces dossiers.'
          : 'L’IA ne voit que ces dossiers (et leurs sous-dossiers), moins le verrouillé.'}
      </Text>
      {gateway.allowedFolders.map((f) => (
        <View key={f} style={[s.row, { alignItems: 'center' }]}>
          <Text style={{ color: theme.text, flex: 1 }} numberOfLines={1}>
            📁 {f}
          </Text>
          {button('✕ Retirer', () => save({ allowedFolders: gateway.allowedFolders.filter((x) => x !== f) }), `Retirer ${f}`)}
        </View>
      ))}
      <View style={s.row}>
        <VaultPicker
          value=""
          choices={folderChoices}
          placeholder={entries ? 'Ajouter un dossier autorisé…' : 'Chargement…'}
          onSelect={(path) => {
            if (path) save({ allowedFolders: [...gateway.allowedFolders, path] });
          }}
        />
      </View>

      <Text style={[s.label, { color: theme.textMuted }]}>Jeton d’accès</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        {gateway.tokenHash
          ? `Jeton actif (…${gateway.tokenHint ?? ''}${gateway.tokenCreatedAt ? `, créé le ${new Date(gateway.tokenCreatedAt).toLocaleString('fr-FR')}` : ''}). Le révoquer coupe immédiatement l’accès.`
          : 'Aucun jeton : aucune IA ne peut se connecter.'}
      </Text>
      {freshToken && (
        <View style={{ gap: 4, borderWidth: 1, borderColor: theme.accent, borderRadius: 8, padding: 8 }}>
          <Text style={[s.hint, { color: theme.text }]}>
            Copie ce jeton maintenant, il ne sera plus affiché (seule son empreinte est enregistrée) :
          </Text>
          <Text selectable style={{ color: theme.text, fontFamily: 'monospace', fontSize: 12 }}>
            {freshToken}
          </Text>
          {typeof navigator !== 'undefined' && navigator.clipboard
            ? button('📋 Copier', () => void navigator.clipboard.writeText(freshToken))
            : null}
        </View>
      )}
      {tokenError && <Text style={[s.hint, { color: theme.danger }]}>{tokenError}</Text>}
      <View style={s.row}>
        {button(gateway.tokenHash ? '🔁 Générer un nouveau jeton' : '🔑 Générer un jeton', createToken)}
        {gateway.tokenHash ? button('⛔ Révoquer', revokeToken) : null}
      </View>

      <Text style={[s.label, { color: theme.textMuted }]}>Journal des actions (cet appareil)</Text>
      {journal.entries.length === 0 && (
        <Text style={[s.hint, { color: theme.textMuted }]}>Aucune action de l’IA pour l’instant.</Text>
      )}
      {journal.entries.slice(0, 100).map((e, i) => (
        <Text key={`${e.at}-${i}`} style={{ color: theme.text, fontSize: 12 }} numberOfLines={2}>
          {e.decision === 'allow' ? '✅' : e.decision === 'ask' ? '❓' : '⛔'} {new Date(e.at).toLocaleString('fr-FR')} ·{' '}
          {e.action} · {e.path || '/'}
          {e.decision !== 'allow' ? ` — ${e.reason}` : ''}
        </Text>
      ))}
      <View style={s.row}>
        {button('↻ Rafraîchir', journal.reload)}
        {journal.entries.length > 0 ? button('🗑 Vider le journal', journal.clear) : null}
      </View>
    </View>
  );
}
