/**
 * Pratyaya core: everything about the `($)` concept tree that does not need the
 * VS Code API. Kept dependency-free so it can be unit tested with `node --test`.
 */

/** The sigil that opens a concept expression in the document. */
export const MARKER = '$';

/**
 * The key every node carries, holding its own name. Deliberately not the same as
 * `MARKER`: the document sigil is kept short to type, while the object keeps the
 * original `($)` marker so a dumped tree stays recognisable.
 */
export const MARKER_KEY = '($)';

/**
 * The accessor that reaches the scope's functions: `$->dump`.
 *
 * The marker opens a scope holding two things side by side: `root`, the concept
 * tree, reached with `.`; and the functions below, reached with `->`. A function
 * is never a member of `root` - it cannot be written into the tree, it never
 * appears in a dump, and it never shows up as a concept.
 */
export const FUNCTION_ACCESSOR = '->';

export interface ConceptNode {
  [key: string]: ConceptNode | string;
}

/** How a scope function renders its replacement text. */
export interface RenderOptions {
  asCodeBlock: boolean;
}

/** One of the functions sitting beside `root` in the scope. */
export interface ScopeFunction {
  /** Name as typed after the accessor. */
  name: string;
  /** One line describing it, shown beside the suggestion. */
  summary: string;
  /** The text that replaces the expression when the suggestion is accepted. */
  render(root: ConceptNode, options: RenderOptions): string;
}

/**
 * The scope's functions. `root` is not in here and these are not in `root`: the
 * two live beside each other, which is what keeps the tree pure data.
 */
export const SCOPE_FUNCTIONS: readonly ScopeFunction[] = [
  {
    name: 'dump',
    summary: 'insert the whole concept tree as formatted JSON',
    render: (root, options) => dumpText(root, options.asCodeBlock),
  },
];

/** Scope functions whose name starts with what has been typed so far. */
export function scopeFunctionsMatching(partial: string): ScopeFunction[] {
  const prefix = partial.toLowerCase();
  return SCOPE_FUNCTIONS.filter((fn) => fn.name.toLowerCase().startsWith(prefix));
}

/** Looks a scope function up by name. */
export function scopeFunction(name: string): ScopeFunction | undefined {
  return SCOPE_FUNCTIONS.find((fn) => fn.name === name);
}

/** Characters allowed inside a single path segment. */
const SEGMENT_RE = /^[A-Za-z0-9_-]*$/;

/** Every complete `$.a.b.c` occurrence in a document. */
const PATH_SCAN_RE = /\$((?:\.[A-Za-z0-9_-]+)+)/g;

/** Every concept expression in a document, for highlighting. */
const CONCEPT_SCAN_RE = /\$(?:->[A-Za-z0-9_]*|(?:\.[A-Za-z0-9_-]+)+)/g;

/** Punctuation that ends prose rather than continuing an expression. */
const TRAILING_PROSE_RE = /[,;:!?)\]}"'`*]+$/;

/**
 * Builds the `root` object from the document text. The tree is always derived
 * from what is actually written, so it stays in sync with edits in both
 * directions - typing a new path grows it, deleting one shrinks it.
 */
export function buildTree(text: string): ConceptNode {
  const root: ConceptNode = {};

  for (const match of text.matchAll(PATH_SCAN_RE)) {
    const path = match[1];
    let node = root;
    for (const segment of path.slice(1).split('.')) {
      const existing = node[segment];
      if (existing && typeof existing === 'object') {
        node = existing;
      } else {
        const child: ConceptNode = { [MARKER_KEY]: segment };
        node[segment] = child;
        node = child;
      }
    }
  }

  return root;
}

/** Walks `segments` from `root`, or returns undefined if the path is unknown. */
export function resolveNode(root: ConceptNode, segments: string[]): ConceptNode | undefined {
  let node: ConceptNode = root;
  for (const segment of segments) {
    const next = node[segment];
    if (!next || typeof next === 'string') {
      return undefined;
    }
    node = next;
  }
  return node;
}

/** Child concept names of a node, in the order they appear in the document. */
export function childKeys(node: ConceptNode): string[] {
  return Object.keys(node).filter((key) => key !== MARKER_KEY && typeof node[key] === 'object');
}

/** Number of concepts below a node, recursively. */
export function countDescendants(node: ConceptNode): number {
  return childKeys(node).reduce(
    (total, key) => total + 1 + countDescendants(node[key] as ConceptNode),
    0
  );
}

/** Half-open offset range of one concept expression. */
export interface ConceptSpan {
  start: number;
  end: number;
}

