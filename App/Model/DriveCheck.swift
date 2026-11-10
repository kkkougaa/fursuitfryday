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
/// 3. 사진첩 **전체**에서 후보를 고른다 — 해상도와 촬영 시각이 같은 사진(사진을 내려받지 않고 알 수 있다).
/// 4. 후보의 줄인 그림과 드라이브 그림을 비교해, 정말 같은 그림일 때만 앨범에 넣고 기록을 붙인다.
enum DriveCheck {
    struct Outcome {
        /// 같은 사진을 찾아 기록을 붙였다
        var linked = 0
        /// 후보는 있었지만 같은 그림이라고 하기엔 애매해서 붙이지 않았다
        var unsure = 0
        /// 사진첩에 해상도·촬영 시각이 맞는 사진이 없다
        var missing = 0
        /// 드라이브에서 받지 못했다
        var failed = 0
        /// 촬영 정보가 없어 후보를 좁힐 수 없다
        var skipped = 0
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

    /// 그림 지문의 차이(256칸 중 다른 칸 수)가 이 안쪽이면 같은 그림으로 본다.
    /// 같은 사진을 크기만 줄인 것끼리는 보통 열 칸 안쪽, 연사의 옆 컷은 수십 칸이 난다.
    private static let same = 26
    /// 1등이 2등보다 이만큼은 가까워야 한다 — 연사 컷끼리 헷갈리지 않게
    private static let gap = 8

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

        progress("사진첩 목록을 읽는 중…", nil)
        let index = await Task.detached(priority: .userInitiated) { LibraryIndex() }.value

        var out = Outcome()
        var pairs: [(fileId: String, asset: PHAsset)] = []
        var used = Set<String>()
        for (n, p) in targets.enumerated() {
            progress("드라이브 사진과 비교하는 중… \(n + 1) / \(targets.count)", Double(n) / Double(targets.count))
            guard let fileId = p.fileId else { continue }
            guard let image = await download(fileId) else {
                // 첫 장부터 안 받아지면 공유가 꺼져 있는 것이다
                if n == 0 { throw Failure.notShared }
                out.failed += 1
                continue
            }
            guard let found = index.candidates(p.probe) else {
                out.skipped += 1
                continue
            }
            let pool = found.filter { !used.contains($0.localIdentifier) }
            if pool.isEmpty {
                out.missing += 1
                continue
            }
            let verdict = await Task.detached(priority: .userInitiated) { judge(image, pool) }.value
            if let asset = verdict {
                used.insert(asset.localIdentifier)
                pairs.append((fileId: fileId, asset: asset))
            } else {
                out.unsure += 1
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

    /// 후보 가운데 드라이브 그림과 같은 그림인 사진. 애매하면 nil.
    private static func judge(_ image: UIImage, _ pool: [PHAsset]) -> PHAsset? {
        guard let want = fingerprint(image) else { return nil }
        var scored: [(asset: PHAsset, distance: Int)] = []
        for asset in pool {
            guard let thumb = thumbnail(asset), let have = fingerprint(thumb) else { continue }
            scored.append((asset, zip(want, have).reduce(0) { $0 + ($1.0 ^ $1.1).nonzeroBitCount }))
        }
        scored.sort { $0.distance < $1.distance }
        guard let best = scored.first, best.distance <= same else { return nil }
        if scored.count > 1, scored[1].distance - best.distance < gap { return nil }
        return best.asset
    }

    private static func thumbnail(_ asset: PHAsset) -> UIImage? {
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
    private static func fingerprint(_ image: UIImage) -> [UInt64]? {
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

    /// 그 웹 기록과 같은 사진일 수 있는 사진들. 좁힐 방법이 없으면 nil.
    func candidates(_ probe: WebProbe) -> [PHAsset]? {
        guard let size = probe.size else { return nil }
        if let shot = probe.shot {
            return (byMark["\(size)|\(shot.suffix(5))"] ?? []).filter { asset in
                asset.creationDate.map { WebMatch.sameShot(shot, stamp.string(from: $0), stamp) } ?? false
            }
        }
        // 촬영 시각이 없는 기록은 같은 해상도의 사진을 다 본다. 너무 많으면 포기한다.
        let all = bySize[size] ?? []
        return all.count <= 1500 ? all : nil
    }
}
