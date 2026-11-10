// Flea-side hints for ambiguous extensions. Leave jsmdcui's normal detection
// untouched unless the bounded source prefix contains a V function declaration.
export function previewLanguage(path, bytes) {
  if (!/\.v$/i.test(path ?? '')) return null;
  const source = bytes.subarray(0, 65536).toString('utf8')
    .replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, ' ');
  // Verilog/SystemVerilog keeps priority when its module terminator is present.
  if (/\bendmodule\b/.test(source)) return null;
  return /^\s*(?:pub\s+)?fn\s+(?:\([^\r\n)]*\)\s*)?[A-Za-z_]\w*\s*(?:\[[^\r\n\]]*\]\s*)?\(/m.test(source) ? 'v' : null;
}
