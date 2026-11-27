import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeAiGateway } from '../../lib/ai/aiPolicy';
import { runEllieTurn, type EllieNoteContext } from '../../lib/ai/ellieChat';
import { resolveEllieHttp, type EllieChatMessage } from '../../lib/ai/ellieClient';
import { normalizeAiChat } from '../../lib/ai/ellieSettings';
import {
  ELLIE_CONVERSATIONS_PATH,
  newConversation,
  parseEllieConversations,
  serializeEllieConversations,
  titleFromUserText,
  upsertConversation,
  type EllieConversation,
  type EllieStoredMessage,
} from '../../lib/ai/ellieStore';
import { createRendererEllieVault } from '../../lib/ai/ellieVault';
import { usePreferences } from '../../preferences/PreferencesContext';
import type { Theme } from '../../theme';
import { NoteRenderer } from './NoteRenderer';

// ✒️ 123ECRITURE — components/vault/ElliePanel.tsx — panneau de chat Ellie
//////////////////////////////////////////////////////////////////////////////
//
// Chat avec l'IA locale (Ollama / LM Studio) : historique, rendu markdown
// des réponses, flux, bouton stop, nouvelle conversation, conversations
// enregistrées localement. Lecture seule : « Copier » et « Insérer dans
// la note » exigent un clic. Inerte tant que la passerelle n'est pas
// activée.
//
//////////////////////////////////////////////////////////////////////////////

type Props = {
  theme: Theme;
  currentNote: EllieNoteContext | null;
  onInsertIntoNote?: (text: string) => void;
  onOpenWikilink?: (target: string) => void;
};

