import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  FORMATTING_RULES,
  formatMarkdown,
  normalizeFormattingSettings,
  testCustomRule,
  type CustomFormattingRule,
  type FormattingSettings,
} from '../../lib/editor/formatter';
import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/FormattingSection.tsx — Paramètres → Formatage
//////////////////////////////////////////////////////////////////////////////
//
// Formatage automatique façon Linter d'Obsidian (lib/editor/formatter.ts) :
// règles intégrées activables, règles personnalisées par regex (motif,
// remplacement, drapeaux, activer/désactiver, test sur un exemple),
// déclenchement à l'enregistrement (Ctrl+S, option) et protections
// (frontmatter, code). Le bouton ✨ de la barre d'outils et le menu ⋯
// « Formater le fichier » appliquent ces réglages.
//
// Invariants : les champs regex sont des BROUILLONS locaux, enregistrés à
// la sortie du champ ; une regex invalide est affichée en rouge, jamais
// une exception. Desktop + Android (même composant).
//
// SOMMAIRE :
//   1. CustomRuleEditor — une règle personnalisée
//   2. FormattingSection
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. CustomRuleEditor — une règle personnalisée ////////////////////////

function CustomRuleEditor({
  rule,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  rule: CustomFormattingRule;
  onChange: (rule: CustomFormattingRule) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { theme } = usePreferences();
  const [draft, setDraft] = useState(rule);
  const [synced, setSynced] = useState(rule);
  if (rule !== synced) {
    setSynced(rule);
    setDraft(rule);
  }
  const [sample, setSample] = useState('');
  const commit = () => {
    if (draft.name !== rule.name || draft.pattern !== rule.pattern || draft.replacement !== rule.replacement || draft.flags !== rule.flags) {
      onChange(draft);
    }
  };
  const test = draft.pattern ? testCustomRule(draft, sample) : null;
  const field = (key: 'name' | 'pattern' | 'replacement' | 'flags', placeholder: string, mono = false, width = 180) => (
    <TextInput
      value={draft[key]}
      onChangeText={(text) => setDraft((d) => ({ ...d, [key]: text }))}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder={placeholder}
      placeholderTextColor={theme.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      style={[
        s.input,
        { color: theme.text, borderColor: theme.border, flex: 0, minWidth: width },
        mono && { fontFamily: 'monospace' },
      ]}
    />
  );
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[s.modeButton, { borderColor: theme.border, opacity: disabled ? 0.4 : 1, paddingHorizontal: 10 }]}
    >
      <Text style={{ color: theme.text }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 6, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8 }}>
      <SettingsToggle
        label={draft.name || draft.pattern || 'Nouvelle règle'}
        value={rule.enabled}
        onChange={(enabled) => onChange({ ...draft, enabled })}
        theme={theme}
      />
      <View style={s.row}>
        {field('name', 'Nom (ex. Tirets cadratins)')}
        {field('pattern', 'Motif regex (ex. \\s+--\\s+)', true, 220)}
        {field('replacement', 'Remplacement (ex. \\u00A0— )', true, 180)}
        {field('flags', 'Drapeaux (i m s u)', true, 90)}
      </View>
      {test && !test.ok && <Text style={[s.hint, { color: theme.danger }]}>⚠️ {test.error}</Text>}
      <TextInput
        value={sample}
        onChangeText={setSample}
        placeholder="Tester sur un exemple…"
        placeholderTextColor={theme.textMuted}
        multiline
        style={[s.input, { color: theme.text, borderColor: theme.border, flex: 0, minHeight: 40 }]}
      />
      {test && test.ok && sample !== '' && (
        <Text style={[s.hint, { color: theme.text }]}>
          → {test.output} ({test.count} remplacement{test.count > 1 ? 's' : ''})
        </Text>
      )}
      <View style={s.row}>
        {button('↑', () => onMove(-1), isFirst)}
        {button('↓', () => onMove(1), isLast)}
        {button('✕ Supprimer', onRemove)}
      </View>
    </View>
  );
}

//////// 2. FormattingSection /////////////////////////////////////////////////

const PREVIEW_SAMPLE = '##Titre  \nVraiment ? Oui! "Citation" ...\n\n\n\nFin';

