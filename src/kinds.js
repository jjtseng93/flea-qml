// What a row is, from its name and its own stat alone: the emoji the row draws (`i`), its Kind
// description and the class kind ordering groups by. No MIME database or other system file is read,
// so every platform answers the same. The emoji set starts from bunmsh's fancy ls (src/fancy-ls.js),
// with 📁 for a folder so 📦 can mean a package and 🗜️ a compressed archive.

const S_IFMT = 0o170000,
  S_IFLNK = 0o120000,
  ANY_EXECUTE_BIT = 0o111;

// [group, emoji, extensions, category]. A row's Kind is its category and its upper-case
// extension, "Image JPG", "Document PDF", "Code JS": what the Kind column shows is exactly what the
// Kind order compares (src/order.js), so a reader can always tell why a row sorts where it does.
const TABLE = [
  ["image", "🖼️", "png jpg jpeg gif webp svg bmp ico cur wbmp avif heic", "Image"],
  ["audio", "🎵", "mp3 wav flac ogg m4a aac opus mid midi", "Audio"],
  ["video", "🎬", "mp4 mkv webm mov avi m4v mpeg mpg", "Video"],
  // A .tar.gz names its outer layer, gz, so it is compressed; a bare .tar only packs.
  ["archive", "🗜️", "zip gz tgz xz txz bz2 tbz2 zst tzst 7z rar lz lz4 lzma z", "Archive"],
  ["package", "📦", "tar deb rpm apk jar war whl appimage msi dmg pkg snap flatpak cpio", "Package"],
  ["disc", "💿", "iso img qcow2 vhd vhdx vmdk", "Disk"],
  ["pdf", "📕", "pdf", "Document"],
  ["document", "📘", "doc docx odt rtf", "Document"],
  ["spreadsheet", "📗", "xls xlsx ods csv tsv", "Spreadsheet"],
  ["presentation", "📙", "ppt pptx odp key", "Presentation"],
  ["markdown", "📝", "md markdown", "Document"],
  ["text", "📄", "txt log", "Text"],
  ["font", "🔤", "ttf otf woff woff2", "Font"],
  ["database", "🐬", "sql db sqlite sqlite3 db3", "Database"],
  ["config", "🔣", "json yaml yml toml ini xml conf cfg", "Data"],
  ["shell", "💲", "sh bash zsh fish bat cmd ps1", "Script"],
  ["binary", "💾", "bin dat o obj so a dll lib dylib class pyc wasm", "Binary"],
  // Source code, one language per row: the emoji tells them apart, the Kind names the extension.
  ["code", "🟨", "js mjs cjs", "Code"],
  ["code", "🟦", "ts mts cts", "Code"],
  ["code", "🐍", "py", "Code"],
  ["code", "🔧", "c", "Code"],
  ["code", "🧩", "h", "Code"],
  ["code", "➕", "cpp cc cxx hpp hh hxx", "Code"],
  ["code", "🔧", "cs", "Code"],
  ["code", "🦀", "rs", "Code"],
  ["code", "🐹", "go", "Code"],
  ["code", "☕", "java", "Code"],
  ["code", "🟪", "kt kts", "Code"],
  ["code", "💎", "rb", "Code"],
  ["code", "🐘", "php", "Code"],
  ["code", "🌙", "lua", "Code"],
  ["code", "🎯", "dart", "Code"],
  ["code", "❄️", "nix", "Code"],
  ["code", "🌐", "html htm", "Code"],
  ["code", "🎨", "css", "Code"],
  ["code", "🐳", "dockerfile", "Code"],
];
const BY_EXTENSION = new Map();
for (const [group, icon, extensions, kind] of TABLE)
  for (const ext of extensions.split(" ")) BY_EXTENSION.set(ext, { group, icon, kind });
// Files known by their whole name rather than an extension, compared case-insensitively.
const BY_NAME = new Map([
  ["dockerfile", BY_EXTENSION.get("dockerfile")],
  ["containerfile", BY_EXTENSION.get("dockerfile")],
]);

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
    known = BY_NAME.get(name.toLowerCase()) ?? BY_EXTENSION.get(ext);
  let icon, kind, group;
  // A file known by its whole name (Dockerfile) names itself where an extension would stand.
  const shown = upper || name.toUpperCase();
  if (known) [icon, kind, group] = [known.icon, `${known.kind} ${shown}`, known.group];
  else if ((mode & S_IFMT) !== S_IFLNK && mode & ANY_EXECUTE_BIT) [icon, kind, group] = [PROGRAM, "Program", "program"];
  // An extension nothing names may still be text, so it keeps the plain page rather than the disk.
  else [icon, kind, group] = [OTHER, ext ? `File ${upper}` : "File", "file"];
  // A link draws as a link, whatever it names; a link to a folder still sorts with files by its own name.
  if ((mode & S_IFMT) === S_IFLNK) icon = target === null ? BROKEN_LINK : LINK;
  return { icon, kind, group };
}