function newId(): string {
  return `m_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function toHistory(messages: EllieStoredMessage[]): EllieChatMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}


function EllieBtn({
  label,
  onPress,
  theme,
  accent,
  disabled,
  a11y,
}: {
  label: string;
  onPress: () => void;
  theme: Theme;
  accent?: boolean;
  disabled?: boolean;
  a11y?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      style={[
        styles.btn,
        { borderColor: accent ? theme.accent : theme.border, opacity: disabled ? 0.45 : 1 },
        accent ? { backgroundColor: theme.accent } : null,
      ]}
    >
      <Text style={{ color: accent ? '#fff' : theme.text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function ElliePanel({ theme, currentNote, onInsertIntoNote, onOpenWikilink }: Props) {
  const { preferences } = usePreferences();
  const gateway = useMemo(() => normalizeAiGateway(preferences.aiGateway), [preferences.aiGateway]);
  const chat = useMemo(() => normalizeAiChat(preferences.aiChat), [preferences.aiChat]);
  const locked = preferences.aiLockedPaths ?? [];
  const [conversations, setConversations] = useState<EllieConversation[]>([]);
  const [active, setActive] = useState<EllieConversation>(() => newConversation());
  const [input, setInput] = useState('');
  const [includeNoteOverride, setIncludeNoteOverride] = useState<boolean | null>(null);
  const includeNote = includeNoteOverride ?? chat.includeCurrentNote;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const vault = typeof window !== 'undefined' ? window.vault : undefined;
      if (!vault?.readNote) return;
      try {
        const parsed = parseEllieConversations(await vault.readNote(ELLIE_CONVERSATIONS_PATH));
        if (cancelled) return;
        setConversations(parsed);
        if (parsed[0]) setActive(parsed[0]);
      } catch {
        /* fichier encore absent */
      } finally {
        loadedRef.current = true;
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((list: EllieConversation[]) => {
    setConversations(list);
    const vault = typeof window !== 'undefined' ? window.vault : undefined;
    if (!vault?.writeNote) return;
    void vault.writeNote(ELLIE_CONVERSATIONS_PATH, serializeEllieConversations(list)).catch(() => undefined);
  }, []);

  const saveActive = useCallback(
    (next: EllieConversation) => {
      setActive(next);
      persist(upsertConversation(conversations, next));
    },
    [conversations, persist],
  );

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (!gateway.enabled) {
      setError('L’IA n’est pas activée. Va dans Paramètres → 🤖 IA / Passerelle et coche « Activer la passerelle IA ».');
      return;
    }
    setError(null);
    setInput('');
    const now = new Date().toISOString();
    const userMsg: EllieStoredMessage = { id: newId(), role: 'user', content: trimmed, at: now };
    const started: EllieConversation = {
      ...active,
      title: active.messages.length === 0 ? titleFromUserText(trimmed) : active.title,
      updatedAt: now,
      messages: [...active.messages, userMsg],
    };
    setActive(started);
    setDraft('');
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const vault = createRendererEllieVault(async () => ({ settings: gateway, locked }), chat.name);
      const result = await runEllieTurn({
        settings: chat,
        gateway,
        history: toHistory(started.messages.slice(0, -1)),
        userText: trimmed,
        includeNote,
        note: currentNote,
        http: resolveEllieHttp(),
        vault,
        signal: ctrl.signal,
        onDelta: (full) => {
          setDraft(full);
          requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
        },
      });
      const assistant: EllieStoredMessage = {
        id: newId(),
        role: 'assistant',
        content: result.content || '(réponse vide)',
        at: new Date().toISOString(),
      };
      saveActive({ ...started, updatedAt: assistant.at, messages: [...started.messages, assistant] });
      setDraft('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/interrompue|Aborted/i.test(message)) setError(message);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const copy = async (id: string, text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      setError('Impossible de copier.');
    }
  };

  if (!gateway.enabled) {
    return (
      <View style={[styles.body, { padding: 16, gap: 10 }]}>
        <Text style={[styles.title, { color: theme.text }]}>{chat.name}</Text>
        <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 20 }}>
          Active l’IA dans Paramètres → 🤖 IA / Passerelle (« Activer la passerelle IA ») pour parler avec{' '}
          {chat.name}. Tu pourras alors lui demander d’explorer tes notes, toujours en lecture seule.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {chat.name}
        </Text>
        <View style={styles.headerBtns}>
          <EllieBtn
            theme={theme}
            label="Nouvelle"
            a11y="Nouvelle conversation"
            onPress={() => {
              stop();
              const fresh = newConversation();
              setActive(fresh);
              setError(null);
              setDraft('');
            }}
          />
          <EllieBtn theme={theme} label={listOpen ? 'Fermer' : 'Historique'} onPress={() => setListOpen((v) => !v)} />
        </View>
      </View>

      {listOpen && (
        <ScrollView style={[styles.list, { borderBottomColor: theme.border }]}>
          {conversations.length === 0 && <Text style={{ color: theme.textMuted, padding: 8 }}>Aucune conversation enregistrée.</Text>}
          {conversations.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => {
                setActive(c);
                setListOpen(false);
              }}
              style={[styles.listItem, c.id === active.id && { backgroundColor: `${theme.accent}22` }]}
            >
              <Text style={{ color: theme.text }} numberOfLines={1}>
                {c.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={styles.threadContent} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
        {active.messages.map((msg) => (
          <View
            key={msg.id}
            style={[
              styles.bubble,
              { borderColor: theme.border, backgroundColor: msg.role === 'user' ? `${theme.accent}14` : theme.background },
            ]}
          >
            <Text style={[styles.who, { color: theme.textMuted }]}>{msg.role === 'user' ? 'Toi' : chat.name}</Text>
            {msg.role === 'assistant' ? (
              <NoteRenderer content={msg.content} theme={theme} onOpenWikilink={onOpenWikilink ?? (() => undefined)} />
            ) : (
              <Text style={{ color: theme.text, fontSize: 14, lineHeight: 20 }}>{msg.content}</Text>
            )}
            {msg.role === 'assistant' && (
              <View style={styles.actions}>
                <EllieBtn theme={theme} label={copiedId === msg.id ? 'Copié' : 'Copier'} onPress={() => void copy(msg.id, msg.content)} />
                <EllieBtn
                  theme={theme}
                  label="Insérer dans la note"
                  a11y="Insérer la suggestion dans la note ouverte"
                  disabled={!onInsertIntoNote || !currentNote}
                  onPress={() => onInsertIntoNote?.(msg.content)}
                />
              </View>
            )}
          </View>
        ))}
        {busy && (
          <View style={[styles.bubble, { borderColor: theme.border, backgroundColor: theme.background }]}>
            <View style={styles.whoRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={[styles.who, { color: theme.textMuted }]}>{chat.name} écrit…</Text>
            </View>
            {draft ? <Text style={{ color: theme.text, fontSize: 14, lineHeight: 20 }}>{draft}</Text> : null}
          </View>
        )}
      </ScrollView>

      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}

      <Pressable
        onPress={() => setIncludeNoteOverride(!includeNote)}
        style={styles.include}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: includeNote }}
      >
        <Text style={{ color: includeNote ? theme.accent : theme.textMuted, fontSize: 12 }}>
          {includeNote ? '☑' : '☐'} Inclure la note courante{currentNote ? ` (« ${currentNote.name} »)` : ' (aucune ouverte)'}
        </Text>
      </Pressable>

      <View style={[styles.composer, { borderTopColor: theme.border }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={`Écrire à ${chat.name}…`}
          placeholderTextColor={theme.textMuted}
          multiline
          editable={!busy}
          onSubmitEditing={() => void send(input)}
          blurOnSubmit={Platform.OS === 'web'}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
        />
        {busy ? (
          <EllieBtn theme={theme} label="Stop" a11y="Arrêter la réponse" onPress={stop} />
        ) : (
          <EllieBtn theme={theme} label="Envoyer" accent disabled={!input.trim()} onPress={() => void send(input)} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  header: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, gap: 6 },
  title: { fontSize: 15, fontWeight: '700' },
  headerBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  list: { maxHeight: 160, borderBottomWidth: 1 },
  listItem: { paddingHorizontal: 10, paddingVertical: 8 },
  thread: { flex: 1, minHeight: 0 },
  threadContent: { padding: 10, gap: 8, paddingBottom: 16 },
  bubble: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 6 },
  who: { fontSize: 11, fontWeight: '600' },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  btn: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
  error: { fontSize: 12, paddingHorizontal: 10, paddingVertical: 4 },
  include: { paddingHorizontal: 10, paddingVertical: 6 },
  composer: { borderTopWidth: 1, padding: 8, gap: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44, maxHeight: 120, fontSize: 14 },
});
