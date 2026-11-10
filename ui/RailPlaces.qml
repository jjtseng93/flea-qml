pragma Singleton
import QtQuick
import Quickshell
import "js/Icons.js" as Icons
import "js/Places.js" as Places

// Place data outlives the visible rail, so hiding it cannot remove query destinations.
QtObject {
    id: root
    readonly property var settings: ViewState.state.places || ({})
    // flea-qml: the folders and the drives the backend found by looking (src/places.js), null
    // until its first `places` line. Upstream read user-dirs.dirs here and drew what it named.
    property var probed: null
    property var probedVolumes: null
    property string probedText: ""
    // An answer that says the same again changes nothing, so no rail rebuilds its rows for it.
    function found(places, volumes) {
        var text = JSON.stringify([places, volumes])
        if (text === root.probedText) return
        root.probedText = text
        root.probed = places
        root.probedVolumes = volumes
    }
    readonly property var homeEntries: root.settings.showHome === false ? []
        : Places.homeEntries(Quickshell.env("HOME"), root.probed, Icons.sidebarGlyphFor)
    readonly property var favouriteEntries: Places.storedEntries(Favourites.records, Quickshell.env("HOME")).map(function (entry) {
        entry.error = entry.error || Favourites.statuses[entry.favouriteIndex] || ""
        return entry
    })
    readonly property var recentEntries: root.settings.showRecent === true
        ? [{ label: "Recent", path: "flea:recent", group: "recent", kind: "recent", glyph: "history" }] : []
    readonly property var trashEntries: root.settings.showTrash === false ? []
        : [{ label: "Trash", path: "trash:///", group: "trash", kind: "trash", glyph: "trash" }]
    function entries() {
        return root.homeEntries.slice(0, 1).concat(root.recentEntries,
            root.homeEntries.slice(1), root.trashEntries, root.favouriteEntries)
    }
}
