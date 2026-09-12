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

/** The key holding a concept's definition, written under a `####` heading. */
export const DEF_KEY = '($.def)';

/**
 * The accessor that reaches the scope's functions: `$->dump`.
 *
 * The marker opens a scope holding two things side by side: `root`, the concept
 * tree, reached with `.`; and the functions below, reached with `->`. A function
 * is never a member of `root` - it cannot be written into the tree, it never
 * appears in a dump, and it never shows up as a concept.
 */
export const FUNCTION_ACCESSOR = '->';

/** What `$->define` turns its line into. */
export const DEFINITION_PREFIX = '#### ';

export interface ConceptNode {
  [key: string]: ConceptNode | string;
}

/** How a scope function renders its replacement text. */
export interface RenderOptions {
  asCodeBlock: boolean;
}

/** A function that walks `root` before acting, like `$->define.screens.Splash`. */
export interface PathFunction {
  /** Shown beside the `()` suggestion that ends the walk. */
  callSummary: string;
  /** What the line becomes once `()` is accepted. */
  call(segments: string[]): string;
}

/** One of the functions sitting beside `root` in the scope. */
export interface ScopeFunction {
  /** Name as typed after the accessor. */
  name: string;
  /** One line describing it, shown beside the suggestion. */
  summary: string;
  /** Only offered when its expression is the first thing on the line. */
  lineStart?: boolean;
  /** Replaces its own expression with this text, like `dump`. */
  render?(root: ConceptNode, options: RenderOptions): string;
  /** Walks `root` and acts on the chosen path, like `define`. */
  path?: PathFunction;
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
  {
    name: 'define',
    summary: 'start a definition for a concept',
    lineStart: true,
    path: {
      callSummary: 'define this concept',
      call: (segments) => `${DEFINITION_PREFIX}${MARKER}.${segments.join('.')}`,
    },
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
const CONCEPT_SCAN_RE = /\$->[A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*|\$(?:\.[A-Za-z0-9_-]+)+/g;

/** Punctuation that ends prose rather than continuing an expression. */
const TRAILING_PROSE_RE = /[,;:!?)\]}"'`*]+$/;

/** `#### $.a.b` on a line of its own - the head of a definition. */
const DEFINITION_HEADING_RE = /^#{4}[ \t]+\$((?:\.[A-Za-z0-9_-]+)+)[ \t]*$/;

/** A line that closes a definition: a rule, or a heading of level 1 to 4. */
const DEFINITION_END_RE = /^(?:---[ \t]*|#{1,4}(?!#))/;

/** Is everything before `offset` on its line blank? */
export function startsLine(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return text.slice(lineStart, offset).trim() === '';
}

/** A `#### $.a.b` heading and the definition body that follows it. */
export interface DefinitionHeading {
  /** Offsets of the heading line itself, for highlighting. */
  start: number;
  end: number;
  segments: string[];
  /** Everything up to the next rule, heading, or the end of the document. */
  body: string;
}

/**
 * Finds every definition in a document.
 *
 * A definition runs from the line after its heading until a line that is just
 * `---`, or a heading of level 1 to 4 (the next definition included), or the end
 * of the document - in which case the final newline is dropped, since it belongs
 * to the document rather than to the definition.
 */
export function definitionHeadings(text: string): DefinitionHeading[] {
  const lines: { text: string; start: number }[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    lines.push({ text: line.replace(/\r$/, ''), start: offset });
    offset += line.length + 1;
  }

  const headings: DefinitionHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = DEFINITION_HEADING_RE.exec(lines[i].text);
    if (!match) {
      continue;
    }

    const bodyStart = i + 1 < lines.length ? lines[i + 1].start : text.length;
    let end = text.length;
    let atEof = true;
    for (let j = i + 1; j < lines.length; j++) {
      if (DEFINITION_END_RE.test(lines[j].text)) {
        end = lines[j].start;
        atEof = false;
        break;
      }
    }

    let body = text.slice(bodyStart, end);
    if (atEof) {
      body = body.replace(/\r?\n$/, '');
    }

    headings.push({
      start: lines[i].start,
      end: lines[i].start + lines[i].text.length,
      segments: match[1].slice(1).split('.'),
      body,
    });
  }

  return headings;
}

/**
 * Builds the `root` object from the document text. The tree is always derived
 * from what is actually written, so it stays in sync with edits in both
 * directions - typing a new path grows it, deleting one shrinks it.
 */
export function buildTree(text: string): ConceptNode {
  // Collected first so a node can carry its definition from the moment it is
  // created, which keeps `($.def)` next to `($)` in a dump.
  const definitions = new Map<string, string>();
  for (const heading of definitionHeadings(text)) {
    definitions.set(heading.segments.join('.'), heading.body);
  }

  const root: ConceptNode = {};

  for (const match of text.matchAll(PATH_SCAN_RE)) {
    const segments = match[1].slice(1).split('.');
    let node = root;
    const walked: string[] = [];

    for (const segment of segments) {
      walked.push(segment);
      const existing = node[segment];
      if (existing && typeof existing === 'object') {
        node = existing;
        continue;
      }
      const child: ConceptNode = { [MARKER_KEY]: segment };
      const definition = definitions.get(walked.join('.'));
      if (definition !== undefined) {
        child[DEF_KEY] = definition;
      }
      node[segment] = child;
      node = child;
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
  return Object.keys(node).filter((key) => typeof node[key] === 'object');
}

/** A concept's definition, if one was written for it. */
export function definitionOf(node: ConceptNode): string | undefined {
  const definition = node[DEF_KEY];
  return typeof definition === 'string' ? definition : undefined;
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
 * with the `->` function accessor. A span stops where the expression stops, so
 * prose or punctuation written straight after it is left uncoloured, and a lone
 * `$` - a price, a shell prompt, some maths - is not a concept at all.
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
  | { kind: 'function'; exprStart: number; partial: string }
  /** Cursor is inside a path function's walk, like `$->define.screens.Sp`. */
  | {
      kind: 'functionPath';
      exprStart: number;
      name: string;
      segments: string[];
      partial: string;
    };

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
  if (trimmed !== tail && isCompleteTail(trimmed)) {
    return { kind: 'none' };
  }

  if (tail.startsWith('-')) {
    if (FUNCTION_ACCESSOR.startsWith(tail)) {
      return { kind: 'function', exprStart, partial: '' };
    }
    if (!tail.startsWith(FUNCTION_ACCESSOR)) {
      return { kind: 'none' }; // a stray hyphen, not the function accessor
    }

    const rest = tail.slice(FUNCTION_ACCESSOR.length);
    const dot = rest.indexOf('.');
    if (dot === -1) {
      return SEGMENT_RE.test(rest)
        ? { kind: 'function', exprStart, partial: rest }
        : { kind: 'invalid', exprStart, tail };
    }

    const name = rest.slice(0, dot);
    if (!scopeFunction(name)?.path) {
      return { kind: 'invalid', exprStart, tail }; // only path functions take one
    }
    const parts = splitPath(rest.slice(dot + 1));
    return parts
      ? { kind: 'functionPath', exprStart, name, segments: parts.slice(0, -1), partial: parts[parts.length - 1] }
      : { kind: 'invalid', exprStart, tail };
  }

  const parts = splitPath(tail.slice(1));
  return parts
    ? { kind: 'path', exprStart, segments: parts.slice(0, -1), partial: parts[parts.length - 1] }
    : { kind: 'invalid', exprStart, tail };
}

/** Splits a dotted path, or returns undefined if any segment is malformed. */
function splitPath(path: string): string[] | undefined {
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    if (!SEGMENT_RE.test(parts[i]) || (parts[i] === '' && !isLast)) {
      return undefined;
    }
  }
  return parts;
}

/** Is this a finished expression, so what follows it is prose? */
function isCompleteTail(tail: string): boolean {
  if (tail === '') {
    return true;
  }
  if (tail.startsWith(FUNCTION_ACCESSOR)) {
    const [name, ...path] = tail.slice(FUNCTION_ACCESSOR.length).split('.');
    return SEGMENT_RE.test(name) && path.every((part) => part !== '' && SEGMENT_RE.test(part));
  }
  if (!tail.startsWith('.')) {
    return false;
  }
  const parts = splitPath(tail.slice(1));
  return parts !== undefined;
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

/** What a path function offers once the walk has landed on something real. */
export interface PathActions {
  /** The `()` that ends the walk and applies the function. */
  call: boolean;
  /** The `.` that goes a level deeper. */
  descend: boolean;
}

/**
 * `()` appears as soon as the walk names an existing concept, and `.` joins it
 * when that concept has children. Mid-word or after a trailing dot there is
 * nothing to apply yet, so neither is offered.
 */
export function pathActions(root: ConceptNode, segments: string[], partial: string): PathActions {
  if (partial === '') {
    return { call: false, descend: false };
  }
  const node = resolveNode(root, [...segments, partial]);
  if (!node) {
    return { call: false, descend: false };
  }
  return { call: true, descend: childKeys(node).length > 0 };
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
