// Fixed Swift sources of the iOS renderer. They interpret Resources/ui_spec.json at run time,
// so the generated code never changes shape with the spec (only the JSON resource does).
// Swift interpolation is written \(x); nothing here uses ${...}, so these stay plain TS strings.

export const SPEC_SWIFT = String.raw`import Foundation

typealias JSON = [String: Any]

// Thin typed view over ui_spec.json (the single source of truth).
struct Field {
    let name: String, widget: String, required: Bool, auto: Bool, labels: [String: String], values: [String], scale: Int
    init(_ j: JSON) {
        name = j["name"] as? String ?? ""
        widget = j["widget"] as? String ?? "text"
        required = j["required"] as? Bool ?? false
        auto = j["auto"] as? Bool ?? false
        labels = j["labels"] as? [String: String] ?? [:]
        values = j["values"] as? [String] ?? []
        scale = j["scale"] as? Int ?? 2
    }
    func label(_ locale: String) -> String { labels[locale] ?? labels["en"] ?? name }
}

struct Source: Identifiable {
    let raw: JSON
    var id: String { raw["id"] as? String ?? "" }
    var entity: String { raw["entity"] as? String ?? "" }
    var display: String? { raw["display"] as? String }
    var searchFields: [String] { raw["search_fields"] as? [String] ?? [] }
    var fields: [Field] { (raw["fields"] as? [JSON] ?? []).map(Field.init) }
    func field(_ name: String) -> Field? { fields.first { $0.name == name } }
    func path(_ op: String) -> String { ((raw["api"] as? JSON)?[op] as? JSON)?["path"] as? String ?? "" }
    func title(_ locale: String, plural: Bool) -> String {
        let l = raw["labels"] as? [String: JSON] ?? [:]
        let o = l[locale] ?? l["en"] ?? [:]
        return o[plural ? "plural" : "singular"] as? String ?? id
    }
}

struct Page {
    let raw: JSON
    var type: String { raw["type"] as? String ?? "" }
    var mode: String? { raw["mode"] as? String }
    var source: String { raw["data_source"] as? String ?? "" }
    var permission: String { raw["permission"] as? String ?? "" }
    var columns: [String] { raw["columns"] as? [String] ?? [] }
    var fields: [String] { raw["fields"] as? [String] ?? [] }
    var pageSize: Int { (raw["pagination"] as? JSON)?["size"] as? Int ?? 20 }
    func label(_ locale: String) -> String { let l = raw["labels"] as? [String: String] ?? [:]; return l[locale] ?? l["en"] ?? "" }
}

struct Spec {
    let locales: [String], defaultLocale: String, primaryColor: String
    let sources: [Source], pages: [Page], navigation: [String]

    init?(data: Data) {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? JSON else { return nil }
        locales = root["locales"] as? [String] ?? ["en"]
        defaultLocale = root["default_locale"] as? String ?? "en"
        primaryColor = (root["theme"] as? JSON)?["primary_color"] as? String ?? "#1E3A8A"
        sources = (root["data_sources"] as? [JSON] ?? []).map { Source(raw: $0) }
        pages = (root["pages"] as? [JSON] ?? []).map { Page(raw: $0) }
        navigation = (root["navigation"] as? JSON)?["items"] as? [String] ?? []
    }
    func source(_ id: String) -> Source? { sources.first { $0.id == id } }
    func page(_ src: Source, _ type: String, mode: String? = nil) -> Page? {
        pages.first { $0.source == src.id && $0.type == type && (mode == nil || $0.mode == mode) }
    }
}
`;

