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
            <Pressable style={[s.button, { borderColor: theme.accent }]} onPress={resumeSyncAfterUpdate}>
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
    </>
  );
}
