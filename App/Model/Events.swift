import Foundation
import SwiftUI

// 행사 = 일정. 같은 목록을 사진 분류 축과 일정으로 겸용한다.
// 날짜는 웹 버전과 같이 "YYYY-MM-DD" 문자열로 둔다 — 시각·타임존이 섞이지 않는다.

struct SubItem: Codable, Hashable, Identifiable {
    var id = uid("sb")
    var day: String?
    var time: String?
    var title: String
    var place: String?
    var note: String?
}

struct PrepItem: Codable, Hashable, Identifiable {
    var id = uid("q")
    var text: String
    var done = false
    var pin = false
}

struct EventRecord: Codable, Hashable, Identifiable {
    var id = uid("e")
    var name: String
    var date: String?
    var endDate: String?
    var going = true
    var place: String?
    var note: String?
    /// 128px JPEG
    var logo: Data?
    var tags: [String] = []
    var sub: [SubItem] = []
    var prep: [PrepItem] = []
    var packed: [String] = []
    var suits: [String] = []
    var updatedAt = Date.nowSec

    init(name: String) { self.name = name }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        date = try c.decodeIfPresent(String.self, forKey: .date)
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        going = try c.decodeIfPresent(Bool.self, forKey: .going) ?? true
        place = try c.decodeIfPresent(String.self, forKey: .place)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        logo = try c.decodeIfPresent(Data.self, forKey: .logo)
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        sub = try c.decodeIfPresent([SubItem].self, forKey: .sub) ?? []
        prep = try c.decodeIfPresent([PrepItem].self, forKey: .prep) ?? []
        packed = try c.decodeIfPresent([String].self, forKey: .packed) ?? []
        suits = try c.decodeIfPresent([String].self, forKey: .suits) ?? []
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .distantPast
    }
}

struct EventTag: Codable, Hashable, Identifiable {
    var name: String
    var color: String
    var id: String { name }
}

struct PackItem: Codable, Hashable, Identifiable {
    var id = uid("pk")
    var text: String
}

struct Todo: Codable, Hashable, Identifiable {
    var id = uid("td")
    var text: String
    var done = false
    var at = Date.nowSec
}

/// "YYYY-MM-DD" 날짜 계산. 자정 기준으로만 센다.
enum Day {
    private static let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static let parser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// 기기 시간대의 오늘
    static var today: String { string(Date()) }

    /// 기기 시간대 기준으로 그 순간이 속한 날짜
    static func string(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func utc(_ day: String) -> Date? { parser.date(from: day) }

    /// 날짜 고르개용 — 기기 시간대의 그날 정오
    static func local(_ day: String) -> Date {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return Date() }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) ?? Date()
    }

    static func diff(_ a: String, _ b: String) -> Int? {
        guard let x = utc(a), let y = utc(b) else { return nil }
        return cal.dateComponents([.day], from: x, to: y).day
    }

    static func until(_ day: String?) -> Int? { day.flatMap { diff(today, $0) } }

    static func add(_ day: String, _ n: Int) -> String {
        guard let d = utc(day), let moved = cal.date(byAdding: .day, value: n, to: d) else { return day }
        return parser.string(from: moved)
    }

    static func dotted(_ day: String) -> String { day.replacingOccurrences(of: "-", with: ".") }

    /// "10.24"
    static func short(_ day: String) -> String { String(dotted(day).dropFirst(5)) }
}

enum EventPhase: Equatable {
    case none
    case before(Int)
    case during(index: Int, of: Int)
    case after(Int)
}

extension EventRecord {
    var dayCount: Int {
        guard let date, let endDate, let n = Day.diff(date, endDate), n > 0 else { return 1 }
        return n + 1
    }

    var lastDay: String? { endDate ?? date }

    var phase: EventPhase {
        guard let date, let start = Day.until(date) else { return .none }
        if start > 0 { return .before(start) }
        let end = Day.until(lastDay) ?? start
        if end >= 0 { return .during(index: -start + 1, of: dayCount) }
        return .after(-end)
    }

