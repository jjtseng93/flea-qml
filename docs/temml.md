# Temml source and inherited notices

`src/vendor/temml.mjs` is the unmodified Temml 0.14.0 npm distribution:

- Source: https://cdn.jsdelivr.net/npm/temml@0.14.0/dist/temml.mjs
- Size: 478952 bytes
- SHA-256: `09e55a0c364d35b8ef66be49486b90884240a7e66c463a825e096faf27b0d59d`
- Licence: [MIT-temml.txt](../src/vendor/LICENSES/MIT-temml.txt).

No code or embedded attribution comments were changed. These additional notices
identify inherited work; historical source references do not imply that whole
source files are byte-identical to Temml's adapted implementation.

## KaTeX and Perseus

Temml's [0.14.0 README](https://cdn.jsdelivr.net/npm/temml@0.14.0/README.md)
identifies it as a KaTeX fork and credits Khan Academy and KaTeX contributors.
[MIT-katex.txt](../src/vendor/LICENSES/MIT-katex.txt) is copied unchanged from
[KaTeX v0.16.0](https://github.com/KaTeX/KaTeX/blob/v0.16.0/LICENSE).
This attribution reference is not a claim that Temml forked exactly that tag.

Temml's `findEndOfMath` retains a comment crediting Khan/Perseus. The same
brace-scanning algorithm and attribution appear in
[KaTeX's 2015 auto-render source](https://github.com/KaTeX/KaTeX/blob/cd9bca4a89eddd77c542e23a4a9dc2deff2ab72c/contrib/auto-render/splitAtDelimiters.js).
Its [contemporaneous licence](https://github.com/KaTeX/KaTeX/blob/cd9bca4a89eddd77c542e23a4a9dc2deff2ab72c/LICENSE.txt)
is retained unchanged as [MIT-katex-2015.txt](../src/vendor/LICENSES/MIT-katex-2015.txt),
including its original Underscore credit. This does not mean the full
Underscore library is shipped.

[MIT-perseus.txt](../src/vendor/LICENSES/MIT-perseus.txt) preserves the official
[Perseus licence](https://raw.githubusercontent.com/Khan/perseus/master/LICENSE)
retrieved on 2026-11-16. The precise original Perseus revision is not recorded
in Temml's comment. This modern licence is supplementary attribution, not proof
of the original revision's terms; the historical KaTeX source and licence above
document the traceable adaptation.

## React utilities

Temml explicitly credits Facebook's React under Apache-2.0 for `hyphenate` and
`escape`. Historical references exist in React v0.3.0:
[hyphenate](https://github.com/facebook/react/blob/v0.3.0/src/vendor/core/hyphenate.js)
and [escapeTextForBrowser](https://github.com/facebook/react/blob/v0.3.0/src/utils/escapeTextForBrowser.js).
Its [Apache-2.0 licence](https://github.com/facebook/react/blob/v0.3.0/LICENSE)
matches our [Apache-2.0.txt](../src/vendor/LICENSES/Apache-2.0.txt), apart from
the latter's leading blank line.

These are adapted utilities: Temml's escape helper converts to a string and
uses a smaller replacement table. The exact React commit originally used is
not identified by Temml; v0.3.0 documents the Apache-licensed historical source,
not an assertion that it was the precise imported revision. Preserve the
embedded attribution rather than substituting a later React release's licence.

## Chemistry and physics extensions

The shipped file preserves the original notices and adaptation descriptions for:

- mhchem: Copyright (c) 2011–2015 The MathJax Consortium;
  Copyright (c) 2015–2018 Martin Hensel.
- Physics macros: Copyright (c) 2015–2016 Kolen Cheung.

Their Apache-2.0 notices remain embedded in `temml.mjs`; the full licence is in
[Apache-2.0.txt](../src/vendor/LICENSES/Apache-2.0.txt). Temml's revision notices
are also retained. Temml's MIT licence does not replace these inherited credits.
