import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';

import { createConfiguredMarkdownIt } from '../../lib/editor/markdownPlugins';
import { imageSupport, isImageFile, svgTextFromDataUrl, unsupportedImageMessage, type ImageEngine } from '../../lib/files/imageFormats';
import { hexToRgba } from '../../lib/theme/appearance';
import type { Theme } from '../../theme';
import { AudioEmbed } from './AudioEmbed';

// ✒️ 123ECRITURE — components/vault/NoteRenderer.tsx — le rendu Markdown des notes
//////////////////////////////////////////////////////////////////////////////
//
// Rendu Markdown des notes (mode "Aperçu"/"Intermédiaire", voir
// NotesScreen.tsx) : react-native-markdown-display consomme le flux de
// tokens de markdown-it (voir lib/markdownPlugins.ts pour les extensions
// `[[liens]]`/`#tags`/`![[embeds]]`).
//
// Invariants du fichier :
//   • La lib fusionne automatiquement les `rules` fournies ici avec ses
//     règles par défaut (headers, gras, listes, tableaux GFM, images
//     `![alt](url)`...) — jamais de redéclaration de ce qu'elle couvre.
//   • `ASTNode` (type officiel de la lib) ne déclare pas `sourceMeta` alors
//     que l'implémentation réelle le pose (tokensToAST.js) : le type local
//     élargi NodeWithMeta remplace un `any`.
//   • Une {{occurrence}} n'est stylée/cliquable QUE si son mot figure dans
//     knownOccurrenceWords (voir occurrenceRule dans lib/markdownPlugins.ts).
//   • Les tailles de titres sont PAR NIVEAU et explicites : chaque niveau
//     reste au-dessus du corps de texte, gras, avec une respiration
//     verticale (les défauts de la lib mettaient h5 sous la taille du
//     corps).
//   • Les pièces jointes passent par le composant EmbedNode : c'est le seul
//     moyen d'y appeler des hooks (une rule de rendu n'est pas un composant
//     React monté normalement).
//
// SOMMAIRE :
//   1. Les helpers (style de titre, extensions, EmbedNode)
//   2. NoteRenderer — la config markdown-it et les rules de rendu
//
//////////////////////////////////////////////////////////////////////////////

// `ASTNode` (le type officiel de la lib) ne déclare pas `sourceMeta` alors
// que l'implémentation réelle le pose bien (voir tokensToAST.js) — .d.ts en
// retard sur le code, pas une erreur de notre côté. D'où ce petit type
// élargi plutôt qu'un `any`.
type NodeWithMeta = ASTNode & { sourceMeta?: { target?: string } };

//////// 1. Les helpers (style de titre, extensions, EmbedNode) ///////////////////////////

// Style d'un titre d'aperçu — taille par niveau (voir les rules) + mise en
// forme commune. `node.children` est l'arbre déjà rendu par la lib (gras,
// liens… imbriqués conservés).
function headingStyle(theme: Theme, fontSize: number): { fontSize: number; fontWeight: '700'; color: string; marginTop: number; marginBottom: number } {
  return {
    fontSize,
    fontWeight: '700',
    color: theme.text,
    marginTop: fontSize >= 24 ? 14 : 8,
    marginBottom: 4,
  };
}

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
    return <Text style={{ color: theme.danger }}>⚠️ Pièce jointe introuvable : {target}</Text>;
  }
  if (!dataUrl) {
    return <Text style={{ color: theme.textMuted }}>Chargement de {target}…</Text>;
  }

  const ext = extensionOf(target);
  if (isImageFile(target)) {
    return <ImageEmbed target={target} dataUrl={dataUrl} theme={theme} />;
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return <AudioEmbed dataUrl={dataUrl} />;
  }
  return <Text style={{ color: theme.accent }}>📎 {target}</Text>;
}

// Image d'un embed — tous les formats de lib/files/imageFormats.ts. Le
// navigateur (web/desktop) ou le décodeur Android ESSAIENT d'afficher ; un
// format refusé (TIFF/HEIC dans Chromium, AVIF sur un vieil Android…)
// donne la carte de repli plutôt qu'un cadre vide. SVG en natif : <Image>
// ne sait pas, react-native-svg s'en charge.
const IMAGE_ENGINE: ImageEngine = Platform.OS === 'web' ? 'browser' : 'native';

function ImageEmbed({ target, dataUrl, theme }: { target: string; dataUrl: string; theme: Theme }) {
  const [failed, setFailed] = useState(false);
  const support = imageSupport(target, IMAGE_ENGINE);
  if (failed || support === 'no') return <ImageFallback target={target} theme={theme} />;
  if (IMAGE_ENGINE === 'native' && extensionOf(target) === '.svg') {
    const xml = svgTextFromDataUrl(dataUrl);
    if (!xml) return <ImageFallback target={target} theme={theme} />;
    return <SvgXml xml={xml} width="100%" height={240} onError={() => setFailed(true)} />;
  }
  return (
    <Image
      source={{ uri: dataUrl }}
      accessibilityLabel={target}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: 240, resizeMode: 'contain' }}
    />
  );
}

