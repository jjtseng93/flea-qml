pragma Singleton

import QtQuick

// The block view's diagrams, drawn by the backend (src/figure.js, Pele in a Bun Worker) through a
// window's Backend, which WindowBody adopts and releases. Answers come by ticket through `done`,
// and recent ones are held here, so a revisit or a theme flip back asks nothing.
QtObject {
    id: root

    signal done(int ticket, string svg, string error)

    // Every open window's Backend, adopted as each window is built and released as it closes; the
    // first still open draws. With none every ask fails, and the figure shows its source.
    property var backends: []
    readonly property var backend: root.backends.length > 0 ? root.backends[0] : null
    function adopt(backend) {
        if (backend && root.backends.indexOf(backend) < 0)
            root.backends = root.backends.concat([backend]);
    }
    function release(backend) {
        var at = root.backends.indexOf(backend);
        if (at < 0)
            return;
        root.backends = root.backends.filter(function (other) { return other !== backend; });
        if (at !== 0)
            return;
        // The drawing backend went with its window: what it still owed fails, and a new ask goes to the next one.
        var owed = Object.keys(root.waiting);
        root.waiting = ({});
        root.byRequest = ({});
        for (var i = 0; i < owed.length; i++)
            root.done(Number(owed[i]), "", "backend closed");
    }
    readonly property int cacheMax: 64
    property int seq: 0
    // ticket -> cache key, and backend request id -> ticket, for the answer that names only its id.
    property var waiting: ({})
    property var byRequest: ({})
    property var answerCache: ({})
    property var answerOrder: []

    // FNV-1a over the table's comma-joined text, "0" for none.
    function tableDigestOf(table) {
        if (!table || table.length === 0)
            return "0";
        var fnvOffset = 0x811c9dc5;
        var fnvPrime = 0x01000193;
        var hexRadix = 16;
        var text = table.join(",");
        var hash = fnvOffset;
        for (var i = 0; i < text.length; i++)
            hash = Math.imul(hash ^ text.charCodeAt(i), fnvPrime);
        return (hash >>> 0).toString(hexRadix);
    }

    // The cache key: everything the drawing depends on; a dated figure's day joins it, so the next day's ask draws that day's chart.
    function cacheKeyOf(kind, source, t, display) {
        var key = [t.bg, t.fg, t.accent || "", t.muted || "", t.surface || "", t.font || "", t.bodyPx || 0,
            root.tableDigestOf(t.advances), root.tableDigestOf(t.boldAdvances)].join("|");
        return kind + "\n" + key + (t.today ? "|" + t.today : "") + "\n" + !!display + "\n" + source;
    }

    function cached(kind, source, theme, display) {
        var key = root.cacheKeyOf(kind, source, theme, display);
        var hit = root.answerCache[key];
        if (hit !== undefined) {
            var at = root.answerOrder.indexOf(key);
            if (at >= 0)
                root.answerOrder.splice(at, 1);
            root.answerOrder.push(key);
        }
        return hit;
    }

    function store(key, svg) {
        var at = root.answerOrder.indexOf(key);
        if (at >= 0)
            root.answerOrder.splice(at, 1);
        root.answerCache[key] = svg;
        root.answerOrder.push(key);
        while (root.answerOrder.length > root.cacheMax)
            delete root.answerCache[root.answerOrder.shift()];
    }

    // A ticket for one figure; its answer comes later through done(ticket, svg, error), never during this call.
    function ask(kind, source, display, theme) {
        root.seq++;
        var ticket = root.seq;
        var hit = root.cached(kind, source, theme, display);
        if (hit !== undefined) {
            Qt.callLater(function () { root.done(ticket, hit, ""); });
            return ticket;
        }
        if (kind !== "mermaid" || root.backend === null || typeof root.backend.askFigure !== "function") {
            Qt.callLater(function () { root.done(ticket, "", kind !== "mermaid" ? "unknown figure kind" : "no backend"); });
            return ticket;
        }
        var id = root.backend.askFigure(source, theme);
        root.waiting[ticket] = root.cacheKeyOf(kind, source, theme, display);
        root.byRequest[id] = ticket;
        return ticket;
    }

    property Connections answers: Connections {
        target: root.backend
        ignoreUnknownSignals: true
        function onFigureResult(message) {
            var ticket = root.byRequest[message.id];
            if (ticket === undefined)
                return;
            delete root.byRequest[message.id];
            var key = root.waiting[ticket];
            delete root.waiting[ticket];
            if (message.svg)
                root.store(key, message.svg);
            root.done(ticket, message.svg || "", message.svg ? "" : (message.error || "render failed"));
        }
    }
}
