.pragma library

.import "Mounts.js" as Mounts
.import "UserDirs.js" as UserDirs

// Sample input: XDG_DOWNLOAD_DIR="$HOME/Downloads"
function userDirs(body, home) {
    return UserDirs.userDirs(body, home)
}

// Sample input: file:///home/gm/Downloads Downloads
function bookmarks(body) {
    var out = []
    var lines = String(body || "").split("\n")
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim()
        // corner: a bookmark may be smb:// or sftp://, which is a Location and not a Favorite.
        if (line.indexOf("file://") !== 0)
            continue
        var space = line.indexOf(" ")
        var uri = space < 0 ? line : line.substring(0, space)
        var label = space < 0 ? "" : line.substring(space + 1).trim()
        var path = Mounts.decodePath(uri.substring("file://".length))
        out.push({ path: path, label: label.length > 0 ? label : leaf(path) })
    }
    return out
}

// The FAVORITES rail's rows, Home first and always, then XDG dirs and bookmarked places in file
// order, a path seen twice keeping its first position. glyphFor resolves each row's mark so the
// rail's Icons import stays the rail's own business; see ui/Sidebar.qml's rebuild.
function favorites(home, dirsText, marksText, glyphFor) {
    var favs = [{ path: home, label: "Home", group: "favorite", kind: "favorite", glyph: glyphFor("Home") }]
    var seen = {}
    seen[home] = true
    var groups = [userDirs(dirsText, home), bookmarks(marksText)]
    for (var g = 0; g < groups.length; g++) {
        for (var i = 0; i < groups[g].length; i++) {
            if (seen[groups[g][i].path])
                continue
            var e = groups[g][i]
            seen[e.path] = true
            favs.push({ path: e.path, label: e.label, group: "favorite", kind: "favorite", glyph: glyphFor(e.label) })
        }
    }
    return favs
}

function leaf(path) {
    var cut = path.lastIndexOf("/")
    return cut < 0 ? path : path.substring(cut + 1)
}

// Sample input: "smb://192.168.1.10/data NAS"; see AGENTS.md "Places.relabel" for the matching, duplicate and control-character rules.
function relabel(body, path, name) {
    // A trust boundary: an embedded newline could otherwise split one bookmark into two lines.
    var trimmed = String(name || "").replace(/[\r\n]/g, "").trim()
    if (trimmed.length === 0)
        return String(body || "")
    var target = Mounts.normalize(path)
    var lines = String(body || "").split("\n")
    var found = false
    for (var i = 0; i < lines.length; i++) {
        // Read off the trimmed line the way Mounts.removeBookmark reads it, or an indented bookmark
        // is one Remove can drop and this could only ever duplicate.
        var line = lines[i].trim()
        if (line.length === 0)
            continue
        var space = line.indexOf(" ")
        var uri = space < 0 ? line : line.substring(0, space)
        if (Mounts.normalize(uri) === target) {
            lines[i] = uri + " " + trimmed
            found = true
        }
    }
    if (found)
        return lines.join("\n")
    var out = String(body || "")
    if (out.length > 0 && out.charAt(out.length - 1) !== "\n")
        out += "\n"
    return out + target + " " + trimmed + "\n"
}

// Sample input: body as relabel's, oldUri the saved line being rewritten, newUri the address the
// form's Mounts-as line showed. Matched the way relabel matches, so a live mount's trailing slash
// still finds the saved line, and an empty oldUri matches nothing and appends instead. PR 21.
function replace(body, oldUri, newUri, label) {
    var next = Mounts.normalize(newUri)
    if (next.length === 0)
        return String(body || "")
    // The same trust boundary relabel names: an embedded newline would split one bookmark into two.
    var name = String(label || "").replace(/[\r\n]/g, "").trim()
    if (name.length === 0)
        name = leaf(next)
    var target = Mounts.normalize(oldUri)
    var lines = String(body || "").split("\n")
    var found = false
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim()
        if (line.length === 0)
            continue
        var space = line.indexOf(" ")
        var uri = space < 0 ? line : line.substring(0, space)
        if (target.length > 0 && Mounts.normalize(uri) === target) {
            lines[i] = next + " " + name
            found = true
        }
    }
    if (found)
        return lines.join("\n")
    var out = String(body || "")
    if (out.length > 0 && out.charAt(out.length - 1) !== "\n")
        out += "\n"
    return out + next + " " + name + "\n"
}

var WIDTH_STOPS = [160, 192, 224, 256]
function sidebarWidth(value) {
    if (typeof value !== "number" || !isFinite(value)) return 160
    var nearest = WIDTH_STOPS[0]
    for (var i = 1; i < WIDTH_STOPS.length; i++) {
        if (Math.abs(WIDTH_STOPS[i] - value) < Math.abs(nearest - value)) nearest = WIDTH_STOPS[i]
    }
    return nearest
}

function recordError(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return "invalid favorite record"
    if (typeof record.label !== "string" || record.label.trim().length === 0) return "label needs visible text"
    if (typeof record.path !== "string" || /[\u0000-\u001f\u007f]/.test(record.path)) return "invalid path"
    if (record.path.charAt(0) === "/" || record.path === "~" || record.path.indexOf("~/") === 0) return ""
    var schemes = ["smb://", "sftp://", "ftp://", "dav://", "davs://", "afp://", "nfs://", "file://"]
    for (var i = 0; i < schemes.length; i++) {
        if (record.path.indexOf(schemes[i]) === 0 && record.path.length > schemes[i].length) return ""
    }
    return "use a full path, a path that starts with ~/, or a network address"
}

