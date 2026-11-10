import CryptoKit
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
        /// 드라이브 파일의 md5 지문. 예전에 가져온 기록에는 없다.
        var md5: String?
        /// 드라이브 파일 ID. 그 사진만 골라 받아 비교할 때 쓴다.
        var fileId: String?
        var record: PhotoRecord

        var probe: WebProbe {
            WebProbe(stem: WebMatch.stem(name), shot: shotAt, size: (w != nil && h != nil) ? WebMatch.size(w ?? 0, h ?? 0) : nil,
                     md5: md5)
        }
    }

    @Published private(set) var pending: [Pending] = []
    private let url: URL
    private var matching = false

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
            for (fileId, raw) in root[bucket] as? [String: Any] ?? [:] {
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
                fresh.append(Pending(name: name, shotAt: text(p["shotAt"]), w: p["w"] as? Int, h: p["h"] as? Int,
                                     md5: text(p["md5"])?.lowercased(), fileId: bucket == "photos" ? fileId : nil, record: r))
            }
        }
        pending = fresh
        save()
        return "행사 \(events.count) · 사진사 \(shooters.count) · 퍼슈트 \(people.count) · 사진 기록 \(fresh.count)장"
    }

    /// 대기 중인 웹 사진 기록을 앨범의 사진과 짝짓는다. 붙인 장수를 돌려준다.
    ///
    /// 1. 이름 + 해상도 + 촬영 시각이 다 맞는 사진이 하나뿐이고, 같은 시각·해상도의 다른 사진도 없으면 바로 붙인다.
    ///    여기까지는 사진 파일을 읽지 않는다(내려받지도 않는다).
    /// 2. 그걸로 가려지지 않는 것만 — 이름이 바뀐 사진, 연사처럼 같은 시각·해상도의 사진이 여럿인 경우 —
    ///    파일 지문(md5)을 계산해서 가린다. 지문 계산은 파일을 통째로 읽어야 하고, iCloud 에만 있는 원본은
    ///    내려받아야 하므로 꼭 필요한 후보에만 한다.
    @discardableResult
    func match(library: PhotoLibrary, store: CatalogStore, meta: MetaStore) async -> Int {
        guard !pending.isEmpty, !library.all.isEmpty, !matching else { return 0 }
        matching = true
        defer { matching = false }
        let stamp = WebMatch.stamp()
        struct Seen {
            let asset: PHAsset
            let shot: String?
            let size: String
            var id: String { asset.localIdentifier }
        }
        var byName: [String: [Seen]] = [:]
        var byShot: [String: [Seen]] = [:]
        for a in library.all {
            let seen = Seen(asset: a, shot: a.creationDate.map { stamp.string(from: $0) }, size: WebMatch.size(a.pixelWidth, a.pixelHeight))
            if let name = meta.names[a.localIdentifier] { byName[WebMatch.stem(name), default: []].append(seen) }
            if let shot = seen.shot { byShot["\(shot)|\(seen.size)", default: []].append(seen) }
        }

        var left: [Pending] = []
        var hard: [Pending] = []
        var taken = Set<String>()
        var done = 0

        func attach(_ p: Pending, _ asset: PHAsset) {
            taken.insert(asset.localIdentifier)
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

        // 1단계 — 파일을 읽지 않고 가린다.
        // 이름·해상도·촬영 시각 셋 가운데 **둘이 맞고, 그런 사진이 앨범에 하나뿐이면** 같은 사진으로 본다.
        // 셋 다 맞기를 요구하면, 웹 기록의 촬영 시각이 잘못 적힌 사진(드라이브가 촬영 시각을 못 읽어
        // 올린 날짜가 대신 적힌 사진들)이 전부 떨어진다.
        for p in pending {
            let probe = p.probe
            let named = (byName[probe.stem] ?? []).filter { !taken.contains($0.id) }
            let nameTime = named.filter { s in
                guard let a = probe.shot, let b = s.shot else { return false }
                return WebMatch.sameShot(a, b, stamp)
            }
            let nameSize = named.filter { $0.size == probe.size }
            var timeSize: [Seen] = []
            if let shot = probe.shot, let size = probe.size {
                timeSize = (byShot["\(shot)|\(size)"] ?? []).filter { !taken.contains($0.id) }
            }
            if nameTime.count == 1 {
                // 이름 + 촬영 시각
                attach(p, nameTime[0].asset)
            } else if nameSize.count == 1 {
                // 이름 + 해상도
                attach(p, nameSize[0].asset)
            } else if probe.size == nil, named.count == 1 {
                // 해상도가 없는 기록 — 앨범 안에 그 이름이 하나뿐일 때만
                attach(p, named[0].asset)
            } else if timeSize.count == 1 {
                // 촬영 시각 + 해상도 (이름이 바뀐 사진)
                attach(p, timeSize[0].asset)
            } else if probe.shot != nil, probe.size != nil {
                // 후보가 여럿이다(연사, 이름이 겹침) — 지문으로 가린다
                hard.append(p)
            } else {
                left.append(p)
            }
        }

        // 2단계 — 가려지지 않은 것만 지문으로
        if !hard.isEmpty {
            func candidates(_ p: Pending) -> [Seen] {
                let probe = p.probe
                guard let shot = probe.shot, let size = probe.size else { return [] }
                let named = (byName[probe.stem] ?? []).filter { $0.size == size }
                return (byShot["\(shot)|\(size)"] ?? []) + named.filter { n in !(byShot["\(shot)|\(size)"] ?? []).contains { $0.id == n.id } }
            }
            var todo: [String: PHAsset] = [:]
            for p in hard where p.md5 != nil {
                for c in candidates(p) where !taken.contains(c.id) && FileHasher.shared.cached(c.id) == nil { todo[c.id] = c.asset }
            }
            if !todo.isEmpty {
                let assets = Array(todo.values)
                await Task.detached(priority: .utility) {
                    DispatchQueue.concurrentPerform(iterations: assets.count) { i in _ = FileHasher.shared.md5(assets[i]) }
                    FileHasher.shared.save()
                }.value
            }
            for p in hard {
                let probe = p.probe
                let pool = candidates(p).filter { !taken.contains($0.id) }
                if let md5 = p.md5, let same = pool.first(where: { FileHasher.shared.cached($0.id) == md5 }) {
                    // 파일이 완전히 같다
                    attach(p, same.asset)
                } else if let fit = pool.first(where: { WebMatch.fits(probe, stem: probe.stem, shot: $0.shot, size: $0.size, stamp: stamp) }) {
                    // 지문은 다르지만(저장하면서 다시 압축된 사진) 이름·해상도·촬영 시각이 다 맞는다
                    attach(p, fit.asset)
                } else if p.md5 == nil, pool.count == 1 {
                    // 지문이 없는 옛 기록 — 촬영 시각·해상도가 같은 사진이 딱 하나일 때만
                    attach(p, pool[0].asset)
                } else {
                    left.append(p)
                }
            }
        }

        if done > 0 {
            pending = left
            save()
        }
        return done
    }

    /// 그 드라이브 파일의 기록을, 기록 키가 가리키는 사진에 붙인다 (드라이브에서 직접 받은 사진에 쓴다)
    func attach(fileId: String, key: String, store: CatalogStore) -> Bool {
        guard let i = pending.firstIndex(where: { $0.fileId == fileId }) else { return false }
        let p = pending.remove(at: i)
        store.update([key]) { r in
            if r.event == nil, store.event(p.record.event) != nil { r.event = p.record.event }
            if r.shooter == nil, store.shooter(p.record.shooter) != nil { r.shooter = p.record.shooter }
            for id in p.record.people where !r.people.contains(id) && store.person(id) != nil { r.people.append(id) }
            for t in p.record.tags where !r.tags.contains(t) { r.tags.append(t) }
            for u in p.record.usages where !r.usages.contains(where: { $0.url == u.url && $0.date == u.date }) { r.usages.append(u) }
            if r.plannedAt == nil, r.usages.isEmpty { r.plannedAt = p.record.plannedAt }
        }
        save()
        return true
    }

    /// 그림으로 같은 사진임을 확인한 짝에 기록을 붙인다 (DriveCheck 가 쓴다)
    func attachVerified(_ pairs: [(fileId: String, asset: PHAsset)], library: PhotoLibrary, store: CatalogStore) -> Int {
        var done = 0
        for pair in pairs {
            guard let i = pending.firstIndex(where: { $0.fileId == pair.fileId }) else { continue }
            let p = pending.remove(at: i)
            store.update([library.key(for: pair.asset)]) { r in
                if r.event == nil, store.event(p.record.event) != nil { r.event = p.record.event }
                if r.shooter == nil, store.shooter(p.record.shooter) != nil { r.shooter = p.record.shooter }
                for id in p.record.people where !r.people.contains(id) && store.person(id) != nil { r.people.append(id) }
                for t in p.record.tags where !r.tags.contains(t) { r.tags.append(t) }
                for u in p.record.usages where !r.usages.contains(where: { $0.url == u.url && $0.date == u.date }) { r.usages.append(u) }
                if r.plannedAt == nil, r.usages.isEmpty { r.plannedAt = p.record.plannedAt }
            }
            done += 1
        }
        if done > 0 { save() }
        return done
    }

    /// 대기 중인 기록을 대조용으로 간추린 것
    var probes: [WebProbe] { pending.map(\.probe) }

    /// 앨범 사진 가운데 대기 중인 웹 기록 어느 것과도 맞지 않는 사진인가 (잘못 들어온 사진을 가려낼 때 쓴다)
    func fitsNothing(_ asset: PHAsset, name: String?) -> Bool {
        let stamp = WebMatch.stamp()
        let shot = asset.creationDate.map { stamp.string(from: $0) }
        let size = WebMatch.size(asset.pixelWidth, asset.pixelHeight)
        let stem = name.map(WebMatch.stem)
        let hash = FileHasher.shared.cached(asset.localIdentifier)
        return !pending.contains { p in
            let probe = p.probe
            if let hash, p.md5 == hash { return true }
            if let stem, WebMatch.fits(probe, stem: stem, shot: shot, size: size, stamp: stamp) { return true }
            return probe.shot != nil && probe.shot == shot && probe.size == size
        }
    }

    func discardPending() {
        pending = []
        save()
    }
}

