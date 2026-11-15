import {expect, test} from 'bun:test';
import {mermaidToSvg} from '../src/pele-wrapper.js';
import fixtures from './fixtures/pele-parity.json';

// Baseline: the former Flea bundle (SHA-256
// 6030688a4dc97db8eee282af325343a8de1ae300f862a6f5c9d9175d40c8b765).
// Store only inputs and output hashes, not a second copy of the renderer.
// 33 inputs come from Flea's tests/fixtures/markdown-mermaid at 5da918109:
// Flea/Pele/Mermaid MIT examples; see THIRD-PARTY-NOTICES.md.
for (const entry of fixtures.cases) {
  test(`Pele preserves legacy output: ${entry.name}`, () => {
    for (const [index, theme] of fixtures.themes.entries()) {
      const expected = entry.results[index];
      if (expected.error) {
        let error;
        try {mermaidToSvg(entry.source, theme);} catch (e) {error = e.message;}
        expect(error).toBe(expected.error);
      } else {
        const svg = mermaidToSvg(entry.source, theme);
        expect(new Bun.CryptoHasher('sha256').update(svg).digest('hex')).toBe(expected.sha256);
      }
    }
  });
}
test('Pele is the unmodified official 1.6.0 ESM distribution', async () => {
  const bytes = await Bun.file(new URL('../src/vendor/pele.js', import.meta.url)).arrayBuffer();
  expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe('d1ebc1889f3069d7759fe5db34c4ad4b4823285edbee2b537d0ef3d505a76d8d');
});