export const DATA_SWIFT = String.raw`import Foundation

struct ListResult { let items: [JSON]; let total: Int }
struct IonError: Error, LocalizedError { let message: String; var errorDescription: String? { message } }

// Same interface for the REST backend (api-rest routes) and the in-memory demo.
protocol DataSource {
    func list(_ src: Source, q: String, page: Int, size: Int) async throws -> ListResult
    func get(_ src: Source, id: String) async throws -> JSON
    func create(_ src: Source, _ v: JSON) async throws -> JSON
    func update(_ src: Source, id: String, _ v: JSON) async throws -> JSON
    func archive(_ src: Source, id: String) async throws
}

struct RestData: DataSource {
    let base: String
    let token: String?

    private func call(_ method: String, _ path: String, body: JSON? = nil) async throws -> Data {
        var comps = URLComponents(string: base.hasSuffix("/") ? String(base.dropLast()) : base)
        let parts = path.split(separator: "?", maxSplits: 1).map(String.init)
        comps?.path = (comps?.path ?? "") + parts[0]
        if parts.count > 1 { comps?.percentEncodedQuery = parts[1] }
        guard let url = comps?.url else { throw IonError(message: "Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 15
        if let token = token { req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if !(200...299).contains(code) {
            let msg = ((try? JSONSerialization.jsonObject(with: data)) as? JSON)?["error"] as? String
            throw IonError(message: msg ?? "HTTP \(code)")
        }
        return data
    }
    private func object(_ d: Data) throws -> JSON { (try JSONSerialization.jsonObject(with: d)) as? JSON ?? [:] }
    private func fill(_ tpl: String, _ id: String) -> String {
        tpl.replacingOccurrences(of: ":id", with: id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)
    }
    func list(_ src: Source, q: String, page: Int, size: Int) async throws -> ListResult {
        var query = "page=\(page)&pageSize=\(size)"
        if !q.isEmpty { query += "&q=" + (q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "") }
        let o = try object(try await call("GET", src.path("list") + "?" + query))
        let items = o["items"] as? [JSON] ?? []
        return ListResult(items: items, total: o["total"] as? Int ?? items.count)
    }
    func get(_ src: Source, id: String) async throws -> JSON { try object(try await call("GET", fill(src.path("read"), id))) }
    func create(_ src: Source, _ v: JSON) async throws -> JSON { try object(try await call("POST", src.path("create"), body: v)) }
    func update(_ src: Source, id: String, _ v: JSON) async throws -> JSON { try object(try await call("PATCH", fill(src.path("update"), id), body: v)) }
    func archive(_ src: Source, id: String) async throws { _ = try await call("DELETE", fill(src.path("archive"), id)) }
}

actor MemoryStore {
    var rows: [String: [JSON]] = [:]
    var n = 0
    func live(_ src: Source) -> [JSON] { (rows[src.id] ?? []).filter { $0["archived_at"] == nil } }
    func find(_ src: Source, _ id: String) throws -> JSON {
        guard let r = live(src).first(where: { $0["id"] as? String == id }) else { throw IonError(message: "Not found") }
        return r
    }
    func insert(_ src: Source, _ v: JSON) -> JSON {
        n += 1
        var row = v
        row["id"] = "m\(n)"
        rows[src.id, default: []].append(row)
        return row
    }
    func patch(_ src: Source, _ id: String, _ v: JSON) throws -> JSON {
        guard var all = rows[src.id], let i = all.firstIndex(where: { $0["id"] as? String == id && $0["archived_at"] == nil }) else { throw IonError(message: "Not found") }
        for (k, x) in v { all[i][k] = x }
        rows[src.id] = all
        return all[i]
    }
    func remove(_ src: Source, _ id: String) throws {
        guard var all = rows[src.id], let i = all.firstIndex(where: { $0["id"] as? String == id && $0["archived_at"] == nil }) else { throw IonError(message: "Not found") }
        all[i]["archived_at"] = "archived"
        rows[src.id] = all
    }
}

struct MemoryData: DataSource {
    let store = MemoryStore()
    func list(_ src: Source, q: String, page: Int, size: Int) async throws -> ListResult {
        var items = await store.live(src)
        if !q.isEmpty { items = items.filter { r in src.searchFields.contains { "\(r[$0] ?? "")".localizedCaseInsensitiveContains(q) } } }
        return ListResult(items: Array(items.dropFirst((page - 1) * size).prefix(size)), total: items.count)
    }
    func get(_ src: Source, id: String) async throws -> JSON { try await store.find(src, id) }
    func create(_ src: Source, _ v: JSON) async throws -> JSON { await store.insert(src, v) }
    func update(_ src: Source, id: String, _ v: JSON) async throws -> JSON { try await store.patch(src, id, v) }
    func archive(_ src: Source, id: String) async throws { try await store.remove(src, id) }
}
`;

