// What a row is, from its name and its own stat alone: the emoji the row draws (`i`), its Kind
// description and the class kind ordering groups by. No MIME database or other system file is read,
// so every platform answers the same. The emoji set starts from bunmsh's fancy ls (src/fancy-ls.js),
// with 📁 for a folder so 📦 can mean a package and 🗜️ a compressed archive.

const S_IFMT = 0o170000,
  S_IFLNK = 0o120000,
  ANY_EXECUTE_BIT = 0o111;

// [group, emoji, extensions, Kind]. A Kind given as a function is built from the upper-case
// extension; a string is used as it is.
const TABLE = [
  ["image", "🖼️", "png jpg jpeg gif webp svg bmp ico avif heic", (x) => `${x} image`],
  ["audio", "🎵", "mp3 wav flac ogg m4a aac opus mid midi", (x) => `${x} audio`],
  ["video", "🎬", "mp4 mkv webm mov avi m4v mpeg mpg", (x) => `${x} video`],
  // A .tar.gz names its outer layer, gz, so it is compressed; a bare .tar only packs.
  ["archive", "🗜️", "zip gz tgz xz txz bz2 tbz2 zst tzst 7z rar lz lz4 lzma z", (x) => `${x} archive`],
  ["package", "📦", "tar deb rpm apk jar war whl appimage msi dmg pkg snap flatpak cpio", (x) => `${x} package`],
  ["disc", "💿", "iso img qcow2 vhd vhdx vmdk", (x) => `${x} disk image`],
  ["pdf", "📕", "pdf", "PDF document"],
  ["document", "📘", "doc docx odt rtf", (x) => `${x} document`],
  ["spreadsheet", "📗", "xls xlsx ods csv tsv", (x) => `${x} spreadsheet`],
  ["presentation", "📙", "ppt pptx odp key", (x) => `${x} presentation`],
  ["markdown", "📝", "md markdown", "Markdown document"],
  ["text", "📄", "txt log", (x) => `${x} text`],
  ["font", "🔤", "ttf otf woff woff2", (x) => `${x} font`],
  ["database", "🐬", "sql db sqlite sqlite3 db3", (x) => `${x} database`],
  ["config", "🔣", "json yaml yml toml ini xml conf cfg", (x) => `${x} data`],
  ["shell", "💲", "sh bash zsh fish bat cmd ps1", (x) => `${x} script`],
  ["binary", "💾", "bin dat o obj so a dll lib dylib class pyc wasm", (x) => `${x} binary`],
  // Source code, one language per row.
  ["code", "🟨", "js mjs cjs", "JavaScript"],
  ["code", "🟦", "ts mts cts", "TypeScript"],
  ["code", "🐍", "py", "Python script"],
  ["code", "🔧", "c", "C source"],
  ["code", "🧩", "h", "C header"],
  ["code", "➕", "cpp cc cxx hpp hh hxx", "C++ source"],
  ["code", "🔧", "cs", "C# source"],
  ["code", "🦀", "rs", "Rust source"],
  ["code", "🐹", "go", "Go source"],
  ["code", "☕", "java", "Java source"],
  ["code", "🟪", "kt kts", "Kotlin source"],
  ["code", "💎", "rb", "Ruby script"],
  ["code", "🐘", "php", "PHP script"],
  ["code", "🌙", "lua", "Lua script"],
  ["code", "🎯", "dart", "Dart source"],
  ["code", "❄️", "nix", "Nix expression"],
  ["code", "🌐", "html htm", "HTML document"],
  ["code", "🎨", "css", "CSS stylesheet"],
];
const BY_EXTENSION = new Map();
for (const [group, icon, extensions, kind] of TABLE)
  for (const ext of extensions.split(" ")) BY_EXTENSION.set(ext, { group, icon, kind });

export const FOLDER = "📁",
  LINK = "🔗",
  BROKEN_LINK = "🚫",
  PROGRAM = "⚙️",
  OTHER = "📄";

export function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * { icon, kind, group } for a row. `group` is the class kind ordering compares and kind grouping
 * reads ("folder", "image", ...); `target` is a symlink's resolved stat, or null when it is broken.
 */
export function describeKind(name, isDir, mode, target) {
  if (isDir) return { icon: FOLDER, kind: "Folder", group: "folder" };
  const ext = extensionOf(name),
    upper = ext.toUpperCase(),
    known = BY_EXTENSION.get(ext);
  let icon, kind, group;
  if (known) [icon, kind, group] = [known.icon, typeof known.kind === "function" ? known.kind(upper) : known.kind, known.group];
  else if ((mode & S_IFMT) !== S_IFLNK && mode & ANY_EXECUTE_BIT) [icon, kind, group] = [PROGRAM, "Program", "program"];
  // An extension nothing names may still be text, so it keeps the plain page rather than the disk.
  else [icon, kind, group] = [OTHER, ext ? `${upper} file` : "File", "file"];
  // A link draws as a link, whatever it names; a link to a folder still sorts with files by its own name.
  if ((mode & S_IFMT) === S_IFLNK) icon = target === null ? BROKEN_LINK : LINK;
  return { icon, kind, group };
}
