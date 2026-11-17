.pragma library

// README is the only help source. Ignore headings inside fenced code blocks.
function extract(text) {
    var lines = String(text).replace(/\r\n/g, "\n").split("\n")
    var start = -1, end = lines.length, fence = "", fenceLength = 0
    for (var i = 0; i < lines.length; i++) {
        var marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
        if (marker) {
            if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length }
            else if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) fence = ""
            continue
        }
        if (fence) continue
        var heading = /^##\s+(.+?)\s*#*\s*$/.exec(lines[i])
        if (!heading) continue
        var usage = heading[1] === "How to use" || heading[1] === "使用方法"
        if (start < 0) { if (usage) start = i }
        else if (!usage) { end = i; break }
    }
    if (start < 0) throw new Error("README has no How to use / 使用方法 section")
    return lines.slice(start, end).join("\n").trim() + "\n"
}
