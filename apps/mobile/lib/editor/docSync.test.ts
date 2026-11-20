import { describe, expect, it } from 'vitest';

import { applyDocChange, DocSync, mapPosition, minimalChange, type DocChange } from './docSync';

// Éditeur simulé : un doc + un curseur, et la stratégie de synchro du `value`
// renvoyé par le parent (React / pont WebView).
type Strategy = 'naive' | 'docSync';
class FakeEditor {
  doc: string;
  cursor: number;
  private sync = new DocSync();
  constructor(
    initial: string,
    private readonly strategy: Strategy,
    private readonly emit: (text: string) => void,
  ) {
    this.doc = initial;
    this.cursor = initial.length;
    this.sync.incoming(initial, initial);
  }
  type(chars: string): void {
    for (const ch of chars) {
      this.doc = this.doc.slice(0, this.cursor) + ch + this.doc.slice(this.cursor);
      this.cursor += ch.length;
      this.sync.noteEmitted(this.doc);
      this.emit(this.doc);
    }
  }
  receive(value: string): void {
    if (this.strategy === 'naive') {
      // Ancien comportement (@uiw/react-codemirror `value` contrôlé et
      // applyDoc de la WebView) : tout le doc est remplacé.
      if (value !== this.doc) {
        this.doc = value;
        this.cursor = Math.min(this.cursor, value.length);
      }
      return;
    }
    const change = this.sync.incoming(value, this.doc);
    if (!change) return;
    this.doc = applyDocChange(this.doc, change);
    this.cursor = mapPosition(this.cursor, change);
  }
}

// Parent lent : chaque texte émis ne revient à l'éditeur qu'après `lag`
// frappes (rendu différé, pont throttlé, sauvegarde lente en cours), et la
// fin de la sauvegarde renvoie le contenu connu du parent à ce moment-là.
function typeDuringSlowSave(strategy: Strategy): FakeEditor {
  const pending: string[] = [];
  let parentValue = 'Bonjour';
  const editor = new FakeEditor('Bonjour', strategy, (text) => pending.push(text));
  const lag = 2;
  const deliver = () => {
    while (pending.length > lag) {
      parentValue = pending.shift() as string;
      editor.receive(parentValue);
    }
  };
  for (const ch of ' tout le monde') {
    editor.type(ch);
    deliver();
  }
  // La sauvegarde (600 ms + écriture lente) se termine : le parent repousse
  // la valeur qu'il connaît, encore en retard sur la frappe.
  editor.receive(parentValue);
  editor.type('!');
  while (pending.length) editor.receive(pending.shift() as string);
  return editor;
}

describe('saisie pendant une sauvegarde lente', () => {
  it("l'ancienne synchro (remplacement complet) perd des frappes", () => {
    const editor = typeDuringSlowSave('naive');
    expect(editor.doc).not.toBe('Bonjour tout le monde!');
  });

  it('DocSync ne revient jamais en arrière', () => {
    const editor = typeDuringSlowSave('docSync');
    expect(editor.doc).toBe('Bonjour tout le monde!');
    expect(editor.cursor).toBe(editor.doc.length);
  });
});

describe('DocSync', () => {
  it('ignore les échos de ses propres émissions, même anciens', () => {
    const sync = new DocSync();
    sync.incoming('a', 'a');
    sync.noteEmitted('ab');
    sync.noteEmitted('abc');
    expect(sync.incoming('ab', 'abc')).toBeNull();
    expect(sync.incoming('a', 'abc')).toBeNull();
    expect(sync.incoming('abc', 'abc')).toBeNull();
  });

  it('ignore le corps normalisé déjà connu (ligne vide en tête du corps)', () => {
    const sync = new DocSync();
    sync.incoming('Texte', 'Texte');
    sync.noteEmitted('\nTexte');
    expect(sync.incoming('Texte', '\nTexte')).toBeNull();
  });

  it('applique un vrai changement externe en diff, curseur préservé', () => {
    const sync = new DocSync();
    const doc = 'Voir [[Ancien]] puis la suite';
    sync.incoming(doc, doc);
    const next = 'Voir [[Nouveau]] puis la suite';
    const change = sync.incoming(next, doc) as DocChange;
    expect(change).toEqual({ from: 7, to: 13, insert: 'Nouveau' });
    expect(applyDocChange(doc, change)).toBe(next);
    const cursor = doc.indexOf('suite');
    expect(mapPosition(cursor, change)).toBe(next.indexOf('suite'));
    expect(mapPosition(2, change)).toBe(2);
  });

  it('un retour au contenu précédent après un changement de note est appliqué', () => {
    const sync = new DocSync();
    sync.incoming('A', 'A');
    sync.noteEmitted('AB');
    expect(sync.incoming('Note B', 'AB')).not.toBeNull();
    expect(sync.incoming('AB', 'Note B')).not.toBeNull();
  });

  it('borne la mémoire des versions', () => {
    const sync = new DocSync(3);
    for (const t of ['1', '2', '3', '4', '5']) sync.noteEmitted(t);
    expect(sync.incoming('1', '5')).not.toBeNull();
  });
});

describe('minimalChange', () => {
  it('null si identique', () => {
    expect(minimalChange('abc', 'abc')).toBeNull();
  });

  it('insertion, suppression, remplacement', () => {
    expect(minimalChange('abc', 'abXc')).toEqual({ from: 2, to: 2, insert: 'X' });
    expect(minimalChange('abXc', 'abc')).toEqual({ from: 2, to: 3, insert: '' });
    expect(minimalChange('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' });
    expect(minimalChange('', 'tout')).toEqual({ from: 0, to: 0, insert: 'tout' });
  });

  it('ne coupe pas un emoji (paire de substitution)', () => {
    const a = 'x😀y';
    const b = 'x😃y';
    const change = minimalChange(a, b) as DocChange;
    expect(change).toEqual({ from: 1, to: 3, insert: '😃' });
    expect(applyDocChange(a, change)).toBe(b);
  });
});
