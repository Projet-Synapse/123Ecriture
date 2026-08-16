import { useEffect, useMemo, useState } from 'react';
import { Image, Text } from 'react-native';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';

import { createConfiguredMarkdownIt } from '../lib/markdownPlugins';
import type { Theme } from '../theme';
import { AudioEmbed } from './AudioEmbed';

// Rendu Markdown des notes (mode "Aperçu"/"Intermédiaire", voir
// NotesScreen.tsx) — react-native-markdown-display consomme le flux de
// tokens de markdown-it (voir lib/markdownPlugins.ts pour les extensions
// `[[liens]]`/`#tags`/`![[embeds]]`) et fusionne automatiquement les
// `rules` fournies ici avec ses règles par défaut (headers, gras, listes,
// tableaux GFM, images `![alt](url)`...) — pas besoin de les redéclarer.
//
// `ASTNode` (le type officiel de la lib) ne déclare pas `sourceMeta` alors
// que l'implémentation réelle le pose bien (voir tokensToAST.js, lu avant
// d'écrire ceci) — .d.ts en retard sur le code, pas une erreur de notre
// côté. D'où ce petit type élargi plutôt qu'un `any`.
type NodeWithMeta = ASTNode & { sourceMeta?: { target?: string } };

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

// Une pièce jointe individuelle — composant à part pour pouvoir utiliser
// useState/useEffect (une fonction de rendu react-native-markdown-display
// n'est pas elle-même un composant React monté normalement, on ne peut pas
// y appeler des hooks directement).
function EmbedNode({ target, theme }: { target: string; theme: Theme }) {
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Ne réinitialise pas dataUrl/failed en tête d'effet (setState direct,
  // évité par convention dans ce projet) — si `target` change pour la même
  // instance (repositionnement du même embed dans le texte), l'ancien
  // contenu reste affiché jusqu'à ce que le nouveau ait fini de charger ;
  // effet secondaire mineur, sans conséquence.
  useEffect(() => {
    if (!vault) return;
    vault
      .readAttachmentDataUrl(target)
      .then(setDataUrl)
      .catch(() => setFailed(true));
  }, [vault, target]);

  if (failed) {
    return <Text style={{ color: '#dc2626' }}>⚠️ Pièce jointe introuvable : {target}</Text>;
  }
  if (!dataUrl) {
    return <Text style={{ color: theme.textMuted }}>Chargement de {target}…</Text>;
  }

  const ext = extensionOf(target);
  if (IMAGE_EXTENSIONS.has(ext)) {
    return <Image source={{ uri: dataUrl }} style={{ width: '100%', height: 240, resizeMode: 'contain' }} />;
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return <AudioEmbed dataUrl={dataUrl} />;
  }
  return <Text style={{ color: theme.accent }}>📎 {target}</Text>;
}

type Props = {
  content: string;
  theme: Theme;
  onOpenWikilink: (target: string) => void;
  // Mots du dictionnaire personnel connus (voir OccurrencesPanel.tsx) —
  // une {{occurrence}} n'est stylée/cliquable QUE si son mot y figure (voir
  // occurrenceRule dans lib/markdownPlugins.ts), sinon elle reste du texte
  // brut. Optionnel : un appelant qui ne fournit rien n'aura simplement
  // jamais de pastille occurrence.
  knownOccurrenceWords?: Set<string>;
  onOpenOccurrence?: (word: string) => void;
};

export function NoteRenderer({ content, theme, onOpenWikilink, knownOccurrenceWords, onOpenOccurrence }: Props) {
  // Recréé seulement quand le dictionnaire change (pas à chaque frappe) —
  // la configuration (règles enregistrées) ne change sinon jamais après
  // coup.
  const markdownIt = useMemo(
    () => createConfiguredMarkdownIt(knownOccurrenceWords),
    [knownOccurrenceWords],
  );

  const rules: RenderRules = useMemo(
    () => ({
      wikilink: (node) => {
        const target = String((node as NodeWithMeta).sourceMeta?.target ?? node.content);
        return (
          <Text
            key={node.key}
            style={{ color: theme.accent, textDecorationLine: 'underline' }}
            onPress={() => onOpenWikilink(target)}
          >
            {node.content}
          </Text>
        );
      },
      tag: (node) => (
        <Text
          key={node.key}
          style={{
            color: theme.accent,
            backgroundColor: `${theme.accent}22`,
            borderRadius: 4,
            paddingHorizontal: 4,
            overflow: 'hidden',
          }}
        >
          #{node.content}
        </Text>
      ),
      occurrence: (node) => {
        const target = String((node as NodeWithMeta).sourceMeta?.target ?? node.content);
        return (
          <Text
            key={node.key}
            style={{
              color: theme.accent,
              backgroundColor: `${theme.accent}1a`,
              borderRadius: 4,
              paddingHorizontal: 4,
              overflow: 'hidden',
            }}
            onPress={() => onOpenOccurrence?.(target)}
          >
            🔤 {node.content}
          </Text>
        );
      },
      embed: (node) => {
        const target = String((node as NodeWithMeta).sourceMeta?.target ?? node.content);
        return <EmbedNode key={node.key} target={target} theme={theme} />;
      },
    }),
    [theme, onOpenWikilink, onOpenOccurrence],
  );

  return (
    <Markdown markdownit={markdownIt} rules={rules} style={{ body: { color: theme.text } }}>
      {content}
    </Markdown>
  );
}
