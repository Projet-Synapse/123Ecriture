// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { enableOsEmojiInsertion } from './osEmojiInsertion';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(extensions = [enableOsEmojiInsertion]) {
  view = new EditorView({ state: EditorState.create({ doc: 'Bonjour ', extensions }), parent: document.body });
  return view;
}

describe('enableOsEmojiInsertion — panneau emoji Windows (Win+.)', () => {
  it('sans l’extension, CodeMirror pose autocorrect="off" (la cause)', () => {
    expect(mount([]).contentDOM.getAttribute('autocorrect')).toBe('off');
  });

  it('autocorrect="on" dès la création', () => {
    expect(mount().contentDOM.getAttribute('autocorrect')).toBe('on');
  });

  it('autocorrect="on" après une transaction (insertion d’emoji, y compris composé)', () => {
    const v = mount();
    v.dispatch({ changes: { from: v.state.doc.length, insert: '😀👩‍💻' } });
    expect(v.state.doc.toString()).toBe('Bonjour 😀👩‍💻');
    expect(v.contentDOM.getAttribute('autocorrect')).toBe('on');
  });

  it('option prudente : autocapitalize et writingsuggestions inchangés', () => {
    const v = mount();
    expect(v.contentDOM.getAttribute('autocapitalize')).toBe('off');
    expect(v.contentDOM.getAttribute('writingsuggestions')).toBe('false');
  });
});
