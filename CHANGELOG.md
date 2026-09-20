# Changelog

## 2.1.1

- The sample screenshot in the README pointed at a file that no longer
  exists, so it rendered as a broken image on the Marketplace listing. Only the
  listing changes; the extension itself is unchanged from 2.1.0.

## 2.1.0

- Several files can now share one concept tree. Point the new `pratyaya.roots`
  at the globs that belong together and a reference written in any of their files
  completes, resolves, renames and dumps against the concepts of all of them: a
  definition in one file defines that concept everywhere, <kbd>F2</kbd> renames
  across every file of the root whether it is open or not, and `$->dump` writes
  the whole root.
- Each pattern is a root of its own, so two specs in one repo stay apart; write
  several globs as one pattern to gather them into one root. With none set,
  nothing is shared and every document keeps the tree of its own text.
- Members are read once in the background and kept current by a watcher, and an
  open editor always wins over the copy on disk - so a concept typed into one
  file is offered in another with nothing saved in between.
- Concepts that are referenced but never defined are now reported: a faint
  underline in the editor and an entry in the Problems panel, so the gap between
  what a spec names and what it explains is visible while you write.
- Each one is reported once, on its own name in the first reference that reaches
  it, rather than at every mention - a spec repeats its concepts constantly, and
  the useful thing is the list of concepts still to pin down. Because
  referencing a path creates every level of it, a parent is reported apart from
  its children.
- It is the `$->define` walk seen from the other side: what the walk still offers
  is exactly what gets reported, and defining a concept clears it as soon as you
  pause typing.
- A quick fix on a reported concept writes its definition heading and puts the
  cursor where the body goes. The heading joins the run of definitions the spec
  already keeps - after the last of them - rather than landing beside the
  reference, and a `---` is written before it only where the document already
  closes its definitions that way.
- New `pratyaya.undefinedConcepts` setting: `information` (the default), `hint`,
  `warning`, or `off`.

## 2.0.0

- **Breaking:** every expression is now written as inline code:
  `` `$.screens.Splash` ``, `` `$->dump` ``, `` `$->define.auth` ``, and
  definition headings as `` #### `$.auth.token` ``. Markdown previews with maths
  support read two bare `$` on a line as a formula, so a spec full of references
  rendered as run-together maths. Inside backticks the `$` is left alone, and the
  preview shows each reference in code font.
- A bare `$.screens.Splash` is no longer a reference: it adds nothing to the tree,
  gets no colour and no completion.
- Opening a markdown file that still has bare expressions offers to upgrade it,
  wrapping each one in backticks in a single undoable edit. **Never ask again**
  turns the offer off through the new `pratyaya.offerUpgrade` setting.
- **Pratyaya: Upgrade old-style concept expressions** runs the same upgrade on
  the active file from the Command Palette. Fenced code blocks and inline code
  are left untouched by it.
- Accepting `` `$->dump `` also removes a closing backtick typed after the cursor.

## 1.4.1

- Colours no longer spread onto text typed at the edge of a coloured range.
  Typing under a heading that `$->define` had just written coloured the new
  lines, and they stayed coloured until an unrelated edit redrew the editor.
  This came in with 1.2.0.

## 1.4.0

- Rename a concept across the document: <kbd>F2</kbd> on any name in a `$.`
  reference, or **Rename concept…** in the Concepts view. Every reference
  running through the concept is renamed in one edit, so its children move with
  it and its definition stays attached. Headings and fenced code blocks are
  included, and different concepts with the same name are left alone.
- Renaming onto a name that already exists beside the concept merges the two,
  after asking.

## 1.3.1

- Fenced code blocks are code, not markdown. A `# comment` or `---` line inside
  a fence no longer ends a definition, so shell snippets and YAML can sit in a
  definition whole. A fence runs to its matching closing fence, or to the end of
  the document if it is never closed.
- A `#### $.a.b` line inside a fence no longer starts a definition, so a spec can
  show an example heading. It still counts as a reference.

## 1.3.0

- A concept's definition is now stored under `($->def)` instead of `($.def)`.
  The old key contained `$.def`, which read as a reference, so a dump written
  into a spec that had definitions added a stray `def` concept to the tree.
- The README now covers `$.`, `$->define` and `$->dump` in full: reference rules,
  the shape of `root`, exactly where a definition ends, and how to refresh a dump.

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
