import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useVaults } from '../../lib/sync/VaultsContext';
import {
  SYNC_CATEGORY_LABELS,
  loadSyncSettings,
  resumeSyncAfterUpdate,
  saveSyncSettings,
  subscribeSyncSettings,
  type SyncFileCategory,
  type SyncSettings,
} from '../../lib/sync/syncSettings';
import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { MergeLinkDialog, type MergeChoice } from '../dialogs/MergeLinkDialog';
import { listRemoteVaults } from '../../lib/sync/cloud';
import type { RemoteVaultSummary } from '../../lib/sync/syncTypes';
import { remotesNeedingMerge } from '../../lib/sync/linkGate';
import { VaultSwitcherSection } from './VaultSwitcherSection';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/SyncSettingsSection.tsx — les VRAIS paramètres de synchronisation
//////////////////////////////////////////////////////////////////////////////
//
// Remplace l'ancienne section « Coffres actifs ». Chaque interrupteur est
// LU par le moteur (syncEngine.ts → syncSettings.ts) à chaque cycle :
//   • sync globale / par coffre (désactivée = l'app reste 100 % locale) ;
//   • par type de fichier (Markdown, images, PDF, audio, vidéo, canvas/base,
//     autres, configuration) — un type désactivé n'est NI envoyé NI reçu NI
//     supprimé, et sa base est conservée (le réactiver ne supprime rien) ;
//   • dossiers vides ; Wi-Fi uniquement (Android).
// Le journal de synchronisation reste dans sa section dédiée.
//
//////////////////////////////////////////////////////////////////////////////

const CATEGORIES: SyncFileCategory[] = ['markdown', 'images', 'pdf', 'audio', 'video', 'canvas', 'other', 'config'];

export function SyncSettingsSection() {
  const { theme } = usePreferences();
  const { vaults } = useVaults();
  const [settings, setSettings] = useState<SyncSettings>(() => loadSyncSettings());
  useEffect(() => subscribeSyncSettings(setSettings), []);

  const update = (patch: Partial<SyncSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSyncSettings(next);
  };

  // « Reprendre » après une mise à jour : si un coffre lié a déjà des
  // fichiers dans le cloud, le dialogue de fusion est OBLIGATOIRE
  // (linkGate.ts) — la reprise enregistre le choix (linkPreference) comme
  // une liaison. Coffres distants vides : reprise directe.
  const [resumeMerge, setResumeMerge] = useState<{ remoteIds: string[]; remotes: RemoteVaultSummary[] | null } | null>(null);
  const requestResume = async () => {
    const linkedIds = vaults.filter((v) => v.cloudLinked && v.remoteVaultId).map((v) => v.remoteVaultId as string);
    let remotes: RemoteVaultSummary[] | null = null;
    try {
      remotes = await listRemoteVaults();
    } catch {
      remotes = null;
    }
    const remoteIds = remotesNeedingMerge(linkedIds, remotes);
    if (remoteIds.length === 0) {
      resumeSyncAfterUpdate();
      return;
    }
    setResumeMerge({ remoteIds, remotes });
  };
  const confirmResume = (choice: MergeChoice) => {
    const pending = resumeMerge;
    setResumeMerge(null);
    if (!pending) return;
    const current = loadSyncSettings();
    const linkPreference = { ...current.linkPreference };
    for (const id of pending.remoteIds) linkPreference[id] = choice;
    saveSyncSettings({ ...current, pausedAfterUpdate: false, linkPreference });
  };

  const cardStyle = [s.card, { backgroundColor: theme.surface, borderColor: theme.border }];
  const linked = vaults.filter((v) => v.cloudLinked && v.remoteVaultId);

  return (
    <>
      <View style={cardStyle}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🔄 Synchronisation</Text>
        <Text style={[s.hint, { color: theme.textMuted }]}>
          Vos fichiers vivent sur cet appareil ; le cloud n’en est qu’une copie. Désactiver la synchronisation ne supprime rien.
        </Text>
        {settings.pausedAfterUpdate && (
          <View style={{ gap: 8 }}>
            <Text style={[s.hint, { color: theme.text }]}>
              ⏸️ L’app vient d’être mise à jour : la synchronisation est en pause, rien n’est envoyé au cloud. Vos fichiers locaux (ou le cache de l’appareil) restent affichés.
              Sur ordinateur, reliez à nouveau un coffre distant (une fusion vous sera proposée) ; sur le téléphone, confirmez la reprise.
            </Text>
            <Pressable style={[s.button, { borderColor: theme.accent }]} onPress={() => void requestResume()}>
              <Text style={[s.buttonText, { color: theme.accent }]}>Reprendre la synchronisation</Text>
            </Pressable>
          </View>
        )}
        <SettingsToggle label="Synchronisation activée" value={settings.enabled} onChange={(v) => update({ enabled: v })} theme={theme} />
        <SettingsToggle label="Uniquement en Wi-Fi (Android)" value={settings.wifiOnly} onChange={(v) => update({ wifiOnly: v })} theme={theme} />
        <SettingsToggle label="Synchroniser les dossiers vides" value={settings.emptyFolders} onChange={(v) => update({ emptyFolders: v })} theme={theme} />
      </View>

      <View style={cardStyle}>
        <Text style={[s.cardTitle, { color: theme.text }]}>📄 Types de fichiers synchronisés</Text>
        {CATEGORIES.map((c) => (
          <SettingsToggle
            key={c}
            label={SYNC_CATEGORY_LABELS[c]}
            value={settings.types[c]}
            onChange={(v) => update({ types: { ...settings.types, [c]: v } })}
            theme={theme}
          />
        ))}
      </View>

      {linked.length > 0 && (
        <View style={cardStyle}>
          <Text style={[s.cardTitle, { color: theme.text }]}>📚 Coffres synchronisés</Text>
          {linked.map((v) => (
            <SettingsToggle
              key={v.id}
              label={v.name}
              value={settings.perVault[v.remoteVaultId as string] !== false}
              onChange={(on) => update({ perVault: { ...settings.perVault, [v.remoteVaultId as string]: on } })}
              theme={theme}
            />
          ))}
        </View>
      )}

      <VaultSwitcherSection />
      {resumeMerge && (
        <MergeLinkDialog
          theme={theme}
          vaultName={vaults.find((v) => v.remoteVaultId === resumeMerge.remoteIds[0])?.name ?? 'coffre local'}
          remoteName={resumeMerge.remotes?.find((r) => r.id === resumeMerge.remoteIds[0])?.name ?? 'coffre distant'}
          loadPreview={async () => ({
            local: null,
            remote: resumeMerge.remotes?.find((r) => r.id === resumeMerge.remoteIds[0])?.fileCount ?? null,
          })}
          onChoose={confirmResume}
          onCancel={() => setResumeMerge(null)}
        />
      )}
    </>
  );
}
