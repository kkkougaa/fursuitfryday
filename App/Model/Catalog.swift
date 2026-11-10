import Foundation
import SwiftUI

// 기록(DB)의 모양. 사진 파일은 읽기만 하고, 태그·사용 이력·일정은 전부 여기에만 있다.
// 드롭박스에 올라가는 catalog.json 이 이 구조 그대로다. 웹 버전 catalog 의 뼈대를 따랐다.
//
// ⚠ 디코더는 자동 생성이라 없는 키를 만나면 실패한다. 나중에 필드를 더할 때는 옵셔널로 넣는다.

func uid(_ prefix: String) -> String { prefix + String(UUID().uuidString.prefix(8)).lowercased() }

/// 게시 기록 한 건
struct Usage: Codable, Hashable, Identifiable {
    var id = uid("u")
    /// instagram | x | blog | linkedin | threads | etc | "" (링크 없이 기록)
    var ch = ""
    /// http(s):// 를 뗀 주소
    var url: String?
    var date = Day.today
}

struct PhotoRecord: Codable, Hashable {
    /// 어느 행사 사진인지. 사진마다 따로 정한다.
    var event: String?
    var shooter: String?
    var people: [String] = []
    var tags: [String] = []
    var usages: [Usage] = []
    /// 업로드 후보로 담은 시각. 대기열 순서가 된다.
    var plannedAt: Date?
    var updatedAt = Date.nowSec

    var isUsed: Bool { !usages.isEmpty }
    var isPlanned: Bool { plannedAt != nil }
    /// 행사나 사진사가 아직 비어 있다
    var isUnfiled: Bool { event == nil || shooter == nil }
}

struct Shooter: Codable, Hashable, Identifiable {
    var id = uid("s")
    var name: String
    var x: String?
    /// 96px JPEG
    var avatar: Data?
    var unknown = false
}

/// 사진에 같이 찍힌 퍼슈트(사람). 내 퍼슈트는 Suit 가 짝으로 가리킨다.
struct Person: Codable, Hashable, Identifiable {
    var id = uid("p")
    var name: String
    var role: String?
    var x: String?
    var avatar: Data?
}

struct CareLog: Codable, Hashable, Identifiable {
    var id = uid("cl")
    var kinds: [String] = []
    var note: String?
    var at = Day.today
    /// 없으면 "아직 안 함"
    var doneAt: String?
}

/// 내 퍼슈트 대장
struct Suit: Codable, Hashable, Identifiable {
    var id = uid("su")
    var name: String
    var x: String?
    var avatar: Data?
    var maker: String?
    var debutAt: String?
    var birthday: String?
    var personId: String
    var memo: String?
    var retiredAt: String?
    var log: [CareLog] = []
}

struct Me: Codable, Hashable {
    var nick = ""
    var x: String?
    var avatar: Data?
}

struct Opts: Codable, Hashable {
    /// 복사 글에 행사명 해시태그를 넣는다
    var eventTag = true
    /// 기본 해시태그
    var tags: [String] = []
    /// 작가 아이디 앞 글자: # 또는 @
    var prefix = "#"
    var emoji = "📷"
    var homeTitle = "#FursuitFryday🍤"
    var homeTab = ""
    var accent = "blue"
    var accentHex = ""
    var friday = true
}

