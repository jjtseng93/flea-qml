.pragma library

// About describes this installed package, never an unrelated executable on PATH.
function label(value) { return typeof value === "string" ? value : "" }
function webUrl(value) {
    var url = label(value)
    return /^https?:\/\//i.test(url) ? url : ""
}
function packageFacts(text) {
    var pkg = JSON.parse(text)
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("Invalid package.json")
    var repository = typeof pkg.repository === "string" ? pkg.repository : (pkg.repository || {}).url
    repository = label(repository).replace(/^git\+/, "").replace(/\.git$/, "")
    return {
        name: label(pkg.name), version: label(pkg.version), description: label(pkg.description),
        author: typeof pkg.author === "string" ? pkg.author : label((pkg.author || {}).name),
        license: label(pkg.license), homepage: webUrl(pkg.homepage), repository: webUrl(repository),
        issues: webUrl(typeof pkg.bugs === "string" ? pkg.bugs : (pkg.bugs || {}).url)
    }
}
function rows(state) {
    var facts = state.about || {}
    var out = [
        { kind: "hero", label: facts.name || "flea-qml", value: facts.description || "" },
        { kind: "fact", label: "Version", value: facts.version || "Not reported" },
        { kind: "fact", label: "Author", value: facts.author || "Not reported" },
        { kind: "fact", label: "License", value: facts.license || "Not reported" },
        { kind: "action", id: "keyboardSheet", label: "Help 使用方法", glyph: "keyboard", value: "?" }
    ]
    if (facts.error) out.push({ kind: "hint", label: facts.error })
    if (facts.homepage) out.push({ kind: "action", id: "homepage", label: "Homepage", value: "Open", url: facts.homepage })
    if (facts.repository) out.push({ kind: "action", id: "repository", label: "Source code", value: "Open", url: facts.repository })
    if (facts.issues) out.push({ kind: "action", id: "reportIssue", label: "Report an issue", value: "Open", url: facts.issues })
    return out
}
