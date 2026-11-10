import Foundation
import Photos
import SwiftUI

/// 웹 버전(#FursuitFryday 웹앱)의 기록 파일을 가져온다.
///
/// 웹 버전의 기록은 구글 드라이브에 있는 `fursuitfryday.catalog.json` 한 파일이다. 그 파일을 그대로 고르면 된다.
/// 행사·사진사·퍼슈트·태그·일정·설정은 바로 들어온다. 사진 기록은 사정이 다르다 — 웹은 사진을 드라이브
/// 파일 ID 로 가리키고 이 앱은 사진첩의 사진을 가리키므로, **파일 이름**(안 되면 촬영 시각+해상도)으로
/// 사진첩의 사진과 짝을 맞춘다. 아직 사진첩에 없는 사진의 기록은 버리지 않고 기기에 두었다가,
/// 나중에 그 사진이 앨범에 들어오면 붙인다.
@MainActor
final class WebImport: ObservableObject {
    static let shared = WebImport()

    /// 아직 짝을 못 찾은 웹 사진 기록
    struct Pending: Codable {
        var name: String
        var shotAt: String?
        var w: Int?
        var h: Int?
        var record: PhotoRecord
    }

    @Published private(set) var pending: [Pending] = []
    private let url: URL

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        url = dir.appendingPathComponent("web-import.json")
        if let data = try? Data(contentsOf: url) {
            let d = JSONDecoder()
            d.dateDecodingStrategy = .iso8601
            pending = (try? d.decode([Pending].self, from: data)) ?? []
        }
    }

    private func save() {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        if let data = try? e.encode(pending) { try? data.write(to: url, options: .atomic) }
    }

    /// 웹 기록 파일인지 — 맨 위에 photos 와 shooters 가 있고 사진에 md5 나 name 이 있다
    static func looksLikeWeb(_ data: Data) -> Bool {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        return root["shooters"] != nil && root["opts"] != nil && root["folderTree"] != nil
    }

    /// 사람·행사·설정을 합치고, 사진 기록은 대기열에 넣는다. 이미 있는 항목(같은 ID)은 건드리지 않는다.
    func run(_ data: Data, store: CatalogStore) throws -> String {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            throw CocoaError(.fileReadCorruptFile)
        }
        func list(_ key: String) -> [[String: Any]] { root[key] as? [[String: Any]] ?? [] }
        func text(_ v: Any?) -> String? { (v as? String).flatMap { $0.isEmpty ? nil : $0 } }
        func image(_ v: Any?) -> Data? {
            // "data:image/webp;base64,...." 꼴
            guard let s = v as? String, let comma = s.firstIndex(of: ",") else { return nil }
            return Data(base64Encoded: String(s[s.index(after: comma)...]))
        }
        func tags(_ key: String) -> [EventTag] {
            (root[key] as? [Any] ?? []).compactMap { item in
                if let name = item as? String { return EventTag(name: name, color: "gray") }
                guard let d = item as? [String: Any], let name = text(d["name"]) else { return nil }
                return EventTag(name: name, color: text(d["color"]) ?? "gray")
            }
        }

        var skippedEvents = Set<String>()
        let events: [EventRecord] = list("events").compactMap { d in
            guard let id = text(d["id"]) else { return nil }
            // "행사 미상"은 이 앱에서 그냥 미지정으로 둔다
            if d["unknown"] as? Bool == true {
                skippedEvents.insert(id)
                return nil
            }
            var e = EventRecord(name: text(d["name"]) ?? "")
            e.id = id
            e.date = text(d["date"])
            e.endDate = text(d["endDate"])
            e.going = d["going"] as? Bool ?? true
            e.place = text(d["place"])
            e.note = text(d["note"])
            e.logo = image(d["logo"])
            e.tags = d["tags"] as? [String] ?? []
            e.packed = d["packed"] as? [String] ?? []
            e.suits = d["suits"] as? [String] ?? []
            e.sub = (d["sub"] as? [[String: Any]] ?? []).compactMap { s in
                guard let title = text(s["title"]) else { return nil }
                return SubItem(id: text(s["id"]) ?? uid("sb"), day: text(s["day"]), time: text(s["time"]), title: title,
                               place: text(s["place"]), note: text(s["note"]))
            }
            e.prep = (d["prep"] as? [[String: Any]] ?? []).compactMap { q in
                guard let t = text(q["text"]) else { return nil }
                return PrepItem(id: text(q["id"]) ?? uid("q"), text: t, done: q["done"] as? Bool ?? false, pin: q["pin"] as? Bool ?? false)
            }
            return e
        }
        let shooters: [Shooter] = list("shooters").compactMap { d in
            guard let id = text(d["id"]), let name = text(d["name"]) else { return nil }
            return Shooter(id: id, name: name, x: text(d["x"]), avatar: image(d["avatar"]), unknown: d["unknown"] as? Bool ?? false)
        }
        let people: [Person] = list("people").compactMap { d in
            guard let id = text(d["id"]), let name = text(d["name"]) else { return nil }
            return Person(id: id, name: name, role: text(d["role"]), x: text(d["x"]), avatar: image(d["avatar"]))
        }
        let suits: [Suit] = list("suits").compactMap { d in
            guard let id = text(d["id"]), let name = text(d["name"]), let personId = text(d["personId"]) else { return nil }
            var s = Suit(id: id, name: name, personId: personId)
            s.x = text(d["x"])
            s.avatar = image(d["avatar"])
            s.maker = text(d["maker"])
            s.debutAt = text(d["debutAt"])
            s.birthday = text(d["birthday"])
            s.memo = text(d["memo"])
            s.retiredAt = text(d["retiredAt"]).map { String($0.prefix(10)) }
            s.log = (d["log"] as? [[String: Any]] ?? []).map { l in
                CareLog(id: text(l["id"]) ?? uid("cl"), kinds: l["kinds"] as? [String] ?? [], note: text(l["note"]),
                        at: String((text(l["at"]) ?? Day.today).prefix(10)), doneAt: text(l["doneAt"]).map { String($0.prefix(10)) })
            }
            return s
        }
        let todos: [Todo] = list("todos").compactMap { d in
            guard let t = text(d["text"]) else { return nil }
            return Todo(id: text(d["id"]) ?? uid("td"), text: t, done: d["done"] as? Bool ?? false)
        }
        let packing: [PackItem] = list("packing").compactMap { d in
            guard let id = text(d["id"]), let t = text(d["text"]) else { return nil }
            return PackItem(id: id, text: t)
        }
        let eventTags = tags("eventTags")
        let careTags = tags("careTags")
        let freeTags = root["tags"] as? [String] ?? []
        let opts = root["opts"] as? [String: Any] ?? [:]
        let me = root["me"] as? [String: Any] ?? [:]
        let rules = (root["rules"] as? [String: Any])?["camera"] as? [String: String] ?? [:]
        let hadPacking = root["packing"] != nil

        store.edit { c in
            func add<E: Identifiable>(_ list: inout [E], _ items: [E]) where E.ID == String {
                for item in items where !list.contains(where: { $0.id == item.id }) { list.append(item) }
            }
            add(&c.events, events)
            add(&c.shooters, shooters)
            add(&c.people, people)
            add(&c.suits, suits)
            add(&c.todos, todos)
            add(&c.eventTags, eventTags)
            add(&c.careTags, careTags)
            // 짐 목록은 웹 것이 진짜다 — 이 앱의 기본 예시와 ID 가 같으면 웹 글로 바꾼다
            if hadPacking {
                for item in packing {
                    if let i = c.packing.firstIndex(where: { $0.id == item.id }) { c.packing[i] = item } else { c.packing.append(item) }
                }
            }
            for t in freeTags where !c.tags.contains(t) { c.tags.append(t) }
            for (cam, id) in rules where c.rules[cam] == nil { c.rules[cam] = id }
            if let v = opts["eventTag"] as? Bool { c.opts.eventTag = v }
            if let v = opts["tags"] as? [String] { c.opts.tags = v }
            if let v = text(opts["prefix"]) { c.opts.prefix = v }
            if let v = text(opts["emoji"]) { c.opts.emoji = v }
            if let v = text(opts["homeTitle"]) { c.opts.homeTitle = v }
            if let v = opts["homeTab"] as? String { c.opts.homeTab = v }
            if let v = text(opts["accent"]) { c.opts.accent = v }
            if let v = opts["accentHex"] as? String { c.opts.accentHex = v }
            if let v = opts["friday"] as? Bool { c.opts.friday = v }
            if c.me.nick.isEmpty, c.me.x == nil {
                c.me.nick = me["nick"] as? String ?? ""
                c.me.x = text(me["x"])
                c.me.avatar = image(me["avatar"])
            }
        }

        // 사진 기록 — 살아 있는 것과, 드라이브에서 사라져 따로 보관돼 있던 것 모두
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isoPlain = ISO8601DateFormatter()
        var fresh: [Pending] = []
        for bucket in ["photos", "gone"] {
            for (_, raw) in root[bucket] as? [String: Any] ?? [:] {
                guard let p = raw as? [String: Any], let name = text(p["name"]) else { continue }
                var r = PhotoRecord()
                r.event = text(p["event"]).flatMap { skippedEvents.contains($0) ? nil : $0 }
                r.shooter = text(p["shooter"])
                r.people = p["people"] as? [String] ?? []
                r.tags = p["tags"] as? [String] ?? []
                r.usages = (p["usages"] as? [[String: Any]] ?? []).map { u in
                    Usage(ch: text(u["ch"]) ?? "etc", url: text(u["url"]), date: String((text(u["date"]) ?? Day.today).prefix(10)))
                }
                if let planned = text(p["plannedAt"]) { r.plannedAt = iso.date(from: planned) ?? isoPlain.date(from: planned) }
                // 아무 기록도 없는 사진은 옮길 것이 없다
                if r.event == nil, r.shooter == nil, r.people.isEmpty, r.tags.isEmpty, r.usages.isEmpty, r.plannedAt == nil { continue }
                fresh.append(Pending(name: name, shotAt: text(p["shotAt"]), w: p["w"] as? Int, h: p["h"] as? Int, record: r))
            }
        }
        pending = fresh
        save()
        return "행사 \(events.count) · 사진사 \(shooters.count) · 퍼슈트 \(people.count) · 사진 기록 \(fresh.count)장"
    }

    /// 대기 중인 웹 사진 기록을 사진첩의 사진과 짝짓는다. 붙인 장수를 돌려준다.
    @discardableResult
    func match(library: PhotoLibrary, store: CatalogStore, meta: MetaStore) -> Int {
        guard !pending.isEmpty, !library.all.isEmpty else { return 0 }
        func stem(_ name: String) -> String { (name as NSString).deletingPathExtension.lowercased() }
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "en_US_POSIX")
        stamp.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"

        var byName: [String: [PHAsset]] = [:]
        var byShot: [String: [PHAsset]] = [:]
        for a in library.all {
            if let name = meta.names[a.localIdentifier] { byName[stem(name), default: []].append(a) }
            if let shot = a.creationDate { byShot["\(stamp.string(from: shot))|\(a.pixelWidth)x\(a.pixelHeight)", default: []].append(a) }
        }

        var left: [Pending] = []
        var done = 0
        for p in pending {
            var hit: PHAsset?
            let named = byName[stem(p.name)] ?? []
            if named.count == 1 {
                hit = named[0]
            } else if named.count > 1, let shot = p.shotAt {
                // 이름이 겹치면 촬영 시각으로 가른다
                hit = named.first { a in a.creationDate.map { stamp.string(from: $0) } == shot }
            } else if named.isEmpty, let shot = p.shotAt, let w = p.w, let h = p.h {
                // 이름이 바뀌어 들어온 사진 — 촬영 시각과 해상도가 유일하게 맞을 때만
                let same = (byShot["\(shot)|\(w)x\(h)"] ?? []) + (byShot["\(shot)|\(h)x\(w)"] ?? [])
                if same.count == 1 { hit = same[0] }
            }
            guard let asset = hit else {
                left.append(p)
                continue
            }
            store.update([library.key(for: asset)]) { r in
                // 이 앱에서 이미 정한 것은 그대로 두고 빈 곳만 채운다
                if r.event == nil, store.event(p.record.event) != nil { r.event = p.record.event }
                if r.shooter == nil, store.shooter(p.record.shooter) != nil { r.shooter = p.record.shooter }
                for id in p.record.people where !r.people.contains(id) && store.person(id) != nil { r.people.append(id) }
                for t in p.record.tags where !r.tags.contains(t) { r.tags.append(t) }
                for u in p.record.usages where !r.usages.contains(where: { $0.url == u.url && $0.date == u.date }) { r.usages.append(u) }
                if r.plannedAt == nil, r.usages.isEmpty { r.plannedAt = p.record.plannedAt }
            }
            done += 1
        }
        if done > 0 {
            pending = left
            save()
        }
        return done
    }

    func discardPending() {
        pending = []
        save()
    }
}
