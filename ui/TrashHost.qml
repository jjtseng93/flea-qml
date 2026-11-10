import QtQuick
import "." as Flea
import "js/Focus.js" as Focus
import "js/Menu.js" as Menu
import "js/Ops.js" as Ops
import "js/RecentMode.js" as RecentMode
import "js/TrashDates.js" as TrashDates

// Only Trash-specific operations live here. Pane owns the visible listing,
// keyboard, filtering, thumbnails and Quick Look, just as for any other location.
Item {
    id: root
    required property var pane
    property Item overlayParent: null
    readonly property bool browsing: pane.recentMode === "trash"
    // Compatibility with callers checking for the old full-pane overlay.
    readonly property bool opened: false
    readonly property bool confirming: (confirmation !== null && confirmation.opened) || pendingReview !== null || pendingOp === "prepare"
    readonly property var item: root
    readonly property var sheetPane: pane
    readonly property int total: browsing ? pane.total : 0
    readonly property int selectedCount: browsing ? pane.selectionCount() : 0
    readonly property bool active: browsing
    property int requestId: 1000000
    property string pendingOp: ""
    property bool pendingAll: false
    property int pendingToken: 0
    property var pendingReview: null
    property var pendingRows: []
    property int pendingListing: 0
    readonly property bool busy: pendingOp.length > 0
    readonly property var confirmationItem: confirmation
    readonly property bool confirmationOpen: confirmation !== null && confirmation.opened
    // The 30 day sweep, decided 2026-09-11. It runs the same three requests the window runs,
    // in the same order, so prepare still reviews every item against the identity the listing
    // reported and delete still refuses a token the trash has moved under. This host drives it
    // because the backend keeps ONE Trash session: two clients listing into it would take each
    // other's snapshot away, so the window and the sweep are never in flight together.
    readonly property int sweepDays: 30
    // One window of the listing, which is also the most the backend will answer with. A Trash holding
    // more than this is swept over as many days as it takes, which is slower and never wrong.
    readonly property int sweepWindow: 350
    property int sweepId: 0
    property string sweepStage: ""
    property var sweepDoomed: []
    readonly property bool sweeping: root.sweepStage.length > 0

    function sweep() {
        if (root.sweeping || root.browsing || !ViewState.trashAutoEmpty)
            return
        if (TrashDates.dayNumber(Date.now()) === ViewState.trashSweptOn)
            return
        root.sweepSend("list", {start: 0, count: root.sweepWindow, recover: false})
    }

    function sweepSend(op, fields) {
        var message = fields || {}
        message.c = "trashbrowse"
        message.op = op
        message.id = ++root.sweepId
        root.sweepStage = op
        root.pane.backend.send(message)
    }

    // The operator reaching for Trash outranks a sweep nobody asked to watch. Cancelling drops the
    // prepared confirmation in the backend, so the window's own list starts from a clean session.
    function sweepStop() {
        if (!root.sweeping)
            return
        root.sweepStage = ""
        root.sweepDoomed = []
        root.pane.backend.send({c: "trashbrowse", op: "cancel", id: ++root.sweepId, clearSelection: true})
    }

    // Every reply while a sweep is in flight is the sweep's, because the window cannot be open then.
    // A failure at any stage ends the sweep and records nothing, so the next launch tries again.
    function sweepReceive(message) {
        if (message.ok !== true) { root.sweepStage = ""; root.sweepDoomed = []; return }
        if (message.op === "list") {
            var rows = message.rows || []
            var now = Date.now()
            var doomed = []
            for (var i = 0; i < rows.length; i++) {
                if (TrashDates.expired(rows[i].deleted, now, root.sweepDays))
                    doomed.push(rows[i])
            }
            if (doomed.length === 0) { root.sweepFinished(); return }
            root.sweepDoomed = doomed
            root.sweepSend("prepare", {all: false, emptyTrash: false,
                uris: doomed.map(function (row) { return row.uri }),
                identities: doomed.map(function (row) { return row.identity })})
            return
        }
        if (message.op === "prepare") {
            // A prepare that reviewed nothing has nothing to delete, and asking anyway would spend a
            // token on an empty confirmation.
            if (!message.count) { root.sweepFinished(); return }
            root.sweepSend("delete", {token: message.token})
            return
        }
        if (message.op === "delete") {
            // The rail is hidden, so its TrashMonitor is unloaded with it: nothing to refresh.
            if (root.pane.sidebar) root.pane.sidebar.refreshTrash()
            root.sweepFinished()
        }
    }

    function sweepFinished() {
        root.sweepStage = ""
        root.sweepDoomed = []
        ViewState.recordTrashSweep(TrashDates.dayNumber(Date.now()))
    }


    function open(action) {
        if (confirming || busy) return
        sweepStop()
        if (!browsing) {
            if (pane.preview) pane.preview.close()
            pane.shareBrowser.close()
            pane.clearSelection()
            pane.focusView = Focus.LIST
            RecentMode.run(pane, [], {}, "trash")
        }
        if (action === "emptyTrash" || action === "restoreAll") root.action(action)
        else pane.listArea.forceActiveFocus()
    }
    // Navigation already owns the next listing; do not issue a second list here.
    function close() { if (browsing && !confirming) RecentMode.leave(pane) }
    function send(op, fields) {
        pendingOp = op
        pane.backend.send(Object.assign({c:"trashbrowse",id:++requestId,op:op},fields || {}))
    }
    function action(name, menuId) {
        if (busy || confirming) return
        if (name === "openTrash") { open(); return }
        var all = name === "emptyTrash" || name === "restoreAll"
        if (!all && !browsing) return
        if (!all && pane.listInFlight) { pane.message("A directory is already loading.", false); return }
        pendingAll = all
        pendingRows = all ? [] : Ops.targetIndices(pane)
        pendingListing = pane.backend.heldListing
        if (!all && !menuId && pendingRows.length === 0) return
        var fields = all ? {all:true,emptyTrash:name === "emptyTrash"}
                         : {all:false,rows:pendingRows,listing:pendingListing}
        if (menuId && !all) fields.menuId = menuId
        send(name === "restoreAll" || name === "restoreTrashSelection" ? "restore" : "prepare", fields)
    }
    function refresh() { if (browsing && !pane.listInFlight) RecentMode.refresh(pane, "") }
    function menuEntries(selection, hidden) {
        return selection ? Menu.applyHidden([
            {label:"Restore",action:"restoreTrashSelection",glyph:"undo",disabled:busy},
            {separator:true},
            {label:"Delete permanently",action:"deletePermanently",glyph:"trash",danger:true,disabled:busy}
        ],hidden) : Menu.trashEntries(total,busy)
    }
    function sheetFocus() { pane.listArea.forceActiveFocus() }
    function sheetActionRows(rows) { return rows }
    function sheetMenuModel() { return menuEntries(true,[]).concat(menuEntries(false,[])) }
    function sheetMenuAction(name) { action(name) }
    function sheetAction(name) { Focus.dispatchAction(name,pane) }
    readonly property var confirmation: confirmationLoader.item
    Loader { id:confirmationLoader; active:false; source:"TrashConfirm.qml"; onLoaded:{item.parent=root.overlayParent || root;item.z=5;if(root.pendingReview){item.open(root.pendingReview);root.pendingReview=null}} }
    Connections {
        target:root.confirmation
        function onConfirmed(token) { root.send("delete",{token:token}) }
        function onCancelled() { root.send("cancel");root.pane.listArea.forceActiveFocus() }
    }
    Connections {
        target: root.pane.backend
        function onTrashResult(message) {
            if (root.sweeping) { root.sweepReceive(message); return }
            if (message.id !== root.requestId || message.op !== root.pendingOp) return
            root.pendingOp = ""
            if (!message.ok) {
                if (confirmation) confirmation.close()
                root.pane.message(message.error || "Trash operation failed",true)
                root.pane.listArea.forceActiveFocus()
                root.refresh()
                return
            }
            if (message.op === "prepare") { root.pendingToken=message.token; if(confirmation)confirmation.open(message);else{root.pendingReview=message;confirmationLoader.active=true;} return }
            if (message.op === "check" && !message.valid) { if (confirmation) confirmation.close(); root.pane.message("The Trash changed; review it again.",true) }
            if (message.op === "restore" || message.op === "delete") {
                root.pane.operationResult((message.op === "restore" ? "Restored " : "Deleted ")+message.done+" items",
                    (message.failures || []).map(function(f){return f.error}).join("\n"),message.failed > 0)
                if(root.pane.sidebar)root.pane.sidebar.refreshTrash()
                root.refresh()
            }
            if (message.op !== "check") root.pane.listArea.forceActiveFocus()
        }
    }
    Timer { interval:2500; repeat:true; running:root.confirmationOpen && !root.busy; onTriggered:root.send("check",{token:root.pendingToken}) }
    Connections {
        target: root.pane.sidebar
        function onTrashChanged() { if(root.browsing && !root.busy && !root.confirming)root.refresh() }
    }
    Connections {
        target: root.pane.contextMenu()
        function onRailChosen(action,key) { if(key === "trash")root.action(action) }
    }
}
