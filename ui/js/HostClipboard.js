.pragma library

// All panes share this queue. Clipboard payloads are opaque POSIX-quoted text,
// including the pair of empty double quotes at each end of a cut, on every OS.
var queue = Promise.resolve()
function handle(root, qs, message) {
    function read() {
        return qs.readClipboardText ? qs.readClipboardText({ strict: true }) : qs.clipboardText
    }
    function write(text) {
        if (qs.writeClipboardText) return qs.writeClipboardText(text)
        qs.clipboardText = text
    }
    queue = queue.then(function() {
        if (message.op === "read") return Promise.resolve(read()).then(function(text) { return { text: text } })
        if (typeof message.text !== "string") throw new Error("Invalid clipboard text")
        if (message.op === "write") return Promise.resolve(write(message.text)).then(function() { return {} })
        if (message.op === "clear") return Promise.resolve(read()).then(function(text) {
            if (text !== message.text) return { cleared: false }
            return Promise.resolve(write("")).then(function() { return { cleared: true } })
        })
        throw new Error("Unknown clipboard operation")
    }).then(function(answer) {
        root.send(Object.assign({ c: "clipHostReply", id: message.id, ok: true }, answer))
    }, function(error) {
        root.send({ c: "clipHostReply", id: message.id, ok: false, error: String(error.message || error) })
    }).catch(function(error) { console.warn("Clipboard reply failed: " + error) })
    return queue
}