struct Catalog: Codable, Equatable {
    var v = 1
    var updatedAt = Date.distantPast
    var me = Me()
    var opts = Opts()
    var events: [EventRecord] = []
    var eventTags: [EventTag] = []
    var todos: [Todo] = []
    var packing: [PackItem] = ["슈트 본체", "헤드", "핸드포 · 풋포", "쿨링 조끼 · 아이스팩", "얼음물 · 이온 음료", "여분 티셔츠 · 수건", "탈취 스프레이", "보조배터리"]
        .enumerated().map { PackItem(id: "pk\($0.offset + 1)", text: $0.element) }
    var shooters: [Shooter] = []
    var people: [Person] = []
    var suits: [Suit] = []
    var careTags: [EventTag] = [("세탁", "blue"), ("에어링", "teal"), ("털 정리", "green"), ("수리", "red"), ("헤드", "purple"), ("바디", "amber"), ("발·손", "pink")]
        .map { EventTag(name: $0.0, color: $0.1) }
    /// 자유 태그. 설정에서만 만든다.
    var tags: [String] = []
    /// 카메라 → 사진사. 사용자가 "앞으로"를 켠 것만.
    var rules: [String: String] = [:]
    /// 거절한 제안 키
    var dismissed: [String] = []
    /// 지운 항목 표시 ("events:e12ab", "tags:이름" …). 합칠 때 되살아나지 않게 한다.
    var deleted: [String] = []
    /// 키는 사진의 클라우드 ID(없으면 "local:" + 로컬 ID)
    var photos: [String: PhotoRecord] = [:]

    /// 두 기록을 합친다. 사진은 장마다 나중에 고친 쪽, 나머지는 더 최근에 고친 기록이 이기고
    /// 한쪽에만 있는 항목은 남긴다. 지운 항목은 되살리지 않는다.
    static func merge(_ a: Catalog, _ b: Catalog) -> Catalog {
        let (newer, older) = a.updatedAt >= b.updatedAt ? (a, b) : (b, a)
        var out = newer
        out.deleted = Array(Set(a.deleted).union(b.deleted)).sorted()
        let gone = Set(out.deleted)
        for (key, r) in older.photos {
            if let mine = out.photos[key], mine.updatedAt >= r.updatedAt { continue }
            out.photos[key] = r
        }
        func join<E: Identifiable>(_ kind: String, _ x: [E], _ y: [E]) -> [E] where E.ID == String {
            (x + y.filter { e in !x.contains { $0.id == e.id } }).filter { !gone.contains("\(kind):\($0.id)") }
        }
        out.events = join("events", newer.events, older.events)
        out.eventTags = join("eventTags", newer.eventTags, older.eventTags)
        out.todos = join("todos", newer.todos, older.todos)
        out.packing = join("packing", newer.packing, older.packing)
        out.shooters = join("shooters", newer.shooters, older.shooters)
        out.people = join("people", newer.people, older.people)
        out.suits = join("suits", newer.suits, older.suits)
        out.careTags = join("careTags", newer.careTags, older.careTags)
        out.tags = (newer.tags + older.tags.filter { !newer.tags.contains($0) }).filter { !gone.contains("tags:\($0)") }
        out.dismissed = Array(Set(a.dismissed).union(b.dismissed)).sorted()
        for (cam, id) in older.rules where out.rules[cam] == nil { out.rules[cam] = id }
        return out
    }

    static func encode(_ c: Catalog) throws -> Data {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.sortedKeys]
        return try e.encode(c)
    }

    static func decode(_ data: Data) throws -> Catalog {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return try d.decode(Catalog.self, from: data)
    }
}

/// X 아이디 다듬기. @·주소를 떼고 형식(영문·숫자·밑줄 15자)이 아니면 nil.
func normX(_ raw: String) -> String? {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    for head in ["https://", "http://", "www.", "mobile.", "x.com/", "twitter.com/", "@"] where s.lowercased().hasPrefix(head) {
        s = String(s.dropFirst(head.count))
    }
    if let cut = s.firstIndex(where: { $0 == "/" || $0 == "?" }) { s = String(s[..<cut]) }
    let ok = !s.isEmpty && s.count <= 15 && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") }
    return ok ? s : nil
}