/// 웹 기록 한 장을 사진첩 사진과 대조할 때 쓰는 값
struct WebProbe: Sendable {
    /// 파일 이름에서 확장자를 떼고 소문자로
    let stem: String
    /// "YYYY-MM-DDTHH:MM:SS" (기기 시간대 기준 촬영 시각)
    let shot: String?
    /// "짧은변x긴변" — 돌려 찍은 사진도 같게 나온다
    let size: String?
    /// 원본 파일의 md5 지문
    var md5: String?
}

/// 사진 원본 파일의 md5 지문. 웹 버전이 드라이브 파일마다 적어 둔 값과 같으면 완전히 같은 파일이다.
/// 파일을 통째로 읽어야 해서 느리다 — 한 번 구한 값은 기기에 적어 두고, 꼭 필요한 사진에만 계산한다.
final class FileHasher: @unchecked Sendable {
    static let shared = FileHasher()

    private let lock = NSLock()
    private var cache: [String: String] = [:]
    private var dirty = false
    private let url: URL

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        url = dir.appendingPathComponent("photo-md5.json")
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode([String: String].self, from: data) {
            cache = saved
        }
    }

    func cached(_ localId: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return cache[localId]
    }

    /// 끝날 때까지 기다린다 — 화면 쪽에서 부르면 안 된다. iCloud 에만 있는 원본은 내려받는다.
    func md5(_ asset: PHAsset) -> String? {
        if let known = cached(asset.localIdentifier) { return known }
        let resources = PHAssetResource.assetResources(for: asset)
        // 편집본이 아니라 처음 들어온 원본을 읽는다
        guard let original = resources.first(where: { $0.type == .photo }) ?? resources.first else { return nil }
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        let job = HashJob()
        let wait = DispatchSemaphore(value: 0)
        PHAssetResourceManager.default().requestData(for: original, options: options, dataReceivedHandler: { chunk in
            job.hasher.update(data: chunk)
        }, completionHandler: { error in
            job.failed = error != nil
            wait.signal()
        })
        wait.wait()
        guard !job.failed else { return nil }
        let hex = job.hasher.finalize().map { String(format: "%02x", $0) }.joined()
        lock.lock()
        cache[asset.localIdentifier] = hex
        dirty = true
        lock.unlock()
        return hex
    }

    func save() {
        lock.lock()
        let snapshot = dirty ? cache : nil
        dirty = false
        lock.unlock()
        if let snapshot, let data = try? JSONEncoder().encode(snapshot) { try? data.write(to: url, options: .atomic) }
    }
}

