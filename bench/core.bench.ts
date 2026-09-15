import { performance } from 'node:perf_hooks';
import { generateSpec } from './generate';
import {
  buildTree,
  childKeys,
  conceptSpans,
  countDescendants,
  definitionHeadings,
  dumpJson,
  parseContextAt,
  resolveNode,
  scopeFunction,
  suggestionsFor,
  walkSuggestions,
  ConceptNode,
} from '../src/concepts';

/** Median, p95 and max of a function's wall time, after a warm-up. */
function measure(name: string, fn: () => unknown, runs = 40): void {
  for (let i = 0; i < 5; i++) {
    fn();
  }
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  console.log(
    `${name.padEnd(52)} median ${at(0.5).toFixed(2).padStart(7)} ms   p95 ${at(0.95).toFixed(2).padStart(7)} ms   max ${times[times.length - 1].toFixed(2).padStart(7)} ms`
  );
}

const words = Number(process.argv[2] ?? 50_000);
const spec = generateSpec(words);
const text = spec.text;
const tree = buildTree(text);
const define = scopeFunction('define')!.path!;
const lines = text.split('\n').length;

console.log(`document: ${spec.words} words, ${(text.length / 1024).toFixed(0)} KB, ${lines} lines`);
console.log(`          ${spec.references} references, ${spec.definitions} definitions, ${countDescendants(tree)} concepts in the tree`);
console.log(`          dump is ${(dumpJson(tree).length / 1024).toFixed(0)} KB of JSON`);
console.log();

console.log('-- once per keystroke, today --');
measure('buildTree (store rebuild)', () => buildTree(text));
measure('definitionHeadings (inside buildTree + again in highlight)', () => definitionHeadings(text));
measure('conceptSpans (highlight)', () => conceptSpans(text));
measure('countDescendants (tree view title)', () => countDescendants(tree));
console.log();

console.log('-- once per completion request, today --');
const middle = text.indexOf('\n', Math.floor(text.length / 2));
const probe = text.slice(0, middle) + '\n`$.' + text.slice(middle);
measure('parseContextAt', () => parseContextAt(probe, middle + 4));
measure('suggestionsFor at `$.', () => suggestionsFor(tree, [], ''));
measure('walkSuggestions at `$->define.', () => walkSuggestions(define, tree, [], ''));
measure('dumpJson(root) - documentation of each $-> item', () => dumpJson(tree));
measure('dumpJson per top-level item - documentation at $.', () => {
  for (const key of childKeys(tree)) {
    dumpJson(resolveNode(tree, [key]) as ConceptNode);
  }
});
