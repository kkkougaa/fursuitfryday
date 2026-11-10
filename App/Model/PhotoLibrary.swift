import Photos
import SwiftUI
import UIKit

/// 불러올 곳 후보 — 사진첩의 앨범 하나, 또는 앨범을 묶은 폴더 하나
struct SourceInfo: Identifiable {
    let id: String
    let title: String
    let isFolder: Bool
    /// 대략의 장수. 사진첩이 바로 알려주지 않으면 nil.
    let photoCount: Int?
}

/// 여러 갈래가 함께 쓰는 훑기 결과
private final class ScanState: @unchecked Sendable {
    private let lock = NSLock()
    private var seen = 0
    private(set) var hits: [PHAsset] = []
    /// 촬영 시각·해상도만 맞는 후보 ("시각|해상도" → 사진들)
    private(set) var loose: [String: [PHAsset]] = [:]

    func maybe(_ key: String, _ asset: PHAsset) {
        lock.lock()
        defer { lock.unlock() }
        loose[key, default: []].append(asset)
    }

    func add(_ n: Int) -> Int {
        lock.lock()
        defer { lock.unlock() }
        seen += n
        return seen
    }

    func collect(_ assets: [PHAsset]) {
        lock.lock()
        defer { lock.unlock() }
        hits += assets
    }
}

private final class Box<V>: @unchecked Sendable {
    var value: V
    init(_ value: V) { self.value = value }
}

/// 사진첩 읽기 전용 창구. 사진을 고치거나 지우지 않는다(앨범 만들기만 예외).
///
/// 행사 사진을 전부 모아 둔 앨범 하나를 고르면 그 안의 사진을 계속 따라간다.
/// 어느 행사 사진인지는 앨범이 아니라 앱의 기록(사진별 event)이 정한다.
@MainActor
final class PhotoLibrary: NSObject, ObservableObject, PHPhotoLibraryChangeObserver {
    @Published private(set) var status: PHAuthorizationStatus = .notDetermined
    @Published private(set) var sourceId: String?
    @Published private(set) var sourceTitle = ""
    /// 고른 앨범 안의 모든 사진
    @Published private(set) var all: [PHAsset] = []
    /// 로컬 ID → 기록 키
    @Published private(set) var keys: [String: String] = [:]

    private(set) var byId: [String: PHAsset] = [:]
    private let store: CatalogStore
    private let images = PHCachingImageManager()
    private var observing = false
    private var loading = false
    private var again = false
    private let keysURL: URL

    init(store: CatalogStore) {
        self.store = store
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        keysURL = dir.appendingPathComponent("keys.json")
        super.init()
        status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        sourceId = UserDefaults.standard.string(forKey: "fff.source")
        // 키 대응표를 저장해 둔다 — 없으면 켤 때마다 잠깐 모든 사진이 미분류로 보인다
        if let data = try? Data(contentsOf: keysURL), let saved = try? JSONDecoder().decode([String: String].self, from: data) {
            keys = saved
        }
        if status == .authorized {
            observe()
            reload()
        }
    }

    /// 전체 허용 + 앨범 선택까지 끝났는지. "선택한 사진만"으로는 앨범을 따라갈 수 없다.
    var isReady: Bool { status == .authorized && sourceId != nil }

    func requestAccess() async {
        status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        if status == .authorized {
            observe()
            reload()
        }
    }

