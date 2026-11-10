import Photos
import UIKit

/// 웹 버전에서 옮겨 올 때 한 번 쓰는 도구. 옮기기가 끝나면 지워도 된다.
///
/// 이름·촬영 시각·지문으로도 짝을 못 찾은 웹 기록을, **드라이브에 있는 실제 사진**과 사진첩의 사진을
/// 그림으로 비교해서 찾는다.
///
/// 1. 먼저 지금까지의 방식으로 앨범 사진과 맞춘다.
/// 2. 남은 기록마다 드라이브에서 그 사진의 줄인 그림을 받는다. 웹 기록에 파일 ID 가 있어서 그 사진만 받는다.
///    구글 로그인 없이 받으므로, 드라이브 폴더가 "링크가 있는 모든 사용자"로 공유돼 있어야 한다.
/// 3. 그 그림을 세 범위와 차례로 비교한다. 앞에서 찾으면 뒤는 보지 않는다.
///    - **앨범의 사진 전부** — 이름·촬영 시각·해상도를 따지지 않는다. 웹 기록의 촬영 시각이 사진첩과 다르게
///      적혀 있거나(편집한 사진은 내보낸 시각이 적히기도 한다) 파일 이름이 바뀐 사진이 여기서 잡힌다.
///    - 사진첩 전체에서 해상도와 촬영 시각이 같은 사진
///    - 사진첩 전체에서 해상도가 같은 사진 (너무 많으면 건너뛴다)
/// 4. 정말 같은 그림일 때만 앨범에 넣고 기록을 붙인다. 연사처럼 닮은 사진이 여럿이면 이름이나 촬영 시각이
///    맞는 한 장으로 가려지고, 그래도 안 가려지면 붙이지 않는다.
enum DriveCheck {
    struct Outcome {
        /// 같은 사진을 찾아 기록을 붙였다
        var linked = 0
        /// 그중 앨범 안에서 찾은 것
        var inAlbum = 0
        /// 닮은 사진은 있지만 어느 것인지 가릴 수 없어서 붙이지 않았다
        var unsure = 0
        /// 같은 그림이 사진첩에 없다
        var missing = 0
        /// 드라이브에서 받지 못했다
        var failed = 0
    }

    enum Failure: Error {
        case notShared, noIds, notAlbum

        var text: String {
            switch self {
            case .notShared: return "드라이브에서 사진을 받지 못했어요. 폴더 공유가 \"링크가 있는 모든 사용자\"로 켜져 있는지 확인해 주세요."
            case .noIds: return "대기 중인 기록에 드라이브 파일 ID 가 없어요. 기록 가져오기로 웹 기록 파일을 다시 가져온 뒤에 해 주세요."
            case .notAlbum: return "폴더가 아니라 앨범을 골라야 넣을 수 있어요"
            }
        }
    }

    private enum Verdict {
        case same(PHAsset)
        case unsure
        case none
    }

    /// 그림 지문의 차이(256칸 중 다른 칸 수)가 이 안쪽이면 같은 그림으로 본다.
    /// 같은 사진을 크기만 줄인 것끼리는 보통 열 칸 안쪽, 연사의 옆 컷은 수십 칸이 난다.
    private static let same = 26
    /// 1등과 이만큼도 차이가 안 나는 사진은 "가릴 수 없는 후보"로 본다
    private static let gap = 8
    /// 해상도만으로 찾을 때 이보다 많으면 건너뛴다
    private static let wideLimit = 6000

