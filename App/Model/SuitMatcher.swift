import CoreGraphics
import Foundation
import Photos
import UIKit
import Vision

/// 퍼슈트 추천. 사람 얼굴 인식이 아니라 "겉모습이 닮았나"를 본다.
///
/// 1. 사진에서 피사체를 하나씩 떼어낸다 (iOS 17 피사체 분리 — 사람이든 인형이든 가리지 않는다)
/// 2. 떼어낸 조각마다 이미지 특징값을 뽑는다
/// 3. 퍼슈트를 한 명만 태그해 둔 사진을 그 퍼슈트의 본보기로 삼아, 가까운 순으로 추천한다
///
/// **"얼마나 가까워야 추천하나"를 숫자로 박아 두지 않는다.** 사진·조명·기기에 따라 거리의 눈금이
/// 달라서 고정 기준은 맞을 수가 없다. 대신 사용자가 태그해 둔 것에서 기준을 스스로 잡는다:
///
/// - **같은 퍼슈트끼리의 거리**를 잰다. 본보기마다 같은 퍼슈트의 가장 가까운 본보기까지의 거리를
///   모으면 "이 퍼슈트는 사진이 달라져도 이 정도까지는 벌어진다"가 나온다. 그 분포의 위쪽(90%)을
///   그 퍼슈트의 한계로 쓴다. 그래서 무늬가 뚜렷한 퍼슈트는 느슨하게, 비슷한 색이 많은 퍼슈트는
///   빡빡하게 저절로 맞는다.
/// - **2등과의 차이**를 본다. 1등 퍼슈트가 2등보다 뚜렷하게 가깝지 않으면(흰 늑대 둘처럼)
///   추천하지 않는다. 비율이라 눈금과 무관하다.
/// - **"아니야"를 기억한다.** 거절한 추천의 거리보다 먼 것은 그 퍼슈트로 다시 추천하지 않는다.
/// - 본보기가 모자라 한계를 못 잡는 동안에는 칩을 띄우지 않고, 고르는 목록의 **순서만** 닮은 순으로 바꾼다.
///   순서에는 기준이 필요 없다.
///
/// 전부 기기 안에서 돌고, 본보기는 이 기기에만 저장한다(기록 파일에는 넣지 않는다).
/// 자동으로 붙이지 않는다 — 추천만 하고 확정은 사람이 한다.
actor SuitMatcher {
    static let shared = SuitMatcher()

    struct Exemplar: Codable {
        var suitId: String
        var vector: Data
    }

    private struct Saved: Codable {
        var exemplars: [String: Exemplar] = [:]
        /// 퍼슈트 ID → 사용자가 거절한 추천들의 거리
        var rejected: [String: [Float]] = [:]
        /// "사진 키|퍼슈트 ID" — 이 사진에는 다시 묻지 않는다
        var refused: [String] = []
    }

    private static let perSuit = 24
    /// 한계를 잡는 데 필요한 최소 본보기 수
    private static let minSamples = 3
    /// 같은 퍼슈트 거리 분포에서 한계로 삼는 자리와 여유
    private static let quantile = 0.9
    private static let slack: Float = 1.15
    /// 1등이 2등보다 이 비율만큼은 가까워야 한다
    private static let margin: Float = 0.92
    /// 한계를 아직 못 잡았을 때는 2등과의 차이가 훨씬 커야만 추천한다
    private static let coldMargin: Float = 0.75

    private var saved = Saved()
    private var limits: [String: Float] = [:]
    private var pooledLimit: Float?
    private var queryCache: [String: [[Float]]] = [:] // 로컬 ID → 조각별 특징값
    private let url: URL
    private var loaded = false

    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        url = dir.appendingPathComponent("suit-exemplars.plist")
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let data = try? Data(contentsOf: url), let old = try? PropertyListDecoder().decode(Saved.self, from: data) {
            saved = old
        }
        calibrate()
    }

    private func save() {
        let e = PropertyListEncoder()
        e.outputFormat = .binary
        if let data = try? e.encode(saved) { try? data.write(to: url, options: .atomic) }
    }

    // MARK: 본보기

    /// 본보기를 지금 태그 상태에 맞춘다. singles = 퍼슈트가 정확히 한 명 태그된 사진들.
    func reindex(_ singles: [(key: String, localId: String, suitId: String)]) {
        load()
        var changed = false
        let wanted = Dictionary(singles.map { ($0.key, $0.suitId) }, uniquingKeysWith: { a, _ in a })
        for (key, ex) in saved.exemplars where wanted[key] != ex.suitId {
            saved.exemplars[key] = nil
            changed = true
        }
        var counts: [String: Int] = [:]
        for ex in saved.exemplars.values { counts[ex.suitId, default: 0] += 1 }
        for s in singles where saved.exemplars[s.key] == nil {
            guard counts[s.suitId, default: 0] < Self.perSuit else { continue }
            // 한 명만 태그된 사진에서는 가장 큰 피사체가 그 퍼슈트라고 본다
            guard let vector = prints(s.localId).first else { continue }
            saved.exemplars[s.key] = Exemplar(suitId: s.suitId, vector: Self.pack(vector))
            counts[s.suitId, default: 0] += 1
            changed = true
        }
        if changed {
            calibrate()
            save()
        }
    }

    /// 같은 퍼슈트끼리 얼마나 벌어지는지에서 퍼슈트별 한계를 잡는다
    private func calibrate() {
        var bySuit: [String: [[Float]]] = [:]
        for ex in saved.exemplars.values { bySuit[ex.suitId, default: []].append(Self.unpack(ex.vector)) }
        limits = [:]
        var pooled: [Float] = []
        for (suit, vectors) in bySuit where vectors.count >= 2 {
            var nearest: [Float] = []
            for (i, v) in vectors.enumerated() {
                var best = Float.greatestFiniteMagnitude
                for (j, w) in vectors.enumerated() where i != j && v.count == w.count { best = min(best, Self.distance(v, w)) }
                if best < .greatestFiniteMagnitude { nearest.append(best) }
            }
            pooled += nearest
            if nearest.count >= Self.minSamples { limits[suit] = Self.high(nearest) * Self.slack }
        }
        // 본보기가 적은 퍼슈트는 다른 퍼슈트들에서 본 평균적인 벌어짐을 빌려 쓴다
        pooledLimit = pooled.count >= Self.minSamples ? Self.high(pooled) * Self.slack : nil
        // 거절당한 거리보다 먼 것은 다시 추천하지 않는다
        for (suit, distances) in saved.rejected {
            guard let floor = distances.min() else { continue }
            limits[suit] = min(limits[suit] ?? pooledLimit ?? floor, floor * 0.98)
        }
    }

    private static func high(_ values: [Float]) -> Float {
        let sorted = values.sorted()
        return sorted[min(sorted.count - 1, Int((Double(sorted.count - 1) * quantile).rounded()))]
    }

    // MARK: 추천

    /// 조각 하나에 대해, 퍼슈트별 가장 가까운 본보기까지의 거리를 가까운 순으로
    private func ranking(_ part: [Float]) -> [(suit: String, distance: Float)] {
        var best: [String: Float] = [:]
        for ex in saved.exemplars.values {
            let v = Self.unpack(ex.vector)
            guard v.count == part.count else { continue }
            let d = Self.distance(part, v)
            if d < best[ex.suitId, default: .greatestFiniteMagnitude] { best[ex.suitId] = d }
        }
        return best.map { (suit: $0.key, distance: $0.value) }.sorted { $0.distance < $1.distance }
    }

    /// 이 사진에 있을 법한 퍼슈트 ID. 조각(피사체)마다 따로 판단하므로 여럿이 나올 수 있다.
    func suggest(localId: String, key: String, excluding: [String], limit: Int = 2) -> [String] {
        load()
        guard !saved.exemplars.isEmpty else { return [] }
        var out: [(suit: String, distance: Float)] = []
        for part in prints(localId) {
            let ranked = ranking(part)
            guard let top = ranked.first, !excluding.contains(top.suit), !saved.refused.contains("\(key)|\(top.suit)") else { continue }
            let runnerUp = ranked.dropFirst().first?.distance
            if let cap = limits[top.suit] ?? pooledLimit {
                // 한계 안쪽이고, 2등보다 뚜렷이 가깝다
                guard top.distance <= cap else { continue }
                if let runnerUp, top.distance > runnerUp * Self.margin { continue }
            } else {
                // 한계를 아직 모른다 — 비교할 2등이 있고 차이가 아주 클 때만
                guard let runnerUp, top.distance <= runnerUp * Self.coldMargin else { continue }
            }
            if !out.contains(where: { $0.suit == top.suit }) { out.append(top) }
        }
        return out.sorted { $0.distance < $1.distance }.prefix(limit).map(\.suit)
    }

    /// 닮은 순서. 고르는 목록을 이 순서로 세운다 — 기준 없이도 쓸 수 있다.
    func order(localId: String) -> [String] {
        load()
        var best: [String: Float] = [:]
        for part in prints(localId) {
            for r in ranking(part) where r.distance < best[r.suit, default: .greatestFiniteMagnitude] { best[r.suit] = r.distance }
        }
        return best.sorted { $0.value < $1.value }.map(\.key)
    }

    /// 사용자가 "아니야"라고 한 추천. 이 사진에는 다시 묻지 않고, 그 거리부터는 이 퍼슈트로 추천하지 않는다.
    func reject(localId: String, key: String, suitId: String) {
        load()
        saved.refused.append("\(key)|\(suitId)")
        let distances = prints(localId).compactMap { part in ranking(part).first { $0.suit == suitId }?.distance }
        if let nearest = distances.min() { saved.rejected[suitId, default: []].append(nearest) }
        calibrate()
        save()
    }

    // MARK: 특징값

    /// 사진 속 피사체 조각(큰 순서로 최대 3개)의 특징값. 조각을 못 떼면 사진 전체로 한다.
    private func prints(_ localId: String) -> [[Float]] {
        if let cached = queryCache[localId] { return cached }
        guard let image = Self.image(localId) else { return [] }
        var out: [[Float]] = []
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        let mask = VNGenerateForegroundInstanceMaskRequest()
        if (try? handler.perform([mask])) != nil, let found = mask.results?.first {
            var pieces: [(area: Int, buffer: CVPixelBuffer)] = []
            for index in found.allInstances {
                if let buffer = try? found.generateMaskedImage(ofInstances: IndexSet(integer: index), from: handler,
                                                               croppedToInstancesExtent: true) {
                    pieces.append((area: CVPixelBufferGetWidth(buffer) * CVPixelBufferGetHeight(buffer), buffer: buffer))
                }
            }
            for piece in pieces.sorted(by: { $0.area > $1.area }).prefix(3) {
                if let v = Self.featurePrint(VNImageRequestHandler(cvPixelBuffer: piece.buffer, options: [:])) { out.append(v) }
            }
        }
        if out.isEmpty, let v = Self.featurePrint(handler) { out.append(v) }
        if queryCache.count > 200 { queryCache.removeAll() }
        queryCache[localId] = out
        return out
    }

    private static func featurePrint(_ handler: VNImageRequestHandler) -> [Float]? {
        let request = VNGenerateImageFeaturePrintRequest()
        guard (try? handler.perform([request])) != nil, let obs = request.results?.first, obs.elementType == .float else { return nil }
        var v = obs.data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        // 길이를 1 로 맞춘다 — 사진마다 값의 크기가 달라도 방향만 비교하게
        let norm = sqrt(v.reduce(0) { $0 + $1 * $1 })
        if norm > 0 { for i in v.indices { v[i] /= norm } }
        return v
    }

    private static func distance(_ a: [Float], _ b: [Float]) -> Float {
        var sum: Float = 0
        for i in a.indices {
            let d = a[i] - b[i]
            sum += d * d
        }
        return sqrt(sum)
    }

    private static func pack(_ v: [Float]) -> Data { v.withUnsafeBufferPointer { Data(buffer: $0) } }

    private static func unpack(_ d: Data) -> [Float] { d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) } }

    /// 분석용 작은 이미지(긴 변 약 640px). 백그라운드에서 동기로 받는다.
    private static func image(_ localId: String) -> CGImage? {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localId], options: nil).firstObject else { return nil }
        let o = PHImageRequestOptions()
        o.isSynchronous = true
        o.deliveryMode = .highQualityFormat
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = true
        let holder = Holder()
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 640, height: 640), contentMode: .aspectFit, options: o) { image, _ in
            holder.image = image?.cgImage
        }
        return holder.image
    }
}

private final class Holder: @unchecked Sendable {
    var image: CGImage?
}
