# Pele source and wrapper

Pele 1.6.0 (https://github.com/obsidianmd/pele), MIT.

src/vendor/pele.js is the unmodified npm distribution dist/pele.js, downloaded from:
https://cdn.jsdelivr.net/npm/pele@1.6.0/dist/pele.js
Size: 677679 bytes
SHA-256: d1ebc1889f3069d7759fe5db34c4ad4b4823285edbee2b537d0ef3d505a76d8d
Licence: src/vendor/LICENSES/MIT-pele.txt (including the ISC notice for its Lucide zoom-control icon).
No build step is needed.

src/pele-wrapper.js is Flea's MIT wrapper from tools/vendor-js/mermaid-entry.mjs
at commit 5da918109, with only a source comment added and the import changed from
"pele" to "./vendor/pele.js". Flea's copyright and licence are in the root LICENSE.
The wrapper adapts font measurement, theme colours, sequence defaults, flowchart
and sequence geometry, and output size. src/figure-thread.js loads it in a Worker.

The former combined bundle is not shipped. test/pele-parity.test.js compares
38 inputs across four fixed themes with hashes/errors recorded from that bundle.
The 33 diagram-type examples originate in Flea's tests/fixtures/markdown-mermaid:
flowchart is Flea's own; the other examples derive from Pele 1.6.0's corpus and
Mermaid documentation. See src/vendor/LICENSES/MIT-pele.txt, src/vendor/LICENSES/MIT-mermaid.txt
and the root LICENSE.
