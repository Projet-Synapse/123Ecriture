import { defaultHighlightStyle, highlightingFor } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { editorHighlightExtensions, editorHighlightStyle } from './codemirrorHighlight';

function classesFor(tags: Parameters<typeof highlightingFor>[1]): string {
  const state = EditorState.create({ extensions: editorHighlightExtensions });
  return highlightingFor(state, tags) ?? '';
}

function rulesFor(classes: string): string {
  const all = editorHighlightStyle.module?.getRules() ?? '';
  return classes
    .split(/\s+/)
    .filter(Boolean)
    .map((cls) => {
      const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = all.match(new RegExp(`\\.${escaped}\\s*\\{[^}]*\\}`));
      return match?.[0] ?? '';
    })
    .join('\n');
}

describe('editorHighlightStyle (titres sans soulignement)', () => {
  it('le spec des titres force text-decoration: none, en gardant le gras', () => {
    const heading = editorHighlightStyle.specs.find((spec) => {
      const tags = Array.isArray(spec.tag) ? spec.tag : [spec.tag];
      return tags.includes(t.heading);
    });
    expect(heading).toBeDefined();
    expect(heading!.textDecoration).toBe('none');
    expect(heading!.fontWeight).toBe('bold');
  });

  it('les liens restent soulignés, le reste du style par défaut est conservé', () => {
    const link = editorHighlightStyle.specs.find((spec) => {
      const tags = Array.isArray(spec.tag) ? spec.tag : [spec.tag];
      return tags.includes(t.link);
    });
    expect(link?.textDecoration).toBe('underline');
    expect(editorHighlightStyle.specs).toHaveLength(defaultHighlightStyle.specs.length);
  });

  it('H1–H6 ne reçoivent aucune règle underline (plus d’union de classes)', () => {
    for (const tag of [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6]) {
      const rules = rulesFor(classesFor([tag]));
      expect(rules).toContain('text-decoration: none');
      expect(rules).toContain('font-weight: bold');
      expect(rules).not.toContain('text-decoration: underline');
    }
  });
});
