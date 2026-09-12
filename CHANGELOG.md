# Changelog

## 1.2.0

- Built for large specs. On a 50,000-word document, typing costs the same with
  Pratyaya as without it - with the sidebar and live view open or closed - and
  completion typically answers within a millisecond or two. There is headroom to
  100,000 words.
- Nothing is recomputed while you type. The document is analysed once typing
  pauses, and colours and views update only when what they show has changed,
  which for ordinary prose outside a definition is never. Completion still reads
  the text exactly as it is at that moment.
- Colours no longer stretch over text typed straight after a reference.
- Suggestion details and sidebar tooltips are built only when shown, and long
  previews are cut short instead of rendering a whole subtree.
- `npm run bench` and `npm run bench:editor` measure the core and a real editor
  on a generated spec; `PRATYAYA_BENCH_WORDS` sets its size.

## 1.1.0

- The `$->define` walk only offers concepts that still need a definition. A
  defined concept stays in the walk only while something beneath it is
  undefined, and then without `()`, so its children remain reachable.
- An empty definition counts as a definition, so a heading you have just created
  is not offered again.
- Ordinary `$.` completion is unchanged and still offers every concept.

## 1.0.0

First stable release. Rolls up everything since 0.4.2, the last version on the
Marketplace; 0.4.3 and 0.5.0 below were never published on their own.

- `$->define` walks `root` from the start of a line and turns it into a
  `#### $.a.b` definition heading; the text under it is stored on the concept as
  `($.def)` and carried into dumps, the live view and tooltips.
- `dump` sits beside `root` in the scope rather than on it, so `root` is pure
  data and a concept may itself be named `dump`.

## 0.5.0

- New `$->define` function. Typed at the start of a line it walks `root` a level
  at a time, offering `()` to define the concept it has landed on and `.` to go
  deeper. `()` rewrites the line as a `#### $.a.b` heading.
- Everything under such a heading is the concept's definition, stored on the
  concept as `($.def)` and carried into dumps, the live view and tooltips. It
  ends at a `---` rule, a heading of level one to four, or the end of the file.
  A single blank line either side is dropped - the one after the heading, and the
  document's final newline - since both are page layout rather than definition.
- Definition headings are coloured whole once their concept resolves.
- Scope functions can now take a path, so `define` is a registry entry rather
  than a special case.

## 0.4.3

- `dump` now sits beside `root` in the scope rather than being a special function
  on it. `root` is pure data: only concepts, nothing else.
- Scope functions are a registry in `concepts.ts` instead of a special case
  threaded through the completion provider, so adding one is a single entry.
- Because the namespaces are separate, a concept may be named `dump`: `$.dump` is
  data, `$->dump` is the function.
- No change to what you type.

## 0.4.2

- Added an extension icon and a gallery banner for the Marketplace listing.
- Added CI on every push, and a release workflow that publishes to both the
  VS Code Marketplace and Open VSX when a version tag is pushed.

## 0.4.1

- Fixed `$->dump` never appearing in the suggestion widget. The item replaces the
  whole expression, so VS Code filtered it against the typed `$->dump` while the
  item asked to be filtered on `dump` - a match that can never happen, and the
  widget dropped it silently. It had been broken since the first release.
- Added integration tests that trigger and accept through the real suggest widget,
  which is where filtering and insertion actually happen.

## 0.4.0

- The sigil typed in the document is now `$` instead of `($)`: write
  `$.screens.Splash`. Two characters shorter per reference.
- The self-name key inside the object is unchanged, so nodes still read
  `{ "($)": "screens", ... }` and existing dumps still make sense.
- A `$` is only a concept once `.` or `->` follows it, so prices, shell snippets
  and maths in a spec are untouched by completion, highlighting and the tree.
- A bare `$` no longer opens the suggestion widget.
- Documents written with the old `($)` sigil are no longer parsed; search and
  replace `($).` with `$.` to migrate.

## 0.3.0

- Concept expressions are now coloured in the editor: `#05c3f9` on dark themes,
  `#800c0c` on light ones, both configurable and applied without a reload.
- Highlighting can be turned off with `pratyaya.highlightConcepts`.
- Colouring covers the expression only, stopping before prose punctuation, and
  follows your typing rather than the last save.

## 0.2.0

- The `root` object is now attached to each document and rebuilt on every content
  change, instead of being derived only when something asked for it.
- **Concepts** tree in the Explorer sidebar, following the markdown file you are
  editing, with a live concept count.
- `Pratyaya: Show live concept tree` replaces the old snapshot panel: the JSON
  view re-renders as you type rather than freezing at the moment it was opened.
- `($)->dump` now builds its JSON when the completion is accepted, so the block
  can never be a keystroke behind.
- Inline action on a sidebar concept inserts its `($)` reference at the cursor.
- Integration tests that drive a real VS Code instance on an unsaved buffer.

## 0.1.0

- First release.
- `($)` concept expressions in markdown, with nested autocomplete over `.`.
- The `root` tree is derived from the document, so it grows and shrinks with edits.
- Prefix-filtered suggestions in document order.
- Malformed expressions collapse to a single red, non-applicable `invalid` entry.
- `($)->dump` inserts the whole tree as formatted JSON.
- Commands: `Pratyaya: Dump concept tree at cursor`, `Pratyaya: Show concept tree for this document`.
