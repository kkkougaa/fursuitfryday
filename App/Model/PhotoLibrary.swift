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
    /// 같은 사진인지는 두 가지로 본다:
    /// - 촬영 시각 + 해상도가 같다 (사진을 열지 않고 바로 알 수 있어서 빠르다)
    /// - 원본 파일 이름이 같다 (사진마다 따로 물어봐야 해서 느리다 — 그래서 웹 기록에 있는 촬영 날짜의
    ///   사진에만 물어본다. 촬영 시각이 없는 기록이 섞여 있으면 days 가 nil 이고 전부 물어본다)
    ///
    /// 여러 갈래로 나눠 동시에 훑고, 진행 상황(훑은 장수, 전체 장수)을 알려 준다.
    func addToAlbum(stems: Set<String>, shots: Set<String>, days: Set<String>?,
                    progress: @escaping @MainActor (Int, Int) -> Void) async throws -> (added: Int, scanned: Int) {
        guard let sourceId, PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject != nil
        else { throw AlbumError.notAlbum }
        let inAlbum = Set(all.map(\.localIdentifier))
        return try await Task.detached(priority: .userInitiated) {
            let o = PHFetchOptions()
            o.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
            let result = PHAsset.fetchAssets(with: o)
            let total = result.count
            let stamp = DateFormatter()
            stamp.locale = Locale(identifier: "en_US_POSIX")
            stamp.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
            let state = ScanState()
            let lanes = 8
            let size = max(1, (total + lanes - 1) / lanes)

            func sameName(_ asset: PHAsset) -> Bool {
                guard let name = PHAssetResource.assetResources(for: asset).first?.originalFilename else { return false }
                return stems.contains((name as NSString).deletingPathExtension.lowercased())
            }

            DispatchQueue.concurrentPerform(iterations: lanes) { lane in
                let lo = lane * size, hi = min(total, lo + size)
                guard lo < hi else { return }
                var mine: [PHAsset] = []
                var since = 0
                for i in lo..<hi {
                    let asset = result.object(at: i)
                    if !inAlbum.contains(asset.localIdentifier) {
                        if let shot = asset.creationDate {
                            let text = stamp.string(from: shot)
                            if shots.contains("\(text)|\(asset.pixelWidth)x\(asset.pixelHeight)") {
                                mine.append(asset)
                            } else if days?.contains(String(text.prefix(10))) ?? true, sameName(asset) {
                                mine.append(asset)
                            }
                        } else if days == nil, sameName(asset) {
                            mine.append(asset)
                        }
                    }
                    since += 1
                    if since == 200 || i == hi - 1 {
                        let seen = state.add(since)
                        since = 0
                        Task { @MainActor in progress(seen, total) }
                    }
                }
                state.collect(mine)
            }

            let found = state.hits
            guard !found.isEmpty else { return (0, total) }
            try await PHPhotoLibrary.shared().performChanges {
                guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [sourceId], options: nil).firstObject else { return }
                PHAssetCollectionChangeRequest(for: album)?.addAssets(found as NSArray)
            }
            return (found.count, total)
        }.value
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
