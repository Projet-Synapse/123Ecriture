import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Garde-fou de régression (appui long sans effet dans les dossiers,
// Android) : chaque appel récursif de l'arbre reçoit TOUTES les props via
// `childProps`, dont onNodeLongPress. Test de source : le composant RN ne
// se monte pas sous vitest (pas de moteur React Native).
const source = readFileSync(join(__dirname, 'VaultTreeView.tsx'), 'utf8');

describe('VaultTreeView — sous-arbres', () => {
  it('chaque appel récursif transmet childProps', () => {
    const calls = source.match(/<VaultTreeViewImpl[^>]*\/>/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('{...childProps}');
  });

  it('childProps contient le maintien de doigt (menu contextuel)', () => {
    const block = /const childProps[^=]*= \{([\s\S]*?)\};/.exec(source)?.[1] ?? '';
    expect(block).toMatch(/\bonNodeLongPress\b/);
    expect(source).toMatch(/onLongPress=\{onNodeLongPress \? \(\) => onNodeLongPress\(node\) : undefined\}/);
  });
});