    @MainActor
    static func run(web: WebImport, library: PhotoLibrary, store: CatalogStore, meta: MetaStore,
                    progress: @escaping @MainActor (String, Double?) -> Void) async throws -> Outcome {
        guard library.sourceIsAlbum else { throw Failure.notAlbum }
        progress("앨범 사진과 먼저 맞추는 중…", nil)
        await web.match(library: library, store: store, meta: meta)

        let targets = web.pending.filter { $0.fileId != nil }
        if targets.isEmpty {
            if web.pending.isEmpty { return Outcome() }
            throw Failure.noIds
        }

        progress("앨범 사진의 그림 지문을 만드는 중…", nil)
        let album = library.all
        let albumIds = Set(album.map(\.localIdentifier))
        let prints = PrintCache()
        let index = await Task.detached(priority: .userInitiated) { () -> LibraryIndex in
            prints.warm(album)
            return LibraryIndex()
        }.value

        var out = Outcome()
        var pairs: [(fileId: String, asset: PHAsset)] = []
        var used = Set<String>()
        for (n, p) in targets.enumerated() {
            progress("드라이브 사진과 비교하는 중… \(n + 1) / \(targets.count)", Double(n) / Double(targets.count))
            guard let fileId = p.fileId else { continue }
            guard let image = await download(fileId), let want = fingerprint(image) else {
                // 첫 장부터 안 받아지면 공유가 꺼져 있는 것이다
                if n == 0 { throw Failure.notShared }
                out.failed += 1
                continue
            }
            let probe = p.probe
            let taken = used
            let verdict = await Task.detached(priority: .userInitiated) { () -> Verdict in
                // 앨범 → 같은 해상도·시각 → 같은 해상도 순으로 넓혀 간다
                var sawUnsure = false
                let pools: [[PHAsset]?] = [album, index.candidates(probe), index.sameSize(probe, limit: wideLimit)]
                for pool in pools {
                    guard let pool else { continue }
                    switch judge(want, pool.filter { !taken.contains($0.localIdentifier) }, probe, prints) {
                    case .same(let asset): return .same(asset)
                    case .unsure: sawUnsure = true
                    case .none: break
                    }
                }
                return sawUnsure ? .unsure : .none
            }.value
            switch verdict {
            case .same(let asset):
                used.insert(asset.localIdentifier)
                pairs.append((fileId: fileId, asset: asset))
                if albumIds.contains(asset.localIdentifier) { out.inAlbum += 1 }
            case .unsure: out.unsure += 1
            case .none: out.missing += 1
            }
        }

        progress("앨범에 넣는 중…", nil)
        try await library.putInAlbum(pairs.map(\.asset))
        out.linked = web.attachVerified(pairs, library: library, store: store)
        return out
    }

    /// 드라이브의 줄인 그림. 공개 공유된 파일만 받아진다.
    private static func download(_ id: String) async -> UIImage? {
        let urls = [
            "https://drive.google.com/thumbnail?id=\(id)&sz=w640",
            "https://lh3.googleusercontent.com/d/\(id)=w640",
            "https://drive.google.com/uc?export=download&id=\(id)",
        ]
        for text in urls {
            guard let url = URL(string: text), let (data, response) = try? await URLSession.shared.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200, let image = UIImage(data: data)
            else { continue }
            return image
        }
        return nil
    }

    /// 후보 가운데 드라이브 그림과 같은 그림인 사진을 고른다
    private static func judge(_ want: [UInt64], _ pool: [PHAsset], _ probe: WebProbe, _ prints: PrintCache) -> Verdict {
        guard !pool.isEmpty else { return .none }
        prints.warm(pool)
        var scored: [(asset: PHAsset, distance: Int)] = []
        for asset in pool {
            guard let have = prints.get(asset) else { continue }
            scored.append((asset, zip(want, have).reduce(0) { $0 + ($1.0 ^ $1.1).nonzeroBitCount }))
        }
        scored.sort { $0.distance < $1.distance }
        guard let best = scored.first, best.distance <= same else { return .none }
        let close = scored.filter { $0.distance - best.distance < gap }
        if close.count == 1 { return .same(best.asset) }
        // 닮은 사진이 여럿(연사 등) — 이름이나 촬영 시각이 맞는 한 장이 있으면 그것으로 정한다
        let stamp = WebMatch.stamp()
        let backed = close.filter { c in
            if let shot = probe.shot, let made = c.asset.creationDate, WebMatch.sameShot(shot, stamp.string(from: made), stamp) { return true }
            if let name = PHAssetResource.assetResources(for: c.asset).first?.originalFilename, WebMatch.stem(name) == probe.stem { return true }
            return false
        }
        return backed.count == 1 ? .same(backed[0].asset) : .unsure
    }

