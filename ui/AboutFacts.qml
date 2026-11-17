import QtQuick
import Quickshell
import Quickshell.Io
import "js/SettingsAbout.js" as About

// Read the installed package only while About is shown. No subprocess or watcher.
QtObject {
    id: root
    property bool active: false
    property var facts: ({})
    readonly property string packagePath: String(Quickshell.shellDir).replace(/[\\/]+$/, "") + "/../../package.json"
    onActiveChanged: {
        if (!root.active) return
        if (packageFile.path === root.packagePath) packageFile.reload()
        else packageFile.path = root.packagePath
    }
    property var metadata: FileView {
        id: packageFile
        printErrors: false
        onLoaded: {
            try { root.facts = About.packageFacts(text()) }
            catch (error) { root.facts = { error: "Could not parse package.json" } }
        }
        onLoadFailed: root.facts = { error: "Could not read package.json" }
    }
}
