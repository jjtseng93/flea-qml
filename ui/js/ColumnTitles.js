.pragma library

// The titles a columns-view column carries, from whole to barest. Each step is chosen by the width the
// column has: Han and English, Han alone, one letter of each ("名N", "大S"), and last the Name title
// with the ⚖️ only, the Size title given up. A Size title that is given up takes its sort mark with it.
var TIERS = [
    { name: "名稱 Name", size: "大小 Size" },
    { name: "名稱", size: "大小" },
    { name: "名N", size: "大S" },
    { name: "名N", size: "" }
]

// The first tier whose need fits the room, the last when none does (its Name then elides).
// needs[i] is the width tier i takes in whatever unit room is in. Sample: pick([300, 200, 100, 60], 150) is 2.
function pick(needs, room) {
    for (var i = 0; i < needs.length; i++)
        if (needs[i] <= room) return i
    return needs.length - 1
}
