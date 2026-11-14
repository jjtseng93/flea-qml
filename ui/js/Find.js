.pragma library

// Match names by default; a forward slash explicitly asks for a relative path.
// find emits slash-separated paths on Windows too (bunmsh's builtin), so the
// query is never rewritten to backslashes, which would become glob escapes.
function expression(query, hidden) {
    var pattern = /[*?[]/.test(query) ? query : "*" + query + "*"
    var predicate = query.indexOf("/") >= 0 ? "-ipath" : "-iname"
    return hidden ? [predicate, pattern]
        : ["-mindepth", "1", "-name", ".*", "-prune", "-o", predicate, pattern, "-print"]
}

// flea-qml: Ctrl+G's content search, `grep -r` with the query as literal text. Each file reports
// its first matching line (-m 1), binary files included (-a), case ignored as -iname ignores it.
// -o with CONTEXT characters either side bounds every output line, so a match inside a huge line
// (a minified script, a binary with no line ends) still arrives as a short snippet around the
// match. -Z ends the file name with NUL, so a name holding ":" parses. With no path operand grep
// walks "." and names files without "./"; hidden names are skipped as find prunes them, and the
// bare "." is never excluded by --exclude-dir.
var CONTEXT = 80
var SNIPPET_LIMIT = 300
function escapeRegex(text) {
    return String(text).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
}
function grepArguments(query, hidden) {
    var args = ["-r", "-n", "-o", "-a", "-i", "-m", "1", "-Z", "--line-buffered", "-E"]
    if (!hidden) args.push("--exclude=.*", "--exclude-dir=.*")
    return args.concat(["-e", ".{0," + CONTEXT + "}" + escapeRegex(query) + ".{0," + CONTEXT + "}"])
}
// One output line "name\0line:text" as {path, line, text}, or null for anything else.
function grepLine(raw) {
    var line = String(raw)
    var cut = line.indexOf("\u0000")
    if (cut <= 0) return null
    var rest = line.substring(cut + 1)
    var number = /^(\d+):/.exec(rest)
    if (!number) return null
    return { path: line.substring(0, cut), line: Number(number[1]), text: snippet(rest.substring(number[0].length)) }
}
// Control characters (a binary's NULs among them) and undecodable bytes become a middle dot and tabs a space, so the
// row's single line of PlainText never breaks or hides; the text is cut at SNIPPET_LIMIT.
function snippet(text) {
    var cut = text.length > SNIPPET_LIMIT ? text.substring(0, SNIPPET_LIMIT) : text
    // U+FFFD is a byte that was not UTF-8, as a binary holds many; it is shown the same way.
    return cut.replace(/\t/g, " ").replace(/[\u0000-\u001f\u007f\ufffd]/g, "\u00b7").trim()
}
