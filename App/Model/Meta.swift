import CoreLocation
import ImageIO
import Photos
import SwiftUI
import UIKit

// 테마 색, 촬영 정보(EXIF) 읽기, 프로필 사진 받기, 촬영 장소 이름

/// 사진의 위치를 동네 이름으로 바꾼다(애플 지오코더). 행사 제안 카드에 "어디서 찍었는지"를 보여주려고 쓴다.
@MainActor
final class PlaceNames: ObservableObject {
    static let shared = PlaceNames()
    @Published private(set) var names: [String: String] = [:]
    private var asked: Set<String> = []

    /// 이미 알면 바로 주고, 모르면 뒤에서 알아본 뒤 화면을 다시 그리게 한다
    func name(_ location: CLLocation?) -> String? {
        guard let location else { return nil }
        let key = String(format: "%.2f,%.2f", location.coordinate.latitude, location.coordinate.longitude)
        if let known = names[key] { return known.isEmpty ? nil : known }
        if asked.insert(key).inserted {
            Task {
                let mark = try? await CLGeocoder().reverseGeocodeLocation(location).first
                names[key] = [mark?.locality, mark?.subLocality ?? mark?.name].compactMap { $0 }.joined(separator: " ")
            }
        }
        return nil
    }
}

/// 앱 전체 강조색. 색 하나에서 누름·면·글자색을 만들어 낸다(웹 버전의 accentVars 와 같은 방식).
enum Accent {
    static let presets: [(key: String, name: String, hex: UInt32)] = [
        ("blue", "파랑", 0x3182F6), ("teal", "청록", 0x109595), ("green", "초록", 0x02A262), ("purple", "보라", 0x7B5CE5),
        ("pink", "분홍", 0xD6409F), ("red", "빨강", 0xF04452), ("amber", "호박", 0xED6700), ("ink", "먹색", 0x333D4B),
    ]

    private(set) static var hex: UInt32 = 0x3182F6

    static func apply(_ opts: Opts) {
        if opts.accent == "custom", let custom = parse(opts.accentHex) {
            hex = custom
        } else {
            hex = presets.first { $0.key == opts.accent }?.hex ?? 0x3182F6
        }
    }

    static func name(_ opts: Opts) -> String {
        opts.accent == "custom" ? opts.accentHex.uppercased() : (presets.first { $0.key == opts.accent }?.name ?? "파랑")
    }

    /// "#RGB" 또는 "#RRGGBB"
    static func parse(_ text: String) -> UInt32? {
        var s = text.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6 else { return nil }
        return UInt32(s, radix: 16)
    }

    private static func hsl(_ hex: UInt32) -> (h: Double, s: Double, l: Double) {
        let r = Double((hex >> 16) & 0xFF) / 255, g = Double((hex >> 8) & 0xFF) / 255, b = Double(hex & 0xFF) / 255
        let mx = max(r, g, b), mn = min(r, g, b), l = (mx + mn) / 2
        guard mx != mn else { return (0, 0, l) }
        let d = mx - mn
        let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        var h: Double
        if mx == r { h = (g - b) / d + (g < b ? 6 : 0) } else if mx == g { h = (b - r) / d + 2 } else { h = (r - g) / d + 4 }
        h /= 6
        return (h, s, l)
    }

    private static func rgb(_ h: Double, _ s: Double, _ l: Double) -> UInt32 {
        func channel(_ p: Double, _ q: Double, _ t0: Double) -> Double {
            var t = t0
            if t < 0 { t += 1 }
            if t > 1 { t -= 1 }
            if t < 1 / 6 { return p + (q - p) * 6 * t }
            if t < 1 / 2 { return q }
            if t < 2 / 3 { return p + (q - p) * (2 / 3 - t) * 6 }
            return p
        }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
        let r = s == 0 ? l : channel(p, q, h + 1 / 3), g = s == 0 ? l : channel(p, q, h), b = s == 0 ? l : channel(p, q, h - 1 / 3)
        return (UInt32((r * 255).rounded()) << 16) | (UInt32((g * 255).rounded()) << 8) | UInt32((b * 255).rounded())
    }