    private func observe() {
        guard !observing else { return }
        observing = true
        PHPhotoLibrary.shared().register(self)
    }

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor in self.reload() }
    }

    // MARK: 불러올 곳

    nonisolated private static var imageOptions: PHFetchOptions {
        let o = PHFetchOptions()
        o.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        return o
    }

    nonisolated private static func albums(in list: PHCollectionList) -> [PHAssetCollection] {
        var out: [PHAssetCollection] = []
        PHCollection.fetchCollections(in: list, options: nil).enumerateObjects { c, _, _ in
            if let album = c as? PHAssetCollection { out.append(album) }
        }
        return out
    }

    nonisolated private static func assets(in album: PHAssetCollection) -> [PHAsset] {
        let result = PHAsset.fetchAssets(in: album, options: imageOptions)
        var out: [PHAsset] = []
        out.reserveCapacity(result.count)
        result.enumerateObjects { a, _, _ in out.append(a) }
        return out
    }

    /// 사진첩 맨 위에 있는 앨범과 폴더. 장수를 정확히 세면 사진이 많을 때 화면이 멈추므로
    /// 사진첩이 알고 있는 어림값만 쓰고, 그것도 뒤에서 읽는다.
    func sources() async -> [SourceInfo] {
        guard status == .authorized else { return [] }
        return await Task.detached(priority: .userInitiated) {
            func rough(_ album: PHAssetCollection) -> Int? {
                album.estimatedAssetCount == NSNotFound ? nil : album.estimatedAssetCount
            }
            var out: [SourceInfo] = []
            PHCollectionList.fetchTopLevelUserCollections(with: nil).enumerateObjects { c, _, _ in
                if let album = c as? PHAssetCollection {
                    out.append(SourceInfo(id: album.localIdentifier, title: album.localizedTitle ?? "이름 없는 앨범", isFolder: false,
                                          photoCount: rough(album)))
                } else if let list = c as? PHCollectionList {
                    let counts = Self.albums(in: list).map(rough)
                    out.append(SourceInfo(id: list.localIdentifier, title: list.localizedTitle ?? "이름 없는 폴더", isFolder: true,
                                          photoCount: counts.contains { $0 == nil } ? nil : counts.compactMap { $0 }.reduce(0, +)))
                }
            }
            return out
        }.value
    }

    func createAlbum(_ title: String) async throws -> String {
        let created = Box<String?>(nil)
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges({
                let req = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title)
                created.value = req.placeholderForCreatedAssetCollection.localIdentifier
            }, completionHandler: { ok, error in
                if ok {
                    c.resume()
                } else {
                    c.resume(throwing: error ?? CocoaError(.featureUnsupported))
                }
            })
        }
        guard let id = created.value else { throw CocoaError(.featureUnsupported) }
        return id
    }

    func choose(_ id: String) {
        sourceId = id
        UserDefaults.standard.set(id, forKey: "fff.source")
        reload()
    }

    // MARK: 불러오기

    /// 사진 목록은 뒤에서 읽는다 — 수천 장을 화면 쪽에서 훑으면 앱이 멈춘다.
    /// 읽는 중에 또 불리면 끝난 뒤 한 번만 더 읽는다.
    func reload() {
        guard status == .authorized, let sourceId else {
            all = []
            byId = [:]
            return
        }
        if loading {
            again = true
            return
        }
        loading = true
        Task.detached(priority: .userInitiated) { [weak self] in
            let (title, found) = Self.fetch(sourceId)
            await self?.finish(title, found)
        }
    }

    nonisolated private static func fetch(_ sourceId: String) -> (String, [PHAsset]) {
        if let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject {
            return (album.localizedTitle ?? "", assets(in: album))
        }
        if let list = PHCollectionList.fetchCollectionLists(withLocalIdentifiers: [sourceId], options: nil).firstObject {
            // 폴더를 골랐으면 그 안 앨범들의 사진을 한데 모은다
            return (list.localizedTitle ?? "", albums(in: list).flatMap { assets(in: $0) })
        }
        return ("", [])
    }

    private func finish(_ title: String, _ found: [PHAsset]) {
        loading = false
        sourceTitle = title
        var seen: [String: PHAsset] = [:]
        var flat: [PHAsset] = []
        for a in found where seen[a.localIdentifier] == nil {
            seen[a.localIdentifier] = a
            flat.append(a)
        }
        // 바뀐 게 없으면 화면을 다시 그리지 않는다
        if flat.map(\.localIdentifier) != all.map(\.localIdentifier) {
            byId = seen
            all = flat
        }
        resolveKeys()
        let ids = flat.map(\.localIdentifier)
        MetaStore.shared.indexNames(ids)
        MetaStore.shared.sweep(ids)
        if again {
            again = false
            reload()
        }
    }

    // MARK: 앨범에 넣기 (사진 자체는 고치지 않는다 — 앨범에 담기만 한다)

    enum AlbumError: Error {
        case notAlbum

        var text: String { "폴더가 아니라 앨범을 골라야 넣을 수 있어요" }
    }

    /// 사진첩 전체에서 웹 기록과 같은 사진을 찾아 고른 앨범에 넣는다. 이미 앨범에 있는 사진은 건너뛴다.
    ///
    /// 이름만 같다고 같은 사진이 아니다 — IMG_1234 같은 이름은 사진첩에 얼마든지 겹친다.
    /// 그래서 WebMatch 의 규칙(이름 + 해상도 + 촬영 시각)이 다 맞거나, 파일 지문(md5)이 같아야 넣는다.
    /// 촬영 시각이나 해상도가 없는 웹 기록은 확인할 길이 없어서 여기서는 찾지 않는다(skipped).
    ///
    /// 해상도와 촬영 시각(분·초)으로 먼저 걸러 낸 사진에만 파일 이름을 물어보므로 빠르다.
    func addToAlbum(probes: [WebProbe], progress: @escaping @MainActor (Int, Int) -> Void) async throws
        -> (added: Int, scanned: Int, skipped: Int) {
        guard let sourceId, PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject != nil
        else { throw AlbumError.notAlbum }
        let inAlbum = Set(all.map(\.localIdentifier))
        return try await Task.detached(priority: .userInitiated) {
            let usable = probes.filter { $0.shot != nil && $0.size != nil }
            var byStem: [String: [WebProbe]] = [:]
            var keyCount: [String: Int] = [:]
            var sizes = Set<String>()
            var marks = Set<String>()
            for p in usable {
                guard let shot = p.shot, let size = p.size else { continue }
                byStem[p.stem, default: []].append(p)
                keyCount["\(shot)|\(size)", default: 0] += 1
                sizes.insert(size)
                marks.insert(String(shot.suffix(5)))
            }
            let names = byStem
            let hashes = Set(usable.compactMap(\.md5))
            let counts = keyCount
            let knownSizes = sizes
            let knownMarks = marks

            let o = PHFetchOptions()
            o.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
            let result = PHAsset.fetchAssets(with: o)
            let total = result.count
            let stamp = WebMatch.stamp()
            let state = ScanState()
            let lanes = 8
            let width = max(1, (total + lanes - 1) / lanes)

            DispatchQueue.concurrentPerform(iterations: lanes) { lane in
                let lo = lane * width, hi = min(total, lo + width)
                guard lo < hi else { return }
                var since = 0
                for i in lo..<hi {
                    let asset = result.object(at: i)
                    since += 1
                    if since == 200 || i == hi - 1 {
                        let seen = state.add(since)
                        since = 0
                        Task { @MainActor in progress(seen, total) }
                    }
                    guard !inAlbum.contains(asset.localIdentifier), let made = asset.creationDate else { continue }
                    let size = WebMatch.size(asset.pixelWidth, asset.pixelHeight)
                    guard knownSizes.contains(size) else { continue }
                    let shot = stamp.string(from: made)
                    guard knownMarks.contains(String(shot.suffix(5))) else { continue }
                    // 여기까지 온 사진만 파일 이름을 물어본다
                    let stem = PHAssetResource.assetResources(for: asset).first.map { WebMatch.stem($0.originalFilename) }
                    if let stem, let same = names[stem], same.contains(where: { WebMatch.fits($0, stem: stem, shot: shot, size: size, stamp: stamp) }) {
                        state.collect([asset])
                    } else if counts["\(shot)|\(size)"] != nil {
                        // 이름은 다르지만 촬영 시각·해상도가 똑같다 — 저장하면서 이름이 바뀐 사진일 수 있다.
                        // 파일 지문으로 확인한다. 지문이 웹 기록에 있으면 같은 파일, 없으면 다른 사진(연사의 옆 컷 등)이다.
                        if !hashes.isEmpty, let hash = FileHasher.shared.md5(asset) {
                            if hashes.contains(hash) { state.collect([asset]) }
                        } else {
                            // 지문을 구할 수 없을 때만 예전 방식(장수 비교)으로 넘긴다
                            state.maybe("\(shot)|\(size)", asset)
                        }
                    }
                }
            }

            FileHasher.shared.save()
            // 이름이 바뀐 후보는, 같은 시각·해상도의 사진이 웹 기록 수보다 많으면(연사 등) 어느 것인지 알 수 없으니 넣지 않는다
            var found = state.hits
            for (key, assets) in state.loose where assets.count <= (counts[key] ?? 0) { found += assets }
            let chosen = found
            if !chosen.isEmpty {
                try await PHPhotoLibrary.shared().performChanges {
                    guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject else { return }
                    PHAssetCollectionChangeRequest(for: album)?.addAssets(chosen as NSArray)
                }
            }
            return (chosen.count, total, probes.count - usable.count)
        }.value
    }

    /// 앨범에서 빼기만 한다. 사진은 사진첩에 그대로 남는다.
    func removeFromAlbum(_ assets: [PHAsset]) async throws -> Int {
        guard let sourceId, PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject != nil
        else { throw AlbumError.notAlbum }
        guard !assets.isEmpty else { return 0 }
        try await PHPhotoLibrary.shared().performChanges {
            guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject else { return }
            PHAssetCollectionChangeRequest(for: album)?.removeAssets(assets as NSArray)
        }
        return assets.count
    }

    /// 파일(파일 앱·구글 드라이브 등)에서 고른 사진을 사진첩에 저장하고 고른 앨범에 넣는다.
    /// 파일 이름을 원본 이름으로 남겨서, 웹 기록과 이름으로 짝을 맞출 수 있게 한다.
    func importFiles(_ urls: [URL], progress: @escaping @MainActor (Int) -> Void) async throws -> Int {
        guard let sourceId, PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject != nil
        else { throw AlbumError.notAlbum }
        var done = 0
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            // 클라우드에 있는 파일은 여기서 내려받는다. 임시 폴더에 복사해 두고 그걸 넘긴다.
            let name = url.lastPathComponent
            let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + name)
            let copied = await Task.detached(priority: .userInitiated) { () -> Bool in
                guard let data = try? Data(contentsOf: url) else { return false }
                return (try? data.write(to: temp)) != nil
            }.value
            guard copied else { continue }
            let ok: Bool = await withCheckedContinuation { c in
                PHPhotoLibrary.shared().performChanges({
                    let options = PHAssetResourceCreationOptions()
                    options.originalFilename = name
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: .photo, fileURL: temp, options: options)
                    if let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject,
                       let placeholder = request.placeholderForCreatedAsset {
                        PHAssetCollectionChangeRequest(for: album)?.addAssets([placeholder] as NSArray)
                    }
                }, completionHandler: { success, _ in c.resume(returning: success) })
            }
            try? FileManager.default.removeItem(at: temp)
            if ok {
                done += 1
                progress(done)
            }
        }
        return done
    }

    /// 그 행사로 분류된 사진
    func assets(event id: String) -> [PHAsset] { all.filter { store.record(key(for: $0)).event == id } }

    // MARK: 기록 키

    /// 기기를 바꿔도 같은 사진을 가리키도록 클라우드 ID 를 쓴다. 아직 못 받았으면 로컬 ID 로 임시 키.
    func key(for asset: PHAsset) -> String { keys[asset.localIdentifier] ?? "local:" + asset.localIdentifier }

    private func resolveKeys() {
        let missing = all.map(\.localIdentifier).filter { keys[$0] == nil }
        guard !missing.isEmpty else { return }
        Task.detached(priority: .utility) { [weak self] in
            let map = PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: missing)
            var found: [String: String] = [:]
            for (local, result) in map {
                if case .success(let cloud) = result { found[local] = cloud.stringValue }
            }
            let resolved = found
            await self?.apply(resolved)
        }
    }

    private func apply(_ found: [String: String]) {
        guard !found.isEmpty else { return }
        // 임시 키로 남긴 기록이 있으면 클라우드 키로 옮긴다
        store.rekey(found.map { (from: "local:" + $0.key, to: $0.value) })
        keys.merge(found) { _, new in new }
        if let data = try? JSONEncoder().encode(keys) { try? data.write(to: keysURL, options: .atomic) }
    }

    // MARK: 이미지

    @discardableResult
    func thumbnail(_ asset: PHAsset, side: CGFloat, completion: @escaping (UIImage?) -> Void) -> PHImageRequestID {
        let o = PHImageRequestOptions()
        o.deliveryMode = .opportunistic
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = true
        let px = side * UIScreen.main.scale
        return images.requestImage(for: asset, targetSize: CGSize(width: px, height: px), contentMode: .aspectFill, options: o) { image, _ in
            completion(image)
        }
    }

    /// 공유·복사용 원본. iCloud 에만 있으면 내려받는다.
    func original(_ asset: PHAsset) async -> UIImage? {
        await withCheckedContinuation { (c: CheckedContinuation<UIImage?, Never>) in
            let o = PHImageRequestOptions()
            o.deliveryMode = .highQualityFormat
            o.isNetworkAccessAllowed = true
            o.version = .current
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: o) { data, _, _, _ in
                c.resume(returning: data.flatMap { UIImage(data: $0) })
            }
        }
    }

    /// 공유 시트에 넘길 JPEG 파일 — 어느 앱에서나 받게 한다
    func shareFile(_ asset: PHAsset) async -> URL? {
        guard let image = await original(asset), let data = image.jpegData(compressionQuality: 0.95) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("fursuitfryday-\(UUID().uuidString.prefix(8)).jpg")
        do {
            try data.write(to: url)
            return url
        } catch {
            return nil
        }
    }
}
