import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { listEllieModels, resolveEllieHttp, testEllieConnection } from '../../lib/ai/ellieClient';
import { DEFAULT_AI_CHAT, normalizeAiChat, type AiChatProvider, type AiChatSettings } from '../../lib/ai/ellieSettings';
import { normalizeAiGateway } from '../../lib/ai/aiPolicy';
import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/EllieChatSection.tsx — réglages du chat Ellie
//////////////////////////////////////////////////////////////////////////////
//
// Carte « Connexion d'Ellie » dans Paramètres → 🤖 IA / Passerelle :
// fournisseur, URL, modèle, nom, prompt, test de connexion. Le panneau de
// chat lui-même reste inerte tant que la passerelle n'est pas activée.
//
//////////////////////////////////////////////////////////////////////////////

export function EllieChatSection() {
  const { preferences, theme, setAiChat } = usePreferences();
  const gateway = useMemo(() => normalizeAiGateway(preferences.aiGateway), [preferences.aiGateway]);
  const chat = useMemo(() => normalizeAiChat(preferences.aiChat), [preferences.aiChat]);
  const save = (patch: Partial<AiChatSettings>) => void setAiChat({ ...chat, ...patch });
  const [models, setModels] = useState<string[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const found = await testEllieConnection(chat, resolveEllieHttp());
      setModels(found);
      setStatus(`Connexion réussie. ${found.length} modèle(s) : ${found.slice(0, 8).join(', ')}${found.length > 8 ? '…' : ''}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const refreshModels = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const found = await listEllieModels(chat, resolveEllieHttp());
      setModels(found);
      if (found.length === 0) setStatus('Aucun modèle listé. Vérifie que le serveur est lancé.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const providerBtn = (id: AiChatProvider, label: string) => (
    <Pressable
      onPress={() => save({ provider: id, baseUrl: id === 'ollama' ? DEFAULT_AI_CHAT.baseUrl : 'http://127.0.0.1:1234' })}
      style={[s.modeButton, { borderColor: chat.provider === id ? theme.accent : theme.border }]}
    >
      <Text style={{ color: chat.provider === id ? theme.accent : theme.text }}>{label}</Text>
    </Pressable>
  );

  const input = (value: string, onChange: (v: string) => void, extra?: { multiline?: boolean; placeholder?: string }) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={extra?.placeholder}
      placeholderTextColor={theme.textMuted}
      multiline={extra?.multiline}
      style={[
        s.input,
        { color: theme.text, borderColor: theme.border, flex: 0 },
        extra?.multiline ? { minHeight: 88, textAlignVertical: 'top' } : null,
      ]}
    />
  );

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>💬 Ellie (chat dans l’app)</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Parle avec ton IA locale directement dans 123Écriture (panneau latéral). Ellie reste en lecture
        seule : elle propose, tu copies ou tu insères. Pour l’activer, coche « Activer la passerelle IA »
        ci-dessus. Mode d’emploi : docs/ellie.md.
        {gateway.enabled ? '' : ' (actuellement désactivée.)'}
      </Text>

      <Text style={[s.label, { color: theme.textMuted }]}>Fournisseur</Text>
      <View style={s.row}>
        {providerBtn('ollama', 'Ollama')}
        {providerBtn('openai', 'OpenAI / LM Studio')}
      </View>

      <Text style={[s.label, { color: theme.textMuted }]}>URL</Text>
      {input(chat.baseUrl, (baseUrl) => save({ baseUrl }), {
        placeholder: chat.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234',
      })}
      <Text style={[s.hint, { color: theme.textMuted }]}>
        {chat.provider === 'ollama'
          ? 'Sur ce PC : http://127.0.0.1:11434. Sur un téléphone, mets l’IP du PC (ex. http://192.168.1.26:11434) et lance Ollama avec OLLAMA_HOST=0.0.0.0 et OLLAMA_ORIGINS=*.'
          : 'LM Studio : démarre le serveur local (souvent le port 1234) et active CORS si besoin. L’URL peut se terminer par /v1.'}
      </Text>

      <Text style={[s.label, { color: theme.textMuted }]}>Modèle</Text>
      {input(chat.model, (model) => save({ model }), { placeholder: 'qwen3:8b' })}
      {models && models.length > 0 && (
        <View style={s.row}>
          {models.slice(0, 16).map((name) => (
            <Pressable
              key={name}
              onPress={() => save({ model: name })}
              style={[s.modeButton, { borderColor: chat.model === name ? theme.accent : theme.border }]}
            >
              <Text style={{ color: chat.model === name ? theme.accent : theme.text, fontSize: 12 }}>{name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={[s.label, { color: theme.textMuted }]}>Nom de l’IA</Text>
      {input(chat.name, (name) => save({ name }), { placeholder: 'Ellie' })}

      <Text style={[s.label, { color: theme.textMuted }]}>Prompt système / personnalité</Text>
      {input(chat.systemPrompt, (systemPrompt) => save({ systemPrompt }), { multiline: true })}

      {chat.provider === 'openai' ? (
        <>
          <Text style={[s.label, { color: theme.textMuted }]}>Clé API (optionnelle, LM Studio n’en a généralement pas besoin)</Text>
          {input(chat.apiKey ?? '', (apiKey) => save({ apiKey: apiKey || undefined }), { placeholder: 'sk-…' })}
        </>
      ) : null}

      <SettingsToggle
        label="Joindre la note ouverte par défaut"
        value={chat.includeCurrentNote}
        onChange={(includeCurrentNote) => save({ includeCurrentNote })}
        theme={theme}
      />

      <View style={s.row}>
        <Pressable
          onPress={() => void test()}
          disabled={busy}
          style={[s.button, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={s.buttonText}>{busy ? 'Test…' : 'Tester la connexion'}</Text>
        </Pressable>
        <Pressable onPress={() => void refreshModels()} disabled={busy} style={[s.modeButton, { borderColor: theme.border }]}>
          <Text style={{ color: theme.text }}>Lister les modèles</Text>
        </Pressable>
      </View>
      {status ? <Text style={[s.hint, { color: theme.text }]}>{status}</Text> : null}
    </View>
  );
}