    private static func luminance(_ hex: UInt32) -> Double {
        func lin(_ v: UInt32) -> Double {
            let c = Double(v) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * lin((hex >> 16) & 0xFF) + 0.7152 * lin((hex >> 8) & 0xFF) + 0.0722 * lin(hex & 0xFF)
    }

    /// 흰 글자를 받칠 수 있는 색인가 (대비 2.4 이상)
    static func holdsWhite(_ hex: UInt32) -> Bool { 1.05 / (luminance(hex) + 0.05) >= 2.4 }

    private static var darkMain: UInt32 {
        let c = hsl(hex)
        return rgb(c.h, c.s, min(max(c.l + 0.1, 0.62), 0.74))
    }

    static var main: Color { Color(light: hex, dark: darkMain) }

    /// 옅은 면 위에 쓰는 글자색 — 본색보다 한 단 어둡게
    static var text: Color {
        let c = hsl(hex)
        return Color(light: rgb(c.h, c.s, min(c.l, 0.43)), dark: darkMain)
    }

    static var fill: Color {
        let c = hsl(hex)
        return Color(light: rgb(c.h, min(c.s, 0.92), 0.96), dark: rgb(c.h, min(c.s, 0.34), 0.16))
    }

    static var onMain: Color {
        Color(light: holdsWhite(hex) ? 0xFFFFFF : 0x101318, dark: holdsWhite(darkMain) ? 0xFFFFFF : 0x101318)
    }
}

struct PhotoMeta: Codable, Hashable {
    var camera: String?
    var lens: String?
    var exposure: String?
    var iso: Int?
}

private final class DataBox: @unchecked Sendable {
    var data: Data?
}

/// 촬영 정보. 사진첩이 카메라 모델을 바로 주지 않아서 원본 머리말을 읽어 이 기기에 적어 둔다.
/// 카메라 → 사진사 제안이 이걸 쓴다.
@MainActor
final class MetaStore: ObservableObject {
    static let shared = MetaStore()

    /// 로컬 ID → 촬영 정보. 읽어 봤지만 없던 사진은 빈 값으로 남겨 다시 읽지 않는다.
    @Published private(set) var metas: [String: PhotoMeta] = [:]
    private let url: URL
    private var sweeping = false

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        url = dir.appendingPathComponent("photo-meta.json")
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode([String: PhotoMeta].self, from: data) {
            metas = saved
        }
    }

    func camera(_ localId: String) -> String? { metas[localId]?.camera }

    /// 로컬 ID → 원본 파일 이름. 사진사별 파일명 규칙과 웹 기록 가져오기가 쓴다.
    @Published private(set) var names: [String: String] = [:]
    private var naming = false
    private var namesURL: URL { url.deletingLastPathComponent().appendingPathComponent("photo-names.json") }

    /// 파일 이름은 사진을 열지 않고 알 수 있어서 전부 훑는다
    func indexNames(_ localIds: [String]) {
        if names.isEmpty, let data = try? Data(contentsOf: namesURL),
           let saved = try? JSONDecoder().decode([String: String].self, from: data) {
            names = saved
        }
        guard !naming else { return }
        let todo = localIds.filter { names[$0] == nil }
        guard !todo.isEmpty else { return }
        naming = true
        Task.detached(priority: .utility) { [weak self] in
            var found: [String: String] = [:]
            var start = 0
            while start < todo.count {
                let chunk = Array(todo[start..<min(start + 500, todo.count)])
                start += 500
                PHAsset.fetchAssets(withLocalIdentifiers: chunk, options: nil).enumerateObjects { asset, _, _ in
                    if let name = PHAssetResource.assetResources(for: asset).first?.originalFilename {
                        found[asset.localIdentifier] = name
                    }
                }
            }
            let result = found
            await self?.mergeNames(result)
        }
    }

    private func mergeNames(_ found: [String: String]) {
        naming = false
        guard !found.isEmpty else { return }
        names.merge(found) { _, new in new }
        if let data = try? JSONEncoder().encode(names) { try? data.write(to: namesURL, options: .atomic) }
    }

    /// 아직 안 읽은 사진을 뒤에서 훑는다. iCloud 에만 있는 원본은 내려받지 않고 건너뛴다.
    func sweep(_ localIds: [String]) {
        guard !sweeping else { return }
        let todo = Array(localIds.filter { metas[$0] == nil }.prefix(400))
        guard !todo.isEmpty else { return }
        sweeping = true
        Task.detached(priority: .utility) { [weak self] in
            var batch: [String: PhotoMeta] = [:]
            for id in todo {
                batch[id] = Self.read(id, network: false) ?? PhotoMeta()
                if batch.count >= 40 {
                    let part = batch
                    batch = [:]
                    await self?.merge(part)
                }
            }
            let rest = batch
            await self?.merge(rest, done: true)
        }
    }