/**
 * Locates the concept expressions in a document: a `$` with its dotted path, or
 * with the `->` function accessor. A span stops where the expression stops, so prose
 * or punctuation written straight after it is left uncoloured, and a lone `$` -
 * a price, a shell prompt, some maths - is not a concept at all.
 */
export function conceptSpans(text: string): ConceptSpan[] {
  return [...text.matchAll(CONCEPT_SCAN_RE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export type Context =
  /** Cursor is not inside a concept expression. */
  | { kind: 'none' }
  /** Cursor is inside an expression that can never be completed. */
  | { kind: 'invalid'; exprStart: number; tail: string }
  /**
   * Cursor is inside a path. `segments` are the resolved parents; `partial` is
   * the segment being typed, empty right after a `.`.
   */
  | { kind: 'path'; exprStart: number; segments: string[]; partial: string }
  /** Cursor is inside `$->…`; `partial` is the function name being typed. */
  | { kind: 'function'; exprStart: number; partial: string };

/**
 * Classifies the text immediately before `offset`.
 *
 * An expression runs from the first `$` of the current whitespace-delimited run
 * up to the cursor, and only counts once an accessor follows it: `$.` for a path
 * or `$->` for a scope function. That keeps every other `$` in a spec - prices,
 * shell snippets, maths - out of the way. Once an accessor has been opened,
 * anything that is not a well formed path puts the expression into the invalid
 * state, from which nothing can be applied.
 */
export function parseContextAt(text: string, offset: number): Context {
  let runStart = offset;
  while (runStart > 0 && !/\s/.test(text[runStart - 1])) {
    runStart--;
  }

  const run = text.slice(runStart, offset);
  const markerIndex = run.indexOf(MARKER);
  if (markerIndex === -1) {
    return { kind: 'none' };
  }

  const exprStart = runStart + markerIndex;
  const tail = text.slice(exprStart + MARKER.length, offset);

  // A bare `$`, or a `$` followed by anything other than an accessor, is prose.
  if (tail === '' || !(tail.startsWith('.') || tail.startsWith('-'))) {
    return { kind: 'none' };
  }

  // `$.a.b,` - the expression closed and prose carried on.
  const trimmed = tail.replace(TRAILING_PROSE_RE, '');
  if (trimmed !== tail && isValidPathTail(trimmed)) {
    return { kind: 'none' };
  }

  if (tail.startsWith('-')) {
    if (FUNCTION_ACCESSOR.startsWith(tail)) {
      return { kind: 'function', exprStart, partial: '' };
    }
    if (!tail.startsWith(FUNCTION_ACCESSOR)) {
      return { kind: 'none' }; // a stray hyphen, not the function accessor
    }
    const partial = tail.slice(FUNCTION_ACCESSOR.length);
    return SEGMENT_RE.test(partial)
      ? { kind: 'function', exprStart, partial }
      : { kind: 'invalid', exprStart, tail };
  }

  {
    const parts = tail.slice(1).split('.');
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      if (!SEGMENT_RE.test(parts[i]) || (parts[i] === '' && !isLast)) {
        return { kind: 'invalid', exprStart, tail };
      }
    }
    return { kind: 'path', exprStart, segments: parts.slice(0, -1), partial: parts[parts.length - 1] };
  }
}

function isValidPathTail(tail: string): boolean {
  if (tail === '') {
    return true;
  }
  if (!tail.startsWith('.')) {
    return false;
  }
  return tail
    .slice(1)
    .split('.')
    .every((part, i, parts) => SEGMENT_RE.test(part) && (part !== '' || i === parts.length - 1));
}

/**
 * Candidate names for a path context: the known children of the resolved node,
 * prefix-filtered by what is being typed. The exact word already typed is left
 * out - suggesting it back is never useful.
 */
export function suggestionsFor(root: ConceptNode, segments: string[], partial: string): string[] {
  const node = resolveNode(root, segments);
  if (!node) {
    return [];
  }
  const prefix = partial.toLowerCase();
  return childKeys(node).filter(
    (key) => key !== partial && key.toLowerCase().startsWith(prefix)
  );
}

/** The whole `root` object as formatted JSON. */
export function dumpJson(root: ConceptNode): string {
  return JSON.stringify(root, null, 2);
}

/** The `$->dump` replacement text. */
export function dumpText(root: ConceptNode, asCodeBlock: boolean): string {
  const json = dumpJson(root);
  return asCodeBlock ? '```json\n' + json + '\n```' : json;
}
