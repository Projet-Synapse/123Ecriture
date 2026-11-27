import { describe, expect, it } from 'vitest';

import { applyTextCommand, editorCommandScript, parseEditorCommand, toolbarRoute } from './editorCommands';

describe('parseEditorCommand', () => {
  it('accepte les commandes connues (objet ou JSON)', () => {
    expect(parseEditorCommand('{"kind":"format","id":"bold"}')).toEqual({ kind: 'format', id: 'bold' });
    expect(parseEditorCommand({ kind: 'undo' })).toEqual({ kind: 'undo' });
    expect(parseEditorCommand({ kind: 'redo', extra: 1 })).toEqual({ kind: 'redo' });
    expect(parseEditorCommand({ kind: 'insert', text: '![[a.png]]' })).toEqual({ kind: 'insert', text: '![[a.png]]' });
    expect(parseEditorCommand({ kind: 'select', from: 12, to: 18 })).toEqual({ kind: 'select', from: 12, to: 18 });
  });

  it('rejette le reste', () => {
    expect(parseEditorCommand('pas du json')).toBeNull();
    expect(parseEditorCommand({ kind: 'eval', code: 'x' })).toBeNull();
    expect(parseEditorCommand({ kind: 'format' })).toBeNull();
    expect(parseEditorCommand({ kind: 'insert', text: 3 })).toBeNull();
    expect(parseEditorCommand({ kind: 'select', from: '0', to: 1 })).toBeNull();
    expect(parseEditorCommand(null)).toBeNull();
  });
});

describe('editorCommandScript', () => {
  it('transmet une CHAÎNE JSON relue à l’identique par la page', () => {
    const cmd = { kind: 'insert' as const, text: 'a "b" \\ c\n</script>' };
    const script = editorCommandScript(cmd);
    expect(script.startsWith('window.__editorApi && window.__editorApi.runCommand && window.__editorApi.runCommand(')).toBe(true);
    const argument = script.slice(script.lastIndexOf('runCommand(') + 'runCommand('.length, -2);
    expect(parseEditorCommand(JSON.parse(argument) as string)).toEqual(cmd);
  });
});

describe('applyTextCommand', () => {
  it('format : même logique que le desktop (gras, titre)', () => {
    expect(applyTextCommand('un mot ici', { start: 3, end: 6 }, { kind: 'format', id: 'bold' })?.text).toBe('un **mot** ici');
    expect(applyTextCommand('Titre', { start: 0, end: 0 }, { kind: 'format', id: 'h2' })?.text).toBe('## Titre');
  });

  it('insert : remplace la sélection, curseur après le texte', () => {
    expect(applyTextCommand('abcdef', { start: 2, end: 4 }, { kind: 'insert', text: 'XY' })).toEqual({
      text: 'abXYef',
      selection: { start: 4, end: 4 },
    });
  });

  it('rien pour un id inconnu, les boutons spéciaux ou undo/redo', () => {
    expect(applyTextCommand('a', { start: 0, end: 0 }, { kind: 'format', id: 'inconnu' })).toBeNull();
    expect(applyTextCommand('a', { start: 0, end: 0 }, { kind: 'format', id: 'attach' })).toBeNull();
    expect(applyTextCommand('a', { start: 0, end: 0 }, { kind: 'undo' })).toBeNull();
  });

  it('select : ne modifie pas le texte (saut géré par la WebView)', () => {
    expect(applyTextCommand('abcdef', { start: 0, end: 0 }, { kind: 'select', from: 2, to: 4 })).toBeNull();
  });
});

describe('toolbarRoute', () => {
  it('sépare mise en forme et boutons spéciaux', () => {
    expect(toolbarRoute('bold')).toBe('format');
    expect(toolbarRoute('h3')).toBe('format');
    expect(toolbarRoute('undo')).toBe('undo');
    expect(toolbarRoute('attach')).toBe('attach');
    expect(toolbarRoute('template')).toBe('template');
    expect(toolbarRoute('lint')).toBe('lint');
  });
});