    /// 사진 한 장은 필요하면 내려받아서라도 읽는다
    func load(_ localId: String) async -> PhotoMeta? {
        if let m = metas[localId], m != PhotoMeta() { return m }
        let m = await Task.detached(priority: .userInitiated) { Self.read(localId, network: true) }.value
        if let m { merge([localId: m]) }
        return m
    }

    private func merge(_ part: [String: PhotoMeta], done: Bool = false) {
        if !part.isEmpty {
            metas.merge(part) { _, new in new }
            if let data = try? JSONEncoder().encode(metas) { try? data.write(to: url, options: .atomic) }
        }
        if done { sweeping = false }
    }

    nonisolated private static func read(_ localId: String, network: Bool) -> PhotoMeta? {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localId], options: nil).firstObject else { return nil }
        let o = PHImageRequestOptions()
        o.isSynchronous = true
        o.isNetworkAccessAllowed = network
        let box = DataBox()
        PHImageManager.default().requestImageDataAndOrientation(for: asset, options: o) { data, _, _, _ in box.data = data }
        guard let data = box.data, let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { return nil }
        let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
        let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
        var meta = PhotoMeta()
        let make = (tiff[kCGImagePropertyTIFFMake] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let model = (tiff[kCGImagePropertyTIFFModel] as? String ?? "").trimmingCharacters(in: .whitespaces)
        // 모델명이 제조사로 시작하면("Canon EOS R6") 제조사를 한 번 더 붙이지 않는다
        let camera = model.lowercased().hasPrefix(make.lowercased()) ? model : "\(make) \(model)".trimmingCharacters(in: .whitespaces)
        meta.camera = camera.isEmpty ? nil : camera
        meta.lens = exif[kCGImagePropertyExifLensModel] as? String
        var parts: [String] = []
        if let t = exif[kCGImagePropertyExifExposureTime] as? Double, t > 0 {
            parts.append(t >= 1 ? "\(Int(t.rounded()))s" : "1/\(Int((1 / t).rounded()))s")
        }
        if let f = exif[kCGImagePropertyExifFNumber] as? Double { parts.append("f/" + String(format: "%g", f)) }
        meta.exposure = parts.isEmpty ? nil : parts.joined(separator: " · ")
        meta.iso = (exif[kCGImagePropertyExifISOSpeedRatings] as? [Int])?.first
        return meta
    }
}

enum Avatars {
    /// 가운데를 정사각으로 잘라 줄인 JPEG. 프로필 사진·행사 로고 공용.
    static func square(_ image: UIImage, side: CGFloat) -> Data? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let short = min(image.size.width, image.size.height)
        guard short > 0 else { return nil }
        let scale = side / short
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
        return renderer.jpegData(withCompressionQuality: 0.85) { _ in
            image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
    }

    enum Failure: Error {
        case notFound, limited, network

        var text: String {
            switch self {
            case .notFound: return "그 아이디로 프로필 사진을 찾지 못했어요"
            case .limited: return "호출 한도에 걸렸어요. 설정에서 unavatar 키를 넣으면 풀립니다"
            case .network: return "프로필 사진을 받아오지 못했어요"
            }
        }
    }

    /// X 프로필 사진을 unavatar.io 에서 받는다. 보내는 것은 X 아이디뿐이다.
    static func fetch(x: String, force: Bool = false) async throws -> Data {
        // 한 번 받은 사진은 기기에 둔다 — 같은 아이디를 다시 물어 호출 한도를 쓰지 않게. 30일이 지나면 새로 받는다.
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("avatars")
        let file = dir.appendingPathComponent(x.lowercased() + ".jpg")
        if !force, let made = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.modificationDate] as? Date,
           Date().timeIntervalSince(made) < 30 * 86400, let cached = try? Data(contentsOf: file) {
            return cached
        }
        let fresh = try await download(x: x)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? fresh.write(to: file, options: .atomic)
        return fresh
    }

    private static func download(x: String) async throws -> Data {
        var c = URLComponents(string: "https://unavatar.io/x/\(x)")!
        c.queryItems = [URLQueryItem(name: "fallback", value: "false")]
        if let key = UserDefaults.standard.string(forKey: "fff.unavatar.pk"), !key.isEmpty {
            c.queryItems?.append(URLQueryItem(name: "token", value: key))
        }
        guard let url = c.url, let (data, resp) = try? await URLSession.shared.data(from: url) else { throw Failure.network }
        switch (resp as? HTTPURLResponse)?.statusCode {
        case 200: break
        case 404: throw Failure.notFound
        case 429: throw Failure.limited
        default: throw Failure.network
        }
        guard let image = UIImage(data: data), let small = square(image, side: 96) else { throw Failure.network }
        return small
    }
}
