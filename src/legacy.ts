/**
 * Finding the expressions written before 2.0.0, when they were bare - `$.a.b`,
 * `$->dump` - rather than inline code. Like `concepts.ts`, this needs nothing from
 * VS Code.
 */

import { markdownLines, ConceptSpan, QUOTE, SCOPE_FUNCTIONS } from './concepts';

/**
 * A bare reference, or a bare call of one of the scope functions. A function must
 * be named in full, so the `($->def)` key in a dump is not mistaken for one.
 */
const LEGACY_RE = new RegExp(
  String.raw`\$(?:(?:\.[A-Za-z0-9_-]+)+|->(?:${SCOPE_FUNCTIONS.map((fn) => fn.name).join('|')})(?:\.[A-Za-z0-9_-]+)*(?![A-Za-z0-9_-]))`,
  'g'
);

/**
 * The inline code spans on one line. A run of backticks opens a span that the
 * next run of the same length closes; a run nothing closes is just backticks.
 */
function codeSpans(line: string): ConceptSpan[] {
  const runs = [...line.matchAll(/`+/g)];
  const spans: ConceptSpan[] = [];
  for (let i = 0; i < runs.length; i++) {
    const close = runs.findIndex((run, j) => j > i && run[0].length === runs[i][0].length);
    if (close !== -1) {
      spans.push({ start: runs[i].index, end: runs[close].index + runs[close][0].length });
      i = close;
    }
  }
  return spans;
}

/**
 * Old-style expressions in a document, each to be wrapped in backticks.
 *
 * Only prose is searched. Anything inside code - a fenced block, or an inline
 * code span such as `` `run $.a here` `` - is left alone: it never upset the
 * preview, and a `$.store.book` there is as likely to be JSONPath as a concept. An
 * expression already touching a backtick is left alone too, rather than guessed
 * at.
 */
export function legacyExpressions(text: string): ConceptSpan[] {
  const found: ConceptSpan[] = [];
  for (const line of markdownLines(text)) {
    if (line.fenced || !line.text.includes('$')) {
      continue;
    }
    const spans = codeSpans(line.text);
    for (const match of line.text.matchAll(LEGACY_RE)) {
      const start = match.index;
      const end = start + match[0].length;
      const inCode = spans.some((span) => span.start <= start && start < span.end);
      if (inCode || line.text[start - 1] === QUOTE || line.text[end] === QUOTE) {
        continue;
      }
      found.push({ start: line.start + start, end: line.start + end });
    }
  }
  return found;
}

/** The document with every old-style expression wrapped in backticks. */
export function upgradeLegacy(text: string): string {
  let out = '';
  let last = 0;
  for (const { start, end } of legacyExpressions(text)) {
    out += text.slice(last, start) + QUOTE + text.slice(start, end) + QUOTE;
    last = end;
  }
  return out + text.slice(last);
}