function storedEntries(records, home) {
    var out = []
    for (var i = 0; Array.isArray(records) && i < records.length; i++) {
        var record = records[i]
        var error = recordError(record)
        var label = record && typeof record.label === "string" ? record.label : JSON.stringify(record)
        var path = record && typeof record.path === "string" ? record.path : ""
        var resolved = path === "~" ? home : path.indexOf("~/") === 0 ? home + path.substring(1) : path
        out.push({ label: label || "Invalid favorite", path: resolved, storedPath: path,
            error: error, original: record, favouriteIndex: i, group: "favourite", kind: "favourite",
            glyph: path.indexOf("://") >= 0 ? "network" : "folder" })
    }
    return out
}

// flea-qml: Home, then the folders the backend found by looking (src/places.js), each
// { path, label, glyph }. Upstream drew the folders user-dirs.dirs names, there or not; here a
// row is a folder that answered, and until the backend's first line the list is Home alone.
function homeEntries(home, probed, glyphFor) {
    var entries = [{ label: "Home", path: home, group: "home", kind: "home", glyph: glyphFor("Home") }]
    var rows = Array.isArray(probed) ? probed : []
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        if (!row || typeof row.path !== "string" || row.path.length === 0 || row.path === home)
            continue
        entries.push({ label: String(row.label || row.path), path: row.path, group: "home", kind: "home", glyph: String(row.glyph || "folder") })
    }
    return entries
}

// flea-qml: the drives the backend found by looking, drawn under DEVICES as plain folders: a row
// opens its path and offers a place's menu, and nothing here mounts or ejects. A drive lsblk
// already lists, by the mount point of one of `listed`'s rows, is that row and not a second one.
function volumeEntries(volumes, listed) {
    var out = []
    var rows = Array.isArray(volumes) ? volumes : []
    var held = {}
    for (var d = 0; Array.isArray(listed) && d < listed.length; d++) {
        if (listed[d] && typeof listed[d].path === "string" && listed[d].path.length > 0)
            held[listed[d].path] = true
    }
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        if (!row || typeof row.path !== "string" || row.path.length === 0 || held[row.path])
            continue
        out.push({ label: String(row.label || row.path), path: row.path, group: "home", kind: "home", volume: true,
            glyph: String(row.glyph || "drive"), size: typeof row.size === "number" ? row.size : null })
    }
    return out
}

// The rail and query use the same validation, URI decoding and mount-first open.
function openEntry(entry, ports) {
    if (!entry) return
    if (entry.kind === "trash") { ports.trash(); return }
    var error = entry.kind === "favourite" ? recordError(entry.original) : ""
    if (error) { ports.message("Could not open %1 · %2".replace(/%([12])/g, function (m, n) { return n === "1" ? entry.label : error }), true); return }
    if (entry.path.indexOf("://") >= 0 && entry.path.indexOf("file://") !== 0) {
        var host = ports.networkHost()
        if (host) host.openChildShare(entry.path, entry.label, ports.pane)
    } else {
        ports.opened(entry.path.indexOf("file://") === 0 ? Mounts.decodePath(entry.path.substring(7)) : entry.path)
    }
}

function railIdentity(entry) {
    if (!entry) return ""
    if (entry.kind === "favourite") return JSON.stringify([entry.kind, entry.original])
    return JSON.stringify([entry.group, entry.kind, Mounts.railKey(entry) || entry.device || entry.uri || entry.path])
}

// Duplicate originals have no stored ID; a changed multiplicity cannot safely identify the selected occurrence.
function railCursorAfter(before, after, index) {
    if (before.length === 0 && index === 0) return 0
    if (index < 0 || index >= before.length) return -1
    var key = railIdentity(before[index]), oldCount = 0, occurrence = 0, matches = []
    for (var i = 0; i < before.length; i++) {
        if (railIdentity(before[i]) !== key) continue
        oldCount++
        if (i < index) occurrence++
    }
    for (var j = 0; j < after.length; j++) {
        if (railIdentity(after[j]) === key) matches.push(j)
    }
    return matches.length === oldCount ? matches[occurrence] : -1
}

// Under gvfs only the mounted row opened under view.shareKey lights, never a folder prefix or the disk.
function heldBy(entries, dir, view) {
    var list = entries || []
    var at = view || ({ kind: "dir" })
    var path = String(dir || "")
    var gvfs = Mounts.underGvfs(path)
    var best = -1, depth = -1
    for (var i = 0; i < list.length; i++) {
        var e = list[i]
        if (at.kind !== "dir") {
            if (e.kind === at.kind && (at.kind !== "tag" || e.tag === at.tag))
                return i
            continue
        }
        if (e.kind === "recent" || e.kind === "trash" || e.kind === "tag" || e.error || e.mounted === false)
            continue
        if (gvfs) {
            var key = String(at.shareKey || "")
            if (key.length > 0 && !e.path && (Mounts.normalize(e.uri) === key || Mounts.normalize(e.mountUri) === key))
                return i
            continue
        }
        if (typeof e.path !== "string" || e.path.length === 0)
            continue
        if ((e.path === "/" ? path.charAt(0) === "/" : Mounts.inside(path, e.path)) && e.path.length > depth) {
            best = i
            depth = e.path.length
        }
    }
    return best
}

// pathAlias is the pane's remembered gvfs share (or null); its key is the share's normalized address.
function litView(trashOpened, recentMode, searchMode, answeredQuery, pathAlias) {
    if (trashOpened || recentMode === "trash") return { kind: "trash" }
    if (String(recentMode || "").length > 0) return { kind: "recent" }
    var query = String(answeredQuery || "")
    if (String(searchMode || "").length > 0 && query.indexOf("tag:") === 0) return { kind: "tag", tag: query.substring(4) }
    return { kind: "dir", shareKey: pathAlias ? String(pathAlias.key || "") : "" }
}
