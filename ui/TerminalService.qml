pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Io

// All terminal views share this one server; each has its own reconnect token/PTY.
QtObject {
    id: root
    property var tabs: ({})
    property int serial: 0
    property bool ready: false
    property bool stopping: false
    function acquire(path) {
        var id = "terminal-" + (++serial)
        var next = Object.assign({}, tabs)
        next[id] = { path: path, url: "", error: "" }
        tabs = next
        if (!server.running && !stopping) server.running = true
        if (ready) server.write(JSON.stringify({id:id,path:path}) + "\n")
        return id
    }
    function release(id) {
        var next = Object.assign({}, tabs)
        delete next[id]
        tabs = next
        if (Object.keys(next).length === 0) {
            ready = false
            if (server.running && !stopping) {
                stopping = true
                server.write(JSON.stringify({shutdown:true}) + "\n")
            }
        } else if (ready) server.write(JSON.stringify({id:id,close:true}) + "\n")
    }
    function fail(message) {
        ready = false
        var next = {}
        for (var id in tabs) next[id] = { path: tabs[id].path, url: "", error: message }
        tabs = next
    }
    property var process: Process {
        id: server
        stdinEnabled: true
        command: [Quickshell.env("BUNINU_BUN") || "bun", Quickshell.shellDir + "/../../src/terminal-server.js"]
        stdout: SplitParser {
            onRead: function(line) {
                try {
                    var result = JSON.parse(line)
                    if (result.ready) {
                        if (root.stopping) return
                        root.ready = true
                        for (var id in root.tabs) if (!root.tabs[id].error) server.write(JSON.stringify({id:id,path:root.tabs[id].path}) + "\n")
                    } else if (result.id && root.tabs[result.id]) {
                        var next = Object.assign({}, root.tabs)
                        next[result.id] = { path: next[result.id].path, url: result.url || "", error: result.error || "" }
                        root.tabs = next
                    } else if (!result.id && result.error) root.fail(result.error)
                } catch(e) { root.fail("Invalid terminal server response.") }
            }
        }
        onExited: {
            if (root.stopping) {
                root.stopping = false
                root.ready = false
                // A tab opened during shutdown waits for the old listener to exit.
                if (Object.keys(root.tabs).length) Qt.callLater(function() { server.running = true })
            } else root.fail("Terminal server exited.")
        }
    }
}
