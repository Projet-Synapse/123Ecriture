// ✒️ 123ECRITURE — lib/search/queryParser.ts — syntaxe de recherche façon Obsidian
//////////////////////////////////////////////////////////////////////////////
//
// Parseur PUR (voir queryParser.test.ts) d'une requête de recherche :
// termes, "phrase exacte", -exclusion, OR, parenthèses, et opérateurs
// path: / file: / tag: / line: / section: / [propriété]. La comparaison
// (casse, accents) est faite plus tard par le moteur (queryMatch.ts,
// vaultSearch.ts) — ici on ne fait que structurer la requête.
//
// Précédence : ET implicite (juxtaposition) plus fort que OR.
// « dragon OR elfe guerre » = dragon OU (elfe ET guerre).
//
//////////////////////////////////////////////////////////////////////////////

export type QueryField = 'path' | 'file' | 'tag' | 'line' | 'section' | 'content';

export type QueryNode =
  | { type: 'and'; children: QueryNode[] }
  | { type: 'or'; children: QueryNode[] }
  | { type: 'not'; child: QueryNode }
  | { type: 'term'; value: string; phrase: boolean; field: QueryField }
  | { type: 'group'; field: 'line' | 'section'; child: QueryNode }
  | { type: 'property'; name: string; value: string | null };

export type ParsedQuery = {
  ast: QueryNode | null;
};

export const SEARCH_OPERATOR_HINTS: { token: string; insert: string; hint: string }[] = [
  { token: 'path:', insert: 'path:', hint: 'correspondance avec le chemin du fichier' },
  { token: 'file:', insert: 'file:', hint: 'nom du fichier' },
  { token: 'tag:', insert: 'tag:', hint: 'recherche par mots-clés' },
  { token: 'line:', insert: 'line:', hint: 'mots-clés dans la même ligne' },
  { token: 'section:', insert: 'section:', hint: 'mots-clés sous le même titre' },
  {
    token: '[property]',
    insert: '[',
    hint: 'propriété correspondante (ex. [statut:brouillon], [statut] = a la propriété)',
  },
];

const FIELD_NAMES: Record<string, QueryField> = {
  path: 'path',
  file: 'file',
  tag: 'tag',
  line: 'line',
  section: 'section',
};

function flattenSame(type: 'and' | 'or', nodes: QueryNode[]): QueryNode {
  const children: QueryNode[] = [];
  for (const node of nodes) {
    if (node.type === type) children.push(...node.children);
    else children.push(node);
  }
  if (children.length === 1) return children[0];
  return { type, children };
}

type Token =
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'or' }
  | { kind: 'not' }
  | { kind: 'term'; value: string; phrase: boolean; field: QueryField }
  | { kind: 'groupField'; field: 'line' | 'section' }
  | { kind: 'property'; name: string; value: string | null };