    fileprivate static func thumbnail(_ asset: PHAsset) -> UIImage? {
        let o = PHImageRequestOptions()
        o.isSynchronous = true
        o.deliveryMode = .highQualityFormat
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = true
        let holder = ImageHolder()
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 320, height: 320), contentMode: .aspectFit, options: o) { image, _ in
            holder.image = image
        }
        return holder.image
    }

    /// 그림을 17×16 흑백으로 줄여, 옆 칸보다 밝은지 어두운지를 256칸으로 적는다.
    /// 크기를 줄이거나 다시 압축해도 거의 안 바뀌고, 다른 그림이면 크게 달라진다.
    fileprivate static func fingerprint(_ image: UIImage) -> [UInt64]? {
        let w = 17, h = 16
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
        else { return nil }
        ctx.interpolationQuality = .medium
        // 사진의 방향(세로로 찍은 사진 등)을 반영해서 그린다
        UIGraphicsPushContext(ctx)
        image.draw(in: CGRect(x: 0, y: 0, width: w, height: h))
        UIGraphicsPopContext()
        guard let data = ctx.data else { return nil }
        let pixels = data.bindMemory(to: UInt8.self, capacity: ctx.bytesPerRow * h)
        var bits = [UInt64](repeating: 0, count: 4)
        for y in 0..<h {
            for x in 0..<16 where pixels[y * ctx.bytesPerRow + x] < pixels[y * ctx.bytesPerRow + x + 1] {
                let i = y * 16 + x
                bits[i / 64] |= 1 << UInt64(i % 64)
            }
        }
        return bits
    }
}

private final class ImageHolder: @unchecked Sendable {
    var image: UIImage?
}

/// 사진첩 사진의 그림 지문. 한 번 만든 것은 이번 비교가 끝날 때까지 다시 만들지 않는다.
private final class PrintCache: @unchecked Sendable {
    private let lock = NSLock()
    private var prints: [String: [UInt64]] = [:]
    private var failed = Set<String>()

    func get(_ asset: PHAsset) -> [UInt64]? {
        lock.lock()
        defer { lock.unlock() }
        return prints[asset.localIdentifier]
    }

    /// 아직 없는 사진들의 지문을 여러 갈래로 한꺼번에 만든다
    func warm(_ assets: [PHAsset]) {
        lock.lock()
        let todo = assets.filter { prints[$0.localIdentifier] == nil && !failed.contains($0.localIdentifier) }
        lock.unlock()
        guard !todo.isEmpty else { return }
        DispatchQueue.concurrentPerform(iterations: todo.count) { i in
            let asset = todo[i]
            let made = DriveCheck.thumbnail(asset).flatMap(DriveCheck.fingerprint)
            lock.lock()
            if let made { prints[asset.localIdentifier] = made } else { failed.insert(asset.localIdentifier) }
            lock.unlock()
        }
    }
}

/// 사진첩 전체를 해상도·촬영 시각으로 찾아볼 수 있게 묶어 둔 것. 사진을 열지 않고 만들 수 있다.
private final class LibraryIndex: @unchecked Sendable {
    private var byMark: [String: [PHAsset]] = [:]
    private var bySize: [String: [PHAsset]] = [:]
    private let stamp = WebMatch.stamp()

    init() {
        let o = PHFetchOptions()
        o.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        PHAsset.fetchAssets(with: o).enumerateObjects { [self] asset, _, _ in
            let size = WebMatch.size(asset.pixelWidth, asset.pixelHeight)
            bySize[size, default: []].append(asset)
            if let made = asset.creationDate {
                byMark["\(size)|\(stamp.string(from: made).suffix(5))", default: []].append(asset)
            }
        }
    }

    /// 해상도와 촬영 시각이 그 웹 기록과 같은 사진들. 기록에 그 정보가 없으면 nil.
    func candidates(_ probe: WebProbe) -> [PHAsset]? {
        guard let size = probe.size, let shot = probe.shot else { return nil }
        return (byMark["\(size)|\(shot.suffix(5))"] ?? []).filter { asset in
            asset.creationDate.map { WebMatch.sameShot(shot, stamp.string(from: $0), stamp) } ?? false
        }
    }

    /// 해상도가 같은 사진 전부. 너무 많으면 nil.
    func sameSize(_ probe: WebProbe, limit: Int) -> [PHAsset]? {
        guard let size = probe.size else { return nil }
        let all = bySize[size] ?? []
        return all.count <= limit ? all : nil
    }
}