/// 링크의 도메인으로 채널을 알아본다
func channelOf(_ url: String) -> String {
    let u = url.lowercased()
    if u.contains("instagram.com") { return "instagram" }
    if u.contains("threads.net") || u.contains("threads.com") { return "threads" }
    if u.contains("x.com") || u.contains("twitter.com") { return "x" }
    if u.contains("blog.naver") || u.contains("tistory") || u.contains("brunch.co") || u.contains("velog.io") { return "blog" }
    if u.contains("linkedin.com") { return "linkedin" }
    return "etc"
}

func channelName(_ ch: String) -> String {
    switch ch {
    case "instagram": return "인스타그램"
    case "x": return "X"
    case "blog": return "블로그"
    case "linkedin": return "링크드인"
    case "threads": return "스레드"
    default: return "기타"
    }
}

/// "#" + 공백·문장부호를 뺀 글
func hashtagify(_ text: String) -> String {
    let drop = Set("·・.,'\"“”‘’!?()[]{}/\\|:;~-–— \t\n#")
    let body = String(text.filter { !drop.contains($0) })
    return body.isEmpty ? "" : "#" + body
}

@MainActor
final class CatalogStore: ObservableObject {
    @Published private(set) var catalog = Catalog()
    /// 드롭박스에 아직 안 올라간 변경이 있다
    @Published private(set) var dirty = UserDefaults.standard.bool(forKey: "fff.dirty")
    /// 읽기에 실패한 파일이 있었다 — 덮어쓰기 전에 옆에 보관해 둔다
    @Published private(set) var loadError: String?

