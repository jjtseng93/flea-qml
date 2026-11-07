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