export const VIEWS_SWIFT = String.raw`import SwiftUI

func show(_ v: Any?) -> String {
    guard let v = v, !(v is NSNull) else { return "-" }
    let s = "\(v)".filter { !$0.isNewline && $0 != "\u{1B}" }
    return s.isEmpty ? "-" : s
}

// Typed value from the text a person typed; nil = invalid. Mirrors the web and terminal renderers.
// money: the stored value is whole minor units (12050 = 120.50); text <-> units uses string math, never a float.
func moneyShow(_ v: Any?, _ scale: Int) -> String {
    guard let v = v else { return "" }
    let n: Int
    if let i = v as? Int { n = i } else if let d = v as? Double, d == d.rounded() { n = Int(d) } else if let s = v as? String, let i = Int(s) { n = i } else { return "\(v)" }
    var s = String(abs(n))
    if scale > 0 {
        while s.count <= scale { s = "0" + s }
        let cut = s.index(s.endIndex, offsetBy: -scale)
        s = String(s[..<cut]) + "." + String(s[cut...])
    }
    return (n < 0 ? "-" : "") + s
}

func moneyParse(_ text: String, _ scale: Int) -> Int? {
    var body = Substring(text.trimmingCharacters(in: .whitespaces))
    var negative = false
    if body.hasPrefix("-") { negative = true; body = body.dropFirst() }
    let parts = body.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
    guard let whole = parts.first, !whole.isEmpty, whole.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
    var frac = parts.count > 1 ? String(parts[1]) : ""
    guard frac.count <= scale, frac.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
    frac += String(repeating: "0", count: scale - frac.count)
    guard let n = Int(String(whole) + frac), n <= 9007199254740991 else { return nil }
    return negative ? -n : n
}

func showField(_ f: Field?, _ v: Any?) -> String {
    if let f = f, f.widget == "money", let v = v, !(v is NSNull) { return moneyShow(v, f.scale) }
    return show(v)
}

func coerce(_ f: Field, _ text: String) -> Any? {
    switch f.widget {
    case "number": if let d = Double(text), d.isFinite { return d }; return nil
    case "integer": return Int(text)
    case "money": return moneyParse(text, f.scale)
    case "checkbox": return ["y", "yes", "true", "1"].contains(text.lowercased()) ? true : (["n", "no", "false", "0"].contains(text.lowercased()) ? false : nil)
    case "select": return f.values.contains(text) ? text : nil
    case "json": return try? JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])
    case "email": return text.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil ? text : nil
    case "url": return text.range(of: "^https?://\\S+$", options: .regularExpression) != nil ? text : nil
    default: return text
    }
}

struct IonRoot: View {
    let spec: Spec
    let data: DataSource
    let permissions: Set<String>
    let allowAll: Bool
    @State private var locale: String
    init(spec: Spec, data: DataSource, permissions: Set<String>, allowAll: Bool) {
        self.spec = spec; self.data = data; self.permissions = permissions; self.allowAll = allowAll
        _locale = State(initialValue: spec.defaultLocale)
    }
    func can(_ key: String) -> Bool { allowAll || permissions.contains(key) }

    var body: some View {
        NavigationStack {
            let items = spec.navigation.compactMap { spec.source($0) }.filter { can("entity:\($0.entity):list") }
            Group {
                if items.isEmpty { Text(locale == "ar" ? "لا توجد صلاحيات." : "No permissions granted.") }
                else {
                    List(items) { s in
                        NavigationLink(s.title(locale, plural: true)) { ListScreen(spec: spec, data: data, src: s, locale: locale, can: can) }
                    }
                }
            }
            .navigationTitle(locale == "ar" ? "القائمة" : "Menu")
            .toolbar {
                if spec.locales.count > 1 {
                    Button(locale == "ar" ? "English" : "عربي") { locale = locale == "ar" ? "en" : "ar" }
                }
            }
        }
        .environment(\.layoutDirection, locale == "ar" ? .rightToLeft : .leftToRight)
        .tint(Color(hex: spec.primaryColor))
    }
}

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }
}

struct ListScreen: View {
    let spec: Spec, data: DataSource, src: Source, locale: String, can: (String) -> Bool
    @State private var q = ""
    @State private var n = 1
    @State private var result = ListResult(items: [], total: 0)
    @State private var error: String?
    @State private var creating = false

    var body: some View {
        let page = spec.page(src, "list")
        let size = page?.pageSize ?? 20
        let pages = max(1, (result.total + size - 1) / size)
        VStack {
            TextField(locale == "ar" ? "بحث" : "Search", text: $q).textFieldStyle(.roundedBorder).padding(.horizontal)
            if let e = error { Text(e).foregroundColor(.red) }
            List(result.items.indices, id: \.self) { i in
                let row = result.items[i]
                let id = row["id"] as? String ?? ""
                NavigationLink {
                    DetailScreen(spec: spec, data: data, src: src, id: id, locale: locale, can: can)
                } label: {
                    VStack(alignment: .leading) {
                        Text(src.display.map { showField(src.field($0), row[$0]) } ?? id)
                        Text((page?.columns ?? []).filter { $0 != src.display }.prefix(2).map { showField(src.field($0), row[$0]) }.joined(separator: " | ")).font(.caption).foregroundColor(.secondary)
                    }
                }
            }
            HStack {
                Button("<") { n -= 1 }.disabled(n <= 1)
                Text("\(n) / \(pages)")
                Button(">") { n += 1 }.disabled(n >= pages)
            }.padding(.bottom)
        }
        .navigationTitle(src.title(locale, plural: true))
        .toolbar { if can("entity:\(src.entity):create") { Button(locale == "ar" ? "جديد" : "New") { creating = true } } }
        .sheet(isPresented: $creating, onDismiss: { Task { await load() } }) {
            NavigationStack { FormScreen(spec: spec, data: data, src: src, row: nil, locale: locale, can: can, done: { creating = false }) }
        }
        .task(id: "\(q)|\(n)") { await load() }
    }
    func load() async {
        let size = spec.page(src, "list")?.pageSize ?? 20
        do { result = try await data.list(src, q: q, page: n, size: size); error = nil } catch { self.error = error.localizedDescription }
    }
}

struct DetailScreen: View {
    let spec: Spec, data: DataSource, src: Source, id: String, locale: String, can: (String) -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var row: JSON?
    @State private var error: String?
    @State private var editing = false

    var body: some View {
        let page = spec.page(src, "detail")
        List {
            if let e = error { Text(e).foregroundColor(.red) }
            if let row = row {
                ForEach(page?.fields ?? [], id: \.self) { name in
                    if let f = src.field(name) { HStack { Text(f.label(locale)).foregroundColor(.secondary); Spacer(); Text(showField(f, row[name])) } }
                }
            }
        }
        .navigationTitle(page?.label(locale) ?? "")
        .toolbar {
            if can("entity:\(src.entity):update") { Button(locale == "ar" ? "تعديل" : "Edit") { editing = true } }
            if can("entity:\(src.entity):archive") {
                Button(locale == "ar" ? "أرشفة" : "Archive", role: .destructive) {
                    Task { do { try await data.archive(src, id: id); dismiss() } catch { self.error = error.localizedDescription } }
                }
            }
        }
        .sheet(isPresented: $editing, onDismiss: { Task { await load() } }) {
            NavigationStack { FormScreen(spec: spec, data: data, src: src, row: row, locale: locale, can: can, done: { editing = false }) }
        }
        .task { await load() }
    }
    func load() async { do { row = try await data.get(src, id: id) } catch { self.error = error.localizedDescription } }
}

struct FormScreen: View {
    let spec: Spec, data: DataSource, src: Source, row: JSON?, locale: String, can: (String) -> Bool, done: () -> Void
    @State private var texts: [String: String] = [:]
    @State private var error: String?

    var body: some View {
        let mode = row == nil ? "create" : "edit"
        let page = spec.page(src, "form", mode: mode)
        let fields = (page?.fields ?? []).compactMap { src.field($0) }.filter { !$0.auto }
        Group {
            if let page = page, can(page.permission) {
                Form {
                    ForEach(fields, id: \.name) { f in
                        let hint = f.widget == "select" ? " (" + f.values.joined(separator: "/") + ")" : (f.widget == "checkbox" ? " (y/n)" : "")
                        TextField(f.label(locale) + (f.required && mode == "create" ? " *" : "") + hint, text: Binding(get: { texts[f.name] ?? initial(f) }, set: { texts[f.name] = $0 }))
                    }
                    if let e = error { Text(e).foregroundColor(.red) }
                    Button(locale == "ar" ? "حفظ" : "Save") { Task { await save(fields, mode) } }
                }
            } else { Text(locale == "ar" ? "ليس لديك صلاحية." : "You do not have permission.") }
        }
        .navigationTitle(page?.label(locale) ?? "")
    }
    func initial(_ f: Field) -> String { row?[f.name].flatMap { $0 is NSNull ? nil : (f.widget == "money" ? moneyShow($0, f.scale) : "\($0)") } ?? "" }
    func save(_ fields: [Field], _ mode: String) async {
        var v: JSON = [:]
        for f in fields {
            let text = (texts[f.name] ?? initial(f)).trimmingCharacters(in: .whitespaces)
            if text.isEmpty {
                if mode == "create" && f.required { error = f.label(locale) + (locale == "ar" ? " مطلوب" : " is required"); return }
                continue
            }
            guard let c = coerce(f, text) else { error = f.label(locale) + (locale == "ar" ? " غير صالح" : " is not valid"); return }
            v[f.name] = c
        }
        do {
            if let row = row, let id = row["id"] as? String { _ = try await data.update(src, id: id, v) } else { _ = try await data.create(src, v) }
            done()
        } catch { self.error = error.localizedDescription }
    }
}
`;

export const APP_SWIFT = String.raw`import SwiftUI

// Configuration (Info.plist keys, set in project.yml): ION_API empty = in-memory demo with every permission.
// With a backend, ION_PERMISSIONS must come from your authentication layer; nothing is listed until it does.
@main
struct IonApp: App {
    private let spec: Spec
    private let data: DataSource
    private let permissions: Set<String>
    private let demo: Bool

    init() {
        let info = Bundle.main.infoDictionary ?? [:]
        let api = info["ION_API"] as? String ?? ""
        let token = info["ION_TOKEN"] as? String ?? ""
        let perms = info["ION_PERMISSIONS"] as? String ?? ""
        let url = Bundle.main.url(forResource: "ui_spec", withExtension: "json")!
        spec = Spec(data: try! Data(contentsOf: url))!
        demo = api.isEmpty
        data = demo ? MemoryData() : RestData(base: api, token: token.isEmpty ? nil : token)
        permissions = Set(perms.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
    }

    var body: some Scene {
        WindowGroup { IonRoot(spec: spec, data: data, permissions: permissions, allowAll: demo) }
    }
}
`;