function isIdentChar(ch: string): boolean {
  return /[^\s()[\]:]/.test(ch);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const peek = () => input[i] ?? '';
  const startsWith = (s: string) => input.startsWith(s, i);

  const readQuoted = (): string => {
    // `i` est sur le guillemet ouvrant.
    i += 1;
    let out = '';
    while (i < input.length) {
      const ch = input[i];
      if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        break;
      }
      out += ch;
      i += 1;
    }
    return out;
  };

  const readUnquotedValue = (): string => {
    let out = '';
    while (i < input.length && !/\s/.test(peek()) && peek() !== ')' && peek() !== '(' && peek() !== '[') {
      out += peek();
      i += 1;
    }
    return out;
  };

  while (i < input.length) {
    if (/\s/.test(peek())) {
      i += 1;
      continue;
    }
    if (peek() === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (peek() === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }
    if (peek() === '[') {
      const end = input.indexOf(']', i + 1);
      const raw = end === -1 ? input.slice(i + 1) : input.slice(i + 1, end);
      i = end === -1 ? input.length : end + 1;
      const colon = raw.indexOf(':');
      const name = (colon === -1 ? raw : raw.slice(0, colon)).trim();
      const value = colon === -1 ? null : raw.slice(colon + 1).trim();
      if (name) tokens.push({ kind: 'property', name, value: value === '' ? null : value });
      continue;
    }
    if (peek() === '-') {
      const next = input[i + 1] ?? '';
      if (next && !/\s/.test(next)) {
        tokens.push({ kind: 'not' });
        i += 1;
        continue;
      }
    }
    if (startsWith('OR') && (i + 2 === input.length || /\s|\(|\)/.test(input[i + 2] ?? ''))) {
      const before = i === 0 || /\s|\(/.test(input[i - 1] ?? '');
      if (before) {
        tokens.push({ kind: 'or' });
        i += 2;
        continue;
      }
    }
    if (peek() === '"') {
      tokens.push({ kind: 'term', value: readQuoted(), phrase: true, field: 'content' });
      continue;
    }
    // Opérateur field: …
    let j = i;
    while (j < input.length && isIdentChar(input[j] ?? '')) j += 1;
    if (input[j] === ':' && j > i) {
      const name = input.slice(i, j).toLowerCase();
      const field = FIELD_NAMES[name];
      if (field) {
        i = j + 1;
        if (peek() === '(' && (field === 'line' || field === 'section' || field === 'path' || field === 'file' || field === 'tag')) {
          if (field === 'line' || field === 'section') {
            tokens.push({ kind: 'groupField', field });
            // Le `(` est consommé ensuite comme lparen.
            continue;
          }
        }
        if (peek() === '"') {
          tokens.push({ kind: 'term', value: readQuoted(), phrase: true, field });
        } else {
          const value = readUnquotedValue();
          tokens.push({ kind: 'term', value, phrase: false, field });
        }
        continue;
      }
    }
    const value = readUnquotedValue();
    if (!value) {
      i += 1;
      continue;
    }
    // `#mot` = recherche par mot-clé.
    if (value.startsWith('#') && value.length > 1) {
      tokens.push({ kind: 'term', value: value.slice(1), phrase: false, field: 'tag' });
    } else {
      tokens.push({ kind: 'term', value, phrase: false, field: 'content' });
    }
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private take(): Token | undefined {
    const t = this.tokens[this.index];
    this.index += 1;
    return t;
  }

  parse(): QueryNode | null {
    const node = this.parseOr();
    return node;
  }

  private parseOr(): QueryNode | null {
    const parts: QueryNode[] = [];
    let first = this.parseAnd();
    if (!first) return null;
    parts.push(first);
    while (this.peek()?.kind === 'or') {
      this.take();
      const next = this.parseAnd();
      if (next) parts.push(next);
    }
    return flattenSame('or', parts);
  }

  private parseAnd(): QueryNode | null {
    const parts: QueryNode[] = [];
    for (;;) {
      const tok = this.peek();
      if (!tok || tok.kind === 'or' || tok.kind === 'rparen') break;
      const next = this.parseUnary();
      if (!next) break;
      parts.push(next);
    }
    if (parts.length === 0) return null;
    return flattenSame('and', parts);
  }

  private parseUnary(): QueryNode | null {
    if (this.peek()?.kind === 'not') {
      this.take();
      const child = this.parseUnary();
      if (!child) return null;
      return { type: 'not', child };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode | null {
    const tok = this.peek();
    if (!tok) return null;
    if (tok.kind === 'groupField') {
      this.take();
      if (this.peek()?.kind === 'lparen') {
        this.take();
        const child = this.parseOr();
        if (this.peek()?.kind === 'rparen') this.take();
        if (!child) return null;
        return { type: 'group', field: tok.field, child };
      }
      const inner = this.parseUnary();
      if (!inner) return null;
      return { type: 'group', field: tok.field, child: inner };
    }
    if (tok.kind === 'lparen') {
      this.take();
      const child = this.parseOr();
      if (this.peek()?.kind === 'rparen') this.take();
      return child;
    }
    if (tok.kind === 'term') {
      this.take();
      if (!tok.value) return null;
      return { type: 'term', value: tok.value, phrase: tok.phrase, field: tok.field };
    }
    if (tok.kind === 'property') {
      this.take();
      return { type: 'property', name: tok.name, value: tok.value };
    }
    return null;
  }
}

export function parseSearchQuery(input: string): ParsedQuery {
  const tokens = tokenize(input ?? '');
  if (tokens.length === 0) return { ast: null };
  const ast = new Parser(tokens).parse();
  return { ast };
}

export function queryNeedsContent(ast: QueryNode | null): boolean {
  if (!ast) return false;
  switch (ast.type) {
    case 'and':
    case 'or':
      return ast.children.some(queryNeedsContent);
    case 'not':
      return queryNeedsContent(ast.child);
    case 'group':
      return true;
    case 'property':
      return true;
    case 'term':
      return ast.field === 'content' || ast.field === 'tag' || ast.field === 'line' || ast.field === 'section';
  }
}

export function queryNeedles(ast: QueryNode | null): string[] {
  if (!ast) return [];
  const out: string[] = [];
  const walk = (node: QueryNode) => {
    switch (node.type) {
      case 'and':
      case 'or':
        node.children.forEach(walk);
        return;
      case 'not':
        return;
      case 'group':
        walk(node.child);
        return;
      case 'property':
        if (node.value) out.push(node.value);
        return;
      case 'term':
        if (node.value) out.push(node.value);
    }
  };
  walk(ast);
  return out;
}

// Insère un opérateur dans la requête, avec un espace si besoin.
export function insertSearchOperator(query: string, insert: string): string {
  const trimmedEnd = query.replace(/\s+$/, '');
  if (!trimmedEnd) return insert;
  if (trimmedEnd.endsWith(':') || trimmedEnd.endsWith('[')) return `${trimmedEnd}${insert}`;
  return `${trimmedEnd} ${insert}`;
}