// Carte de repli lisible : nom du fichier, raison, bouton « Ouvrir » quand
// la plateforme sait ouvrir le fichier ailleurs (desktop : application par
// défaut ; web : téléchargement).
function ImageFallback({ target, theme }: { target: string; theme: Theme }) {
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const open = vault?.openAttachment;
  const [openError, setOpenError] = useState<string | null>(null);
  return (
    <View style={[fallbackStyles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={{ fontSize: 22 }}>🖼️</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '600' }}>
          {target.slice(target.lastIndexOf('/') + 1)}
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{openError ?? unsupportedImageMessage(target, IMAGE_ENGINE)}</Text>
      </View>
      {open && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            open(target).catch((err: unknown) => setOpenError(err instanceof Error ? err.message : String(err)));
          }}
          style={[fallbackStyles.button, { borderColor: theme.accent }]}
        >
          <Text style={{ color: theme.accent, fontSize: 12 }}>Ouvrir</Text>
        </Pressable>
      )}
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginVertical: 4,
  },
  button: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});

type Props = {
  content: string;
  theme: Theme;
  onOpenWikilink: (target: string) => void;
  // Mots du dictionnaire personnel connus (voir OccurrencesPanel.tsx) —
  // une {{occurrence}} n'est stylée/cliquable QUE si son mot y figure (voir
  // occurrenceRule dans lib/markdownPlugins.ts), sinon elle reste du texte
  // brut. Optionnel : un appelant qui ne fournit rien n'a simplement
  // jamais de pastille occurrence.
  knownOccurrenceWords?: Set<string>;
  onOpenOccurrence?: (word: string) => void;
  // Cible existante ? false = lien ATTÉNUÉ (fiche pas encore créée, façon
  // Obsidian) — même résolveur que le clic (lib/notes/wikilinkResolution.ts).
  isWikilinkResolved?: (target: string) => boolean;
};

// Opacité de la couleur d'un lien non résolu (même valeur que l'aperçu
// vivant, voir UNRESOLVED_LINK_OPACITY dans lib/editor/mdxLivePreview.ts).
const UNRESOLVED_LINK_ALPHA = 0.5;

// Couleur d'un lien non résolu : l'accent du thème, translucide. Un accent
// non hexadécimal (#rrggbb) ne se prête pas à hexToRgba : repli sur le
// texte secondaire du thème, plutôt qu'un lien identique aux autres.
function unresolvedLinkColor(theme: Theme): string {
  const translucent = hexToRgba(theme.accent, UNRESOLVED_LINK_ALPHA);
  return translucent === theme.accent ? theme.textMuted : translucent;
}

//////// 2. NoteRenderer — la config markdown-it et les rules de rendu ////////////////////

export function NoteRenderer({
  content,
  theme,
  onOpenWikilink,
  knownOccurrenceWords,
  onOpenOccurrence,
  isWikilinkResolved,
}: Props) {
  // Recréé seulement quand le dictionnaire change (pas à chaque frappe) —
  // la configuration (règles enregistrées) ne change sinon jamais après
  // coup.
  const markdownIt = useMemo(
    () => createConfiguredMarkdownIt(knownOccurrenceWords),
    [knownOccurrenceWords],
  );

  const rules: RenderRules = useMemo(
    () => ({
      // Taille PAR NIVEAU, explicite : les défauts de la lib mettaient h5
      // à 13px — SOUS la taille du corps, ce qui aplatissait les notes
      // structurées en #####. Échelle alignée sur le mode Intermédiaire
      // (base ~16px) : chaque niveau reste au-dessus du corps, gras, avec
      // une respiration verticale.
      heading1: (node, children) => (
        <Text key={node.key} style={headingStyle(theme, 32)}>{children}</Text>
      ),
      heading2: (node, children) => (
        <Text key={node.key} style={headingStyle(theme, 27)}>{children}</Text>
      ),
      heading3: (node, children) => (
        <Text key={node.key} style={headingStyle(theme, 24)}>{children}</Text>
      ),
      heading4: (node, children) => (
        <Text key={node.key} style={headingStyle(theme, 20)}>{children}</Text>
      ),
      heading5: (node, children) => (
        <Text key={node.key} style={headingStyle(theme, 18)}>{children}</Text>
      ),
      heading6: (node, children) => (
        <Text key={node.key} style={headingStyle(theme, 16)}>{children}</Text>
      ),
      wikilink: (node) => {
        const target = String((node as NodeWithMeta).sourceMeta?.target ?? node.content);
        const unresolved = isWikilinkResolved ? !isWikilinkResolved(target) : false;
        return (
          <Text
            key={node.key}
            style={{
              color: unresolved ? unresolvedLinkColor(theme) : theme.accent,
              textDecorationLine: 'underline',
              textDecorationStyle: unresolved ? 'dashed' : 'solid',
            }}
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
    [theme, onOpenWikilink, onOpenOccurrence, isWikilinkResolved],
  );

  return (
    <Markdown markdownit={markdownIt} rules={rules} style={{ body: { color: theme.text } }}>
      {content}
    </Markdown>
  );
}
