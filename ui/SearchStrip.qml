import QtQuick

// The query line the search puts in the header's slot: the mark, the query with its caret, the
// scope, the count beside it, and the way out at the right edge. Presentation only; ui/Pane.qml
// owns every value it draws.
Item {
    id: root

    property string query: ""
    property string scope: ""
    // A live count while the walk runs, the terminal word once it stops, against the scope rather than at the right edge, because the number and the folder it counts are one fact.
    property string note: ""
    // The right edge, which is what esc does from here.
    property string wayOut: ""
    property bool typing: false
    // flea-qml: the command the query line stands for while it is empty, "find . -iname" or
    // "find ~ -iname", and the scope Tab moves to; ✕ at the right edge stops the find and leaves.
    property string placeholder: ""
    property string tabHint: ""
    // flea-qml: true while a find runs; the activity mark stands left of the Tab hint until it ends.
    property bool running: false
    signal closeRequested()
    // flea-qml: the field's text after each edit, and a key the field hands back to the pane.
    signal edited(string text)
    signal fieldEntered()
    signal keyOut(var event)

    readonly property real ruleOpacity: 0.12
    // Twice the hairline, the same weight the cursor row's mark uses, so one caret rule serves both.
    readonly property int caretWidth: Theme.spacing.hairline * 2

    implicitHeight: Theme.chromeHeight

    Rectangle {
        anchors.fill: parent
        color: Glass.surface
    }

    Rectangle {
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        height: Theme.spacing.hairline
        color: Theme.color.foreground
        opacity: root.ruleOpacity
    }

    Glyph {
        id: mark
        anchors.left: parent.left
        anchors.leftMargin: Theme.spacing.rowPaddingX
        anchors.verticalCenter: parent.verticalCenter
        // The chrome mark token, the size of the search button this strip replaces.
        width: Theme.chromeMarkSize
        height: Theme.chromeMarkSize
        name: "search"
        color: Theme.color.accent
    }

    // flea-qml: a real text field, so the caret moves, blinks and selects, and copy and paste work as
    // in any input; the keys that are not editing (Enter, Esc, Tab, the arrows up and down, paging)
    // go out through keyOut to the pane's own key route, so committing, stopping, rescoping and
    // stepping into the results behave as before. The pane owns the query: an edit reports it, and a
    // query set from outside (a tag place, a rescope) is written back here.
    TextInput {
        id: field
        objectName: "findInput"
        anchors.left: mark.right
        anchors.leftMargin: Theme.spacing.gap
        anchors.verticalCenter: parent.verticalCenter
        width: Math.min(Math.max(placeholderText.implicitWidth, contentWidth) + root.caretWidth * 2,
                        Math.max(0, root.width / 2))
        clip: true
        text: root.query
        color: Theme.color.foreground
        selectionColor: Theme.color.accent
        selectedTextColor: Theme.color.background
        font.family: Theme.font.family
        font.pixelSize: Theme.font.body
        selectByMouse: true
        onTextEdited: root.edited(text)
        // A click into the field takes Find back to typing.
        onActiveFocusChanged: if (activeFocus) root.fieldEntered()
        Keys.onPressed: function (event) {
            if (root.leavesField(event)) {
                root.keyOut(event)
                event.accepted = true
            }
        }
    }
    onQueryChanged: if (field.text !== root.query) field.text = root.query

    // The command the empty field stands for, under where the typing starts.
    Text {
        id: placeholderText
        anchors.left: field.left
        anchors.verticalCenter: parent.verticalCenter
        visible: field.text.length === 0
        text: root.placeholder
        color: Theme.color.muted
        font.family: Theme.font.family
        font.pixelSize: Theme.font.body
        textFormat: Text.PlainText
    }

    // Keys that act on the search rather than on its text.
    function leavesField(event) {
        // Ctrl+G turns the search between names and contents (ui/js/Search.js contents).
        if (event.key === Qt.Key_G && (event.modifiers & Qt.ControlModifier)) return true
        switch (event.key) {
        case Qt.Key_Return: case Qt.Key_Enter: case Qt.Key_Escape: case Qt.Key_Tab: case Qt.Key_Backtab:
        case Qt.Key_Up: case Qt.Key_Down: case Qt.Key_PageUp: case Qt.Key_PageDown:
            return true
        }
        return false
    }
    function focusField() { field.forceActiveFocus() }
    readonly property bool fieldFocused: field.activeFocus

    Text {
        id: scopeText
        anchors.left: field.right
        anchors.leftMargin: Theme.spacing.gap
        anchors.verticalCenter: parent.verticalCenter
        // The scope gives way before the count does: the number is the one that keeps changing.
        width: Math.min(implicitWidth, Math.max(0, (findingMark.visible ? findingMark.x : tabText.x) - x - noteText.width - 2 * Theme.spacing.gap))
        text: root.scope.length > 0 ? "in " + root.scope : ""
        color: Theme.color.muted
        font.family: Theme.font.family
        font.pixelSize: Theme.font.caption
        elide: Text.ElideLeft
        textFormat: Text.PlainText
    }

    Text {
        id: noteText
        anchors.left: scopeText.right
        anchors.leftMargin: Theme.spacing.gap
        anchors.verticalCenter: parent.verticalCenter
        text: root.note
        color: Theme.color.muted
        font.family: Theme.font.family
        font.pixelSize: Theme.font.caption
        textFormat: Text.PlainText
    }

    // flea-qml: the product's own activity mark, the one the status bar and loading pane draw.
    Spinner {
        id: findingMark
        anchors.right: tabText.left
        anchors.rightMargin: Theme.spacing.gap
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.chromeMarkSize
        height: Theme.chromeMarkSize
        visible: root.running
        color: Theme.color.accent
    }

    Text {
        id: tabText
        anchors.right: wayOutText.left
        anchors.rightMargin: root.tabHint.length > 0 ? 2 * Theme.spacing.gap : 0
        anchors.verticalCenter: parent.verticalCenter
        text: root.tabHint
        color: Theme.color.muted
        font.family: Theme.font.family
        font.pixelSize: Theme.font.caption
        textFormat: Text.PlainText
    }

    // flea-qml: the keys the strip answers, each one a button: a tap puts the caret back in the
    // query line, as a click into it does, and sends the same key the keyboard would there through
    // keyOut, so a click and a press in the field can never mean different things (Tab rescopes
    // rather than moving focus on from the results).
    readonly property var wayOutKeys: root.wayOut.length > 0 ? root.wayOut.split("/") : []
    function pressKey(name) {
        var keys = {
            "Enter": { key: Qt.Key_Return, modifiers: Qt.NoModifier },
            "Tab": { key: Qt.Key_Tab, modifiers: Qt.NoModifier },
            "Esc": { key: Qt.Key_Escape, modifiers: Qt.NoModifier },
            "Ctrl+G": { key: Qt.Key_G, modifiers: Qt.ControlModifier }
        }
        var pressed = keys[name]
        if (!pressed) return
        field.forceActiveFocus()
        // Said at once rather than left to the focus change, which may land after the key.
        root.fieldEntered()
        root.keyOut({ key: pressed.key, modifiers: pressed.modifiers, text: "", isAutoRepeat: false, accepted: false })
    }
    Row {
        id: wayOutText
        anchors.right: closeButton.left
        anchors.rightMargin: Theme.spacing.gap
        anchors.verticalCenter: parent.verticalCenter
        Repeater {
            model: root.wayOutKeys
            delegate: Row {
                required property string modelData
                required property int index
                Text {
                    visible: index > 0
                    text: "/"
                    color: Theme.color.muted
                    font.family: Theme.font.family
                    font.pixelSize: Theme.font.caption
                    textFormat: Text.PlainText
                }
                Text {
                    objectName: "findKey" + modelData
                    text: modelData
                    color: keyHover.hovered ? Theme.color.foreground : Theme.color.muted
                    font.family: Theme.font.family
                    font.pixelSize: Theme.font.caption
                    font.underline: keyHover.hovered
                    textFormat: Text.PlainText
                    HoverHandler { id: keyHover; cursorShape: Qt.PointingHandCursor }
                    TapHandler { onTapped: root.pressKey(modelData) }
                }
            }
        }
    }

    ChromeButton {
        id: closeButton
        anchors.right: parent.right
        anchors.rightMargin: Theme.spacing.rowPaddingX
        anchors.verticalCenter: parent.verticalCenter
        glyph: "x"
        accessName: "Close find"
        onActivated: root.closeRequested()
    }
}