export function FormattingSection() {
  const { preferences, theme, setFormatting } = usePreferences();
  const settings = useMemo(() => normalizeFormattingSettings(preferences.formatting), [preferences.formatting]);
  const save = (next: FormattingSettings) =>
    void setFormatting(next as NonNullable<Preferences['formatting']>);
  const setRule = (id: string, value: boolean) => save({ ...settings, rules: { ...settings.rules, [id]: value } });
  const customs = settings.customRules;
  const setCustoms = (next: CustomFormattingRule[]) => save({ ...settings, customRules: next });
  const preview = formatMarkdown(PREVIEW_SAMPLE, settings);

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>✨ Formatage</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Mise en forme automatique, comme le Linter d’Obsidian : bouton ✨ de la barre d’outils ou menu ⋯ → « Formater le
        fichier ». Annulable avec Ctrl+Z (ou ↶).
      </Text>

      {/* //1. Déclenchement et protections */}
      <SettingsToggle
        label="Formater à l’enregistrement (Ctrl+S)"
        value={settings.formatOnSave}
        onChange={(formatOnSave) => save({ ...settings, formatOnSave })}
        theme={theme}
      />
      <SettingsToggle
        label="Formater aussi le frontmatter (propriétés)"
        value={settings.includeFrontmatter}
        onChange={(includeFrontmatter) => save({ ...settings, includeFrontmatter })}
        theme={theme}
      />
      <SettingsToggle
        label="Formater aussi les blocs de code"
        value={settings.includeCode}
        onChange={(includeCode) => save({ ...settings, includeCode })}
        theme={theme}
      />

      {/* //2. Règles intégrées */}
      <Text style={[s.label, { color: theme.textMuted }]}>Règles</Text>
      {FORMATTING_RULES.map((rule) => (
        <View key={rule.id}>
          <SettingsToggle
            label={rule.label}
            value={settings.rules[rule.id] === true}
            onChange={(value) => setRule(rule.id, value)}
            theme={theme}
          />
          <Text style={[s.hint, { color: theme.textMuted, marginTop: -4 }]}>{rule.hint}</Text>
        </View>
      ))}

      {/* //3. Règles personnalisées */}
      <Text style={[s.label, { color: theme.textMuted }]}>Règles personnalisées (regex)</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Appliquées dans l’ordre, après les règles ci-dessus, à toutes les occurrences. Remplacement : $1, $2… pour les
        groupes ; \n, \t, \u00A0 acceptés.
      </Text>
      {customs.map((rule, index) => (
        <CustomRuleEditor
          key={rule.id}
          rule={rule}
          isFirst={index === 0}
          isLast={index === customs.length - 1}
          onChange={(next) => setCustoms(customs.map((r, i) => (i === index ? next : r)))}
          onRemove={() => setCustoms(customs.filter((_, i) => i !== index))}
          onMove={(delta) => {
            const target = index + delta;
            if (target < 0 || target >= customs.length) return;
            const next = [...customs];
            [next[index], next[target]] = [next[target], next[index]];
            setCustoms(next);
          }}
        />
      ))}
      <View style={s.row}>
        <Pressable
          onPress={() =>
            setCustoms([
              ...customs,
              { id: `regle-${Date.now()}`, name: '', pattern: '', replacement: '', flags: 'g', enabled: true },
            ])
          }
          accessibilityRole="button"
          style={[s.modeButton, { borderColor: theme.border }]}
        >
          <Text style={{ color: theme.text }}>+ Ajouter une règle</Text>
        </Pressable>
      </View>

      {/* //4. Aperçu */}
      <Text style={[s.label, { color: theme.textMuted }]}>Aperçu</Text>
      <Text style={[s.hint, { color: theme.textMuted, fontFamily: 'monospace' }]}>{PREVIEW_SAMPLE}</Text>
      <Text style={[s.hint, { color: theme.text, fontFamily: 'monospace' }]}>{preview.text}</Text>
      {preview.errors.map((e) => (
        <Text key={e.ruleId} style={[s.hint, { color: theme.danger }]}>
          ⚠️ « {e.name} » ignorée : {e.message}
        </Text>
      ))}
    </View>
  );
}