    var isLive: Bool { if case .during = phase { return true } else { return false } }

    /// 큰 글씨 / 작은 글씨
    var dday: (big: String, sub: String?) {
        switch phase {
        case .none: return ("미정", nil)
        case .before(let n): return ("D-\(n)", nil)
        case .after(let n): return ("D+\(n)", nil)
        case .during(let index, let of): return of > 1 ? ("\(index)일차", "\(of)일 중") : ("오늘", nil)
        }
    }

    /// 하루면 "2026.10.23", 여러 날이면 "2026.10.23 – 25 · 3일"
    var range: String {
        guard let date else { return "날짜 미정" }
        guard let endDate, dayCount > 1 else { return Day.dotted(date) }
        let tail: String
        if date.prefix(7) == endDate.prefix(7) {
            tail = String(endDate.suffix(2))
        } else if date.prefix(4) == endDate.prefix(4) {
            tail = Day.short(endDate)
        } else {
            tail = Day.dotted(endDate)
        }
        return "\(Day.dotted(date)) – \(tail) · \(dayCount)일"
    }

    var prepDone: Int { prep.filter(\.done).count }

    func packDone(_ packing: [PackItem]) -> Int { packed.filter { id in packing.contains { $0.id == id } }.count }

    var sortedSub: [SubItem] {
        sub.sorted { a, b in
            let da = a.day ?? date ?? "", db = b.day ?? date ?? ""
            if da != db { return da < db }
            return (a.time ?? "99:99") < (b.time ?? "99:99")
        }
    }

    /// 오늘 이후의 약속
    var aheadSub: [SubItem] { sortedSub.filter { $0.day == nil || $0.day! >= Day.today } }

    /// 여러 날 행사에서 그 날이 며칠차인지
    func dayIndex(_ day: String?) -> Int? {
        guard dayCount > 1, let date, let day, let n = Day.diff(date, day) else { return nil }
        return n + 1
    }
}

extension Array where Element == EventRecord {
    /// 홈 디데이가 잡을 행사: 진행 중 > 다가오는 확정 > 다가오는 미정
    var next: EventRecord? {
        let alive = filter { e in
            if case .none = e.phase { return false }
            if case .after = e.phase { return false }
            return true
        }.sorted { ($0.date ?? "") < ($1.date ?? "") }
        return alive.first { $0.isLive } ?? alive.first { $0.going } ?? alive.first
    }
}

/// 행사 카테고리 색 (웹 버전의 여덟 색)
enum TagColor {
    static let names = ["blue", "green", "amber", "red", "purple", "teal", "pink", "gray"]

    static func pair(_ name: String) -> (text: Color, fill: Color) {
        switch name {
        case "blue": return (Color(light: 0x1B64DA, dark: 0x6FA8FF), Color(light: 0xE8F3FF, dark: 0x1B2637))
        case "green": return (Color(light: 0x027A4B, dark: 0x3ECF95), Color(light: 0xF0FAF6, dark: 0x122A22))
        case "amber": return (Color(light: 0x9A5B00, dark: 0xFFB84D), Color(light: 0xFFF9E7, dark: 0x2E2415))
        case "red": return (Color(light: 0xC92A3A, dark: 0xFF7794), Color(light: 0xFFEEEE, dark: 0x33191F))
        case "purple": return (Color(light: 0x5B3FC4, dark: 0xA78BFF), Color(light: 0xF0EBFE, dark: 0x221D3A))
        case "teal": return (Color(light: 0x0B6E6E, dark: 0x4CB8C4), Color(light: 0xEDF8F8, dark: 0x12292C))
        case "pink": return (Color(light: 0xA82C7C, dark: 0xF171C8), Color(light: 0xFCEAF6, dark: 0x301B2B))
        default: return (Color(light: 0x4E5968, dark: 0xC3C9D1), Color(light: 0xF2F4F6, dark: 0x23232B))
        }
    }
}
