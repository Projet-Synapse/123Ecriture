import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { parseFrontmatter } from '../lib/frontmatter';
import type { Theme } from '../theme';

// « Dataview-lite » (v0.4.44, demande : se baser sur Obsidian et ses
// plugins) — une vue TABLE des notes du coffre par propriété frontmatter :
// on choisit une propriété (ex. Statut, Modèle), on filtre par texte, les
// notes correspondantes s'affichent cliquables. Version volontairement
// simple du plugin Dataview : une propriété, un filtre, un tableau.
//
// Lecture : TOUTES les notes .md/.mdx sont lues une fois à l'entrée (en
// parallèle par paquets, comme la vue graphique — 200+ notes ≈ 20 s sur
// SAF Android, instantané sur desktop), puis gardées en mémoire d'écran.

type Row = { relPath: string; name: string; props: Record<string, string> };

type Props = {
  theme: Theme;
  onOpenNote: (relPath: string) => void;
};

const IGNORED_KEYS = new Set<string>();

function valueToString(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
}

export function TablesScreen({ theme, onOpenNote }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [propKey, setPropKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (typeof window === 'undefined' || !window.vault) return;
        const tree = await window.vault.listTree();
        const notes: { relPath: string; name: string }[] = [];
        const walk = (items: typeof tree) => {
          for (const item of items) {
            if (item.type === 'folder') walk(item.children ?? []);
            else if (/\.(md|mdx)$/i.test(item.relPath)) notes.push({ relPath: item.relPath, name: item.name });
          }
        };
        walk(tree);

        const queue = notes.slice();
        const collected: Row[] = [];
        await Promise.all(
          Array.from({ length: Math.min(12, queue.length) }, async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
              try {
                const raw = await window.vault!.readNote(next.relPath);
                const { data } = parseFrontmatter(raw);
                const props: Record<string, string> = {};
                for (const [key, value] of Object.entries(data ?? {})) {
                  if (value === null || value === undefined) continue;
                  props[key] = valueToString(value);
                }
                collected.push({ relPath: next.relPath, name: next.name, props });
              } catch {
                collected.push({ relPath: next.relPath, name: next.name, props: {} });
              }
            }
          }),
        );
        if (!cancelled) setRows(collected);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const propKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row.props)) if (!IGNORED_KEYS.has(key)) keys.add(key);
    return [...keys].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [rows]);

  const activeKey = propKeys.includes(propKey) ? propKey : (propKeys[0] ?? '');
  const needle = filter.trim().toLowerCase();
  const visible = rows
    .filter((row) => {
      if (!needle) return true;
      const value = (activeKey ? (row.props[activeKey] ?? '') : '').toLowerCase();
      return row.name.toLowerCase().includes(needle) || value.includes(needle);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 10 }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>🗂️ Tables du coffre</Text>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
          Version simple du plugin Dataview : choisis une propriété, filtre, ouvre.
        </Text>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filtrer par nom ou par valeur…"
          placeholderTextColor={theme.textMuted}
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
            paddingVertical: 8,
            paddingHorizontal: 10,
            color: theme.text,
          }}
        />

        {loading ? (
          <Text style={{ color: theme.textMuted }}>Lecture du coffre…</Text>
        ) : (
          <>
            {propKeys.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {propKeys.map((key) => (
                  <Pressable
                    key={key}
                    onPress={() => setPropKey(key)}
                    style={{
                      borderWidth: 1,
                      borderColor: key === activeKey ? theme.accent : theme.border,
                      backgroundColor: key === activeKey ? `${theme.accent}22` : 'transparent',
                      borderRadius: 6,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                    }}
                  >
                    <Text style={{ color: theme.text, fontSize: 12 }}>{key}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {visible.map((row) => (
              <Pressable
                key={row.relPath}
                onPress={() => onOpenNote(row.relPath)}
                style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, gap: 4 }}
              >
                <Text style={{ color: theme.text, fontWeight: '600' }}>{row.name}</Text>
                {activeKey && row.props[activeKey] !== undefined && (
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    {activeKey} : {row.props[activeKey]}
                  </Text>
                )}
              </Pressable>
            ))}
            {visible.length === 0 && <Text style={{ color: theme.textMuted }}>Aucune note ne correspond.</Text>}
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>
              {rows.length} notes lues · {visible.length} affichées
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

