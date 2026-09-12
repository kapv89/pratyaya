# Pratyaya - Monumentally Scale Your Prompts

[VSCode Marketplace Page](https://marketplace.visualstudio.com/items?itemName=kapv89.pratyaya)

![top secret spec.md screenshot](images/secret.spec.md.png)

Capture the key concepts of a large markdown spec while you write it.

Type `$.` in a markdown file and Pratyaya offers you every concept the document
already knows about, nested under `.`. Mention a concept that does not exist yet
and it simply joins the tree. When you want the whole picture in one place, type
`$->dump` and the entire tree lands in the document as formatted JSON.

It is built for specs written to be handed to coding agents such as Claude Code:
the `$` references keep concept names consistent as the document grows, and the
dump gives the agent — and you — the full concept map in one block.

## How it works

Every markdown document has a `root` object attached to it, held in memory and
rebuilt from the document's own text on every content change. It tracks your
typing keystroke by keystroke - nothing waits for a save - and because it is
derived rather than stored, it can never drift from what the document says:
writing a new path grows it, deleting a mention shrinks it, reopening the file
reconstructs it.

Writing this in a spec:

```
The $.screens.Splash screen checks for a $.components.PrivateKey.
On failure it redirects to $.screens.NewUsername.
```

gives you this `root`:

```json
{
  "screens": {
    "($)": "screens",
    "Splash": { "($)": "Splash" },
    "NewUsername": { "($)": "NewUsername" }
  },
  "components": {
    "($)": "components",
    "PrivateKey": { "($)": "PrivateKey" }
  }
}
```

Every node carries its own name under the `($)` key, and its children sit
alongside it, in the order they first appear in the document. The sigil you type
is short - `$` - while the object keeps the longer `($)` marker, so a dumped tree
stays readable on its own.

## The scope

`$` opens a scope holding two things, side by side:

| Reached with | What it is |
| --- | --- |
| `$.` | **`root`** - the concept tree. Pure data: concepts and nothing else. |
| `$->` | **functions** - `dump` and `define`. |

A function is not a member of `root` and `root` is not a member of the functions.
Nothing reached through `->` can ever be written into the tree, show up in a dump,
or appear in the Concepts view - and because the two namespaces are separate, a
concept of your own may be called `dump` without colliding with the function:
`$.dump` is data, `$->dump` is the function.

A `$` only opens the scope once an accessor follows it. Every other dollar in a
spec - `$5`, `$100`, `$(pwd)`, `$x$` - is left alone: no suggestions, no
highlight, nothing in the tree.

## Completion

| You type | You get |
| --- | --- |
| `$.` | the top-level concepts — `screens`, `components` |
| `$.screens.` | that node's children — `Splash`, `NewUsername` |
| `$.screens.S` | `Splash` only — filtering is by prefix, case-insensitive |
| `$.screens.Payments` | nothing to suggest; the new concept is added to the tree |
| `$->` | the scope's functions - `dump`, `define` |
| `$->dump` | the whole tree, as a formatted JSON block |

Suggestions keep document order rather than sorting alphabetically, so the list
reads the way the spec does. Branch concepts show a module icon, leaves a field
icon, and the details pane previews the subtree under the concept.

## Defining concepts

A reference says *where* a concept is used. A definition says *what it is*, in
the document, next to everything else.

Start one with `$->define.` at the beginning of a line. The walk offers the
concepts you already have, a level at a time:

| You type | You get |
| --- | --- |
| `$->define.` | the top-level concepts |
| `$->define.au` | concepts starting with `au` |
| `$->define.auth` | `()` to define `auth`, and `.` because it has children |
| `$->define.auth.` | the children of `auth` |
| `$->define.auth.token` | `()` alone - `token` is a leaf |

The walk only offers what is still undefined. A concept that already has a
definition - even an empty one - is left out, unless something beneath it has
none yet. Then it stays, so you can walk through it, but without `()`.

Choosing `()` ends the walk and rewrites the line as a heading:

```
#### $.auth.token
```

Everything under that heading is the definition. It ends at the first line that
is `---`, or a heading of level one to four - the next definition included - or
the end of the document. A single blank line either side is left out: the one you
write after the heading, and the final newline of a document. It lands on the
concept itself, under `($.def)`, beside the name:

```json
{
  "auth": {
    "($)": "auth",
    "token": { "($)": "token", "($.def)": "The key a signed-in device holds.\n" }
  }
}
```

So definitions travel with the tree: they are in every `$->dump`, in the live
JSON view, and in a concept's tooltip in the Concepts view. A heading is a
concept reference like any other, so `#### $.auth.token` also declares the
concept - you can define something before you first use it. Write two definitions
for one concept and the last one wins.

Definition headings are coloured whole, in the concept colour, once their path
resolves in the tree.

### The invalid state

A concept expression is a `$` followed by dot-separated segments of
`[A-Za-z0-9_-]`. Anything else — `$.\.*$`, `$..`, `$.a.b/c` — puts the
expression into the invalid state: completion stops and the list collapses to a
single red, struck-through `invalid` entry. That entry can never be applied;
accepting it inserts nothing at all and tells you why.

Punctuation that closes a sentence (`$.screens.Splash,`) is read as prose, not
as a malformed expression, so completion just stops there.

## Commands

- **Pratyaya: Dump concept tree at cursor** — the `$->dump` output, without
  typing the expression.
- **Pratyaya: Show concept tree for this document** — opens the tree as JSON in a
  panel beside the document, leaving the spec untouched.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `pratyaya.enabledLanguages` | `["markdown"]` | Language ids where `$` is active. |
| `pratyaya.dumpAsCodeBlock` | `true` | Wrap dumped JSON in a fenced `json` block. |
| `pratyaya.highlightConcepts` | `true` | Colour `$` expressions in the editor. |
| `pratyaya.conceptColor.dark` | `#05c3f9` | Concept colour on dark themes. |
| `pratyaya.conceptColor.light` | `#800c0c` | Concept colour on light themes. |

Colour changes take effect immediately - no reload.

Markdown ships with quick suggestions turned off, so the widget opens on the
trigger characters `.`, `-` and `>` — which is exactly when you want it. To
have it also open as you type a concept name, add:

```json
"[markdown]": {
  "editor.quickSuggestions": { "other": "on" }
}
```

## Development

```bash
npm install
npm test               # core unit tests (no editor needed)
npm run test:integration   # drives a real VS Code instance
npm run test:all
npx vsce package       # builds pratyaya-<version>.vsix
```

Press <kbd>F5</kbd> to open an Extension Development Host on `examples/`.

The concept tree lives in [`src/concepts.ts`](src/concepts.ts) as pure functions
with no VS Code imports — parsing, tree building, filtering and dumping are all
unit tested in [`test/concepts.test.ts`](test/concepts.test.ts). The scope's
functions are a registry in that same file; adding one there is enough for it to
be offered after `$->` and rendered when accepted.
[`src/store.ts`](src/store.ts) attaches a live tree to each document,
[`src/highlight.ts`](src/highlight.ts) colours the expressions,
[`src/views.ts`](src/views.ts) draws the sidebar and the live JSON view, and
[`src/extension.ts`](src/extension.ts) is the editor glue.

[`test/integration/live.test.ts`](test/integration/live.test.ts) runs inside a
real VS Code instance against a buffer that is never saved, so it pins down the
behaviour that matters most: suggestions, the live view and the dump all reflect
text typed a moment ago, with no save in between.

## Releasing

Tagging a version publishes it. `.github/workflows/release.yml` runs both test
suites, packages the extension, pushes it to the VS Code Marketplace and Open VSX,
and attaches the `.vsix` to a GitHub release:

```bash
npm version patch      # or minor / major - commits and tags
git push --follow-tags
```

The tag must match `package.json`; the workflow checks and fails early if it does
not. It needs two repository secrets, under Settings - Secrets and variables -
Actions:

| Secret | Where it comes from | Required |
| --- | --- | --- |
| `VSCE_PAT` | Azure DevOps personal access token, scope Marketplace - Manage, organization "All accessible organizations" | yes |
| `OVSX_PAT` | Open VSX access token from open-vsx.org | no - the step is skipped without it |

`.github/workflows/ci.yml` runs the same suites on every push and pull request.

## License

MIT