private final class HashJob: @unchecked Sendable {
    var hasher = Insecure.MD5()
    var failed = false
}

/// "같은 사진인가"의 규칙. 사진첩에서 찾을 때와 앨범에서 기록을 붙일 때 똑같이 쓴다.
///
/// 이름·해상도·촬영 시각 가운데 **둘이 맞고 그런 사진이 하나뿐이면** 같은 사진으로 본다.
/// 후보가 여럿이라 가려지지 않을 때 쓰는, 가장 확실한 건 파일 지문(md5)이다 — 같으면 완전히 같은 파일이다. 다만 저장하면서 다시 압축된 사진은
/// 눈으로는 같아도 지문이 다르다. 그런 사진을 위해 두 번째 규칙을 둔다:
/// 파일 이름만으로는 같은 사진이라고 할 수 없으니(IMG_1234, DSC_0001 은 얼마든지 겹친다)
/// **이름 + 해상도 + 촬영 시각**이 다 맞아야 같은 사진으로 본다.
enum WebMatch {
    static func stamp() -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f
    }

    static func stem(_ name: String) -> String { (name as NSString).deletingPathExtension.lowercased() }

    static func size(_ w: Int, _ h: Int) -> String { "\(min(w, h))x\(max(w, h))" }

    /// 촬영 시각이 같은가. 사진에 시간대가 적혀 있으면 사진첩이 그만큼 옮겨서 보여주므로,
    /// 분·초가 같고 30분 단위로만 어긋난 것(시간대 차이)은 같은 시각으로 본다.
    static func sameShot(_ a: String, _ b: String, _ stamp: DateFormatter) -> Bool {
        if a == b { return true }
        guard let x = stamp.date(from: a), let y = stamp.date(from: b) else { return false }
        let gap = abs(x.timeIntervalSince(y))
        return gap <= 14 * 3600 && gap.truncatingRemainder(dividingBy: 1800) == 0
    }

    /// 이름·해상도·촬영 시각이 모두 맞는가
    static func fits(_ p: WebProbe, stem: String, shot: String?, size: String, stamp: DateFormatter) -> Bool {
        guard p.stem == stem, let want = p.size, want == size, let a = p.shot, let b = shot else { return false }
        return sameShot(a, b, stamp)
    }
}