    private let url: URL
    private var saveTask: Task<Void, Never>?

    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("catalog.json")
        if let data = try? Data(contentsOf: url) {
            do {
                catalog = try Catalog.decode(data)
            } catch {
                // 깨진 파일을 빈 기록으로 조용히 덮어쓰면 복구할 길이 없어진다
                let keep = dir.appendingPathComponent("catalog-broken-\(Int(Date().timeIntervalSince1970)).json")
                try? data.write(to: keep)
                loadError = "기록 파일을 읽지 못해 따로 보관했어요 (\(keep.lastPathComponent))"
            }
        }
        Accent.apply(catalog.opts)
    }

    // MARK: 고치기

    /// 기록을 고친다. 사진 기록은 update 를 쓴다(장마다 고친 시각을 남겨야 한다).
    func edit(_ change: (inout Catalog) -> Void) {
        change(&catalog)
        Accent.apply(catalog.opts)
        touch()
    }

    func record(_ key: String) -> PhotoRecord { catalog.photos[key] ?? PhotoRecord() }

    func update(_ keys: [String], _ change: (inout PhotoRecord) -> Void) {
        guard !keys.isEmpty else { return }
        for key in keys {
            var r = record(key)
            change(&r)
            r.updatedAt = .nowSec
            catalog.photos[key] = r
        }
        touch()
    }

    func updateEvent(_ id: String, _ change: (inout EventRecord) -> Void) {
        guard let i = catalog.events.firstIndex(where: { $0.id == id }) else { return }
        change(&catalog.events[i])
        catalog.events[i].updatedAt = .nowSec
        touch()
    }

    func updateSuit(_ id: String, _ change: (inout Suit) -> Void) {
        guard let i = catalog.suits.firstIndex(where: { $0.id == id }) else { return }
        change(&catalog.suits[i])
        touch()
    }

    /// 지운 표시를 남긴다 — 드롭박스와 합칠 때 되살아나지 않게
    func markDeleted(_ kind: String, _ key: String) {
        let mark = "\(kind):\(key)"
        if !catalog.deleted.contains(mark) { catalog.deleted.append(mark) }
    }

    // MARK: 찾기

    func event(_ id: String?) -> EventRecord? { id.flatMap { id in catalog.events.first { $0.id == id } } }
    func shooter(_ id: String?) -> Shooter? { id.flatMap { id in catalog.shooters.first { $0.id == id } } }
    func person(_ id: String?) -> Person? { id.flatMap { id in catalog.people.first { $0.id == id } } }
    func suit(_ id: String?) -> Suit? { id.flatMap { id in catalog.suits.first { $0.id == id } } }
    func tagColor(_ name: String, care: Bool = false) -> String {
        (care ? catalog.careTags : catalog.eventTags).first { $0.name == name }?.color ?? "gray"
    }

    var activeSuits: [Suit] { catalog.suits.filter { $0.retiredAt == nil } }

    /// 그 퍼슈트를 데려간 행사 수 — 착용 횟수는 저장하지 않고 센다
    func wears(_ suitId: String) -> [EventRecord] { catalog.events.filter { $0.suits.contains(suitId) } }

    // MARK: 만들기

    /// "사진사 미상" — 알아봤지만 모르는 상태. 미지정과 다르다.
    func unknownShooter() -> String {
        if let s = catalog.shooters.first(where: { $0.unknown }) { return s.id }
        let s = Shooter(id: "s-unknown", name: "사진사 미상", unknown: true)
        edit { $0.shooters.append(s) }
        return s.id
    }

    @discardableResult
    func addShooter(_ name: String, x: String? = nil) -> String? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        if let same = catalog.shooters.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) { return same.id }
        let s = Shooter(name: name, x: x.flatMap(normX))
        edit { $0.shooters.append(s) }
        return s.id
    }

    @discardableResult
    func addPerson(_ name: String, role: String? = nil, x: String? = nil) -> String? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        if let same = catalog.people.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) { return same.id }
        let p = Person(name: name, role: role, x: x.flatMap(normX))
        edit { $0.people.append(p) }
        return p.id
    }

    func addEvent(_ e: EventRecord) {
        var e = e
        // 쓰는 퍼슈트가 하나뿐이면 물어볼 것이 없다
        if e.suits.isEmpty, activeSuits.count == 1 { e.suits = [activeSuits[0].id] }
        edit { $0.events.append(e) }
    }

    // MARK: 복사 글

    /// 해시태그 줄 + 빈 줄 + 크레딧 줄. 빈 쪽은 뺀다.
    func copyText(shooter: String?, eventName: String?) -> String {
        let o = catalog.opts
        var tags: [String] = []
        if o.eventTag, let eventName { tags.append(hashtagify(eventName)) }
        tags += o.tags
        return [tags.filter { !$0.isEmpty }.joined(separator: " "), credit(shooter)].compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    /// "📷 #아이디" — X 아이디가 있는 사진사만
    func credit(_ shooterId: String?) -> String? {
        guard let x = shooter(shooterId)?.x else { return nil }
        return "\(catalog.opts.emoji) \(catalog.opts.prefix)\(x)"
    }

    // MARK: 저장

    /// 사진의 키가 바뀌었을 때(로컬 ID → 클라우드 ID) 기록을 따라 옮긴다
    func rekey(_ pairs: [(from: String, to: String)]) {
        var changed = false
        for (from, to) in pairs {
            guard let old = catalog.photos[from] else { continue }
            if let existing = catalog.photos[to], existing.updatedAt >= old.updatedAt {
                catalog.photos[from] = nil
            } else {
                catalog.photos[to] = old
                catalog.photos[from] = nil
            }
            changed = true
        }
        if changed { touch() }
    }

    /// 드롭박스와 합친 결과로 바꾼다
    func replace(with merged: Catalog) {
        guard merged != catalog else { return }
        catalog = merged
        Accent.apply(catalog.opts)
        scheduleSave()
    }

    func markSynced() {
        dirty = false
        UserDefaults.standard.set(false, forKey: "fff.dirty")
    }

    private func touch() {
        catalog.updatedAt = .nowSec
        if !dirty {
            dirty = true
            UserDefaults.standard.set(true, forKey: "fff.dirty")
        }
        scheduleSave()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            if !Task.isCancelled { self?.saveNow() }
        }
    }

    func saveNow() {
        saveTask?.cancel()
        guard let data = try? Catalog.encode(catalog) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
