.pragma library

// A search row's name is its path relative to the search root, so the display splits it here and
// the wire never carries a second shape; see docs/protocol.md "search".
function base(path) {
    var i = String(path).lastIndexOf("/")
    return i < 0 ? String(path) : String(path).substring(i + 1)
}

// A Trash row's storage name is an IO identity, never its visible caption.
function rowName(row, locating) {
    if (!row) return ""
    if (row.trash) return row.trash.name !== undefined ? String(row.trash.name) : base(row.trash.original || row.n)
    return locating ? base(row.n) : row.n
}

// The location column: the parent path relative to the scope, empty for a match in the root itself.
function location(path) {
    var i = String(path).lastIndexOf("/")
    return i < 0 ? "" : String(path).substring(0, i)
}

// Where to paint the accent run inside a name, mirroring the backend's own case-insensitive match.
// corner: a character whose lowercase form is a different length (Turkish dotted capital I) can
// shift the run by one; the name still renders whole, and the backend alone decides what matched.
function run(hay, needle) {
    var h = String(hay)
    var n = String(needle)
    if (n.length === 0) {
        return { start: -1, length: 0 }
    }
    // flea-qml: a query with a glob character is a shell glob over the whole name, so `*.js` is the
    // names ending in .js; the run is then the whole name. Plain text stays a substring, as upstream.
    var glob = globPattern(n)
    if (glob !== null)
        return glob.test(h) ? { start: 0, length: h.length } : { start: -1, length: 0 }
    var at = h.toLowerCase().indexOf(n.toLowerCase())
    return at < 0 ? { start: -1, length: 0 } : { start: at, length: n.length }
}

// flea-qml: `*` any run, `?` one character, `[abc]` `[a-z]` `[!a]` `[^a]` a class, `{js,ts}` one of
// the words, and `\` takes the next character literally; letter case is ignored, as the plain
// filter ignores it. A `[` or `{` with no close is that character itself. Null for a query with no
// glob character. Sample input: "*.{js,ts}" matches "app.js" and "types.ts", not "app.json".
var globCache = { source: null, regex: null }
function globPattern(query) {
    if (!/[*?[{]/.test(query))
        return null
    if (globCache.source === query)
        return globCache.regex
    var out = "", depth = 0
    for (var i = 0; i < query.length; i++) {
        var c = query.charAt(i)
        if (c === "\\" && i + 1 < query.length) {
            out += escapeRegex(query.charAt(++i))
        } else if (c === "*") {
            out += ".*"
        } else if (c === "?") {
            out += "."
        } else if (c === "[") {
            var close = query.indexOf("]", i + 2)
            if (close < 0) { out += "\\["; continue }
            var body = query.substring(i + 1, close)
            var negate = body.charAt(0) === "!" || body.charAt(0) === "^"
            if (negate) body = body.substring(1)
            out += "[" + (negate ? "^" : "") + body.replace(/[\\\]]/g, "\\$&") + "]"
            i = close
        } else if (c === "{" && query.indexOf("}", i) > i) {
            out += "(?:"
            depth++
        } else if (c === "," && depth > 0) {
            out += "|"
        } else if (c === "}" && depth > 0) {
            out += ")"
            depth--
        } else {
            out += escapeRegex(c)
        }
    }
    var regex = null
    try {
        regex = new RegExp("^" + out + "$", "i")
    } catch (e) {
        // A pattern the engine refuses matches nothing rather than everything.
        regex = /(?!)/
    }
    globCache = { source: query, regex: regex }
    return regex
}

function escapeRegex(c) {
    return /[.*+?^${}()|[\]\\\/]/.test(c) ? "\\" + c : c
}
