import Photos
import SwiftUI
import UIKit

/// 웹 버전에서 옮겨 올 때 한 번 쓰는 화면. 옮기기가 끝나면 DriveCheck 와 함께 지워도 된다.
///
/// 아직 짝을 못 찾은 웹 기록이 어떤 사진인지 드라이브의 줄인 그림으로 보여주고,
/// 고른 사진의 원본을 드라이브에서 받아 사진첩에 저장하고 앨범에 넣는다.
/// 받은 파일이 바로 그 기록의 사진이므로 기록도 그 자리에서 붙인다(대조가 필요 없다).
/// 구글 로그인 없이 받으므로 드라이브 폴더가 "링크가 있는 모든 사용자"로 공유돼 있어야 한다.
struct PendingSheet: View {
    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @ObservedObject private var web = WebImport.shared
    @Environment(\.dismiss) private var dismiss
    @State private var picked: Set<String> = []
    @State private var busy: String?
    @State private var fraction = 0.0
    @State private var report: String?

    /// 드라이브에서 받을 수 있는(파일 ID 가 있는) 기록
    private var fetchable: [WebImport.Pending] { web.pending.filter { $0.fileId != nil } }

    var body: some View {
        let items = web.pending
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("웹 기록 대기 \(items.count)장").font(.system(size: 22, weight: .bold)).foregroundStyle(Tone.g900)
                Spacer()
                Button(picked.count == fetchable.count && !picked.isEmpty ? "선택 해제" : "전체 선택") {
                    picked = picked.count == fetchable.count ? [] : Set(fetchable.compactMap(\.fileId))
                }
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Tone.blueText)
                .disabled(fetchable.isEmpty || busy != nil)
            }
            .padding(.horizontal, 20)
            .padding(.top, 32)
            .padding(.bottom, 12)

            ScrollView {
                if items.isEmpty { EmptyNote(text: "남은 기록이 없어요") }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 10) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, p in cell(p) }
                }
                .padding(.bottom, 16)
            }

            VStack(spacing: 10) {
                if let busy {
                    Text(busy).font(.system(size: 14, weight: .bold).monospacedDigit()).foregroundStyle(Tone.g800)
                    ProgressView(value: fraction).tint(Tone.blue)
                }
                Button(picked.isEmpty ? "받을 사진을 골라 주세요" : "\(picked.count)장 받아서 앨범에 넣기") { fetch() }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(picked.isEmpty || busy != nil)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(Tone.bg)
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(busy != nil)
        .alert("끝났어요", isPresented: Binding(get: { report != nil }, set: { if !$0 { report = nil } })) {
            Button("확인") {
                report = nil
                if web.pending.isEmpty { dismiss() }
            }
        } message: {
            Text(report ?? "")
        }
    }

    @ViewBuilder
    private func cell(_ p: WebImport.Pending) -> some View {
        let on = p.fileId.map(picked.contains) ?? false
        Button {
            guard let id = p.fileId else { return }
            if on { picked.remove(id) } else { picked.insert(id) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Color.clear.aspectRatio(1, contentMode: .fit)
                    .overlay {
                        if let id = p.fileId, let url = URL(string: "https://drive.google.com/thumbnail?id=\(id)&sz=w320") {
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let image): image.resizable().scaledToFill()
                                case .failure: Image(systemName: "eye.slash").font(.system(size: 20)).foregroundStyle(Tone.g400)
                                default: ProgressView()
                                }
                            }
                        } else {
                            Image(systemName: "questionmark").font(.system(size: 20)).foregroundStyle(Tone.g400)
                        }
                    }
                    .background(Tone.fill)
                    .clipped()
                    .overlay { if on { Rectangle().strokeBorder(Tone.blue, lineWidth: 3) } }
                    .overlay(alignment: .topTrailing) { if p.fileId != nil { SelectMark(on: on).padding(6) } }
                Text(p.name).font(.system(size: 11, weight: .medium)).foregroundStyle(Tone.g700).lineLimit(1).truncationMode(.middle)
                    .padding(.horizontal, 4)
                Text(p.shotAt.map { Day.dotted(String($0.prefix(10))) } ?? "촬영일 없음")
                    .font(.system(size: 11)).foregroundStyle(Tone.g600).padding(.horizontal, 4)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(p.fileId == nil || busy != nil)
        .accessibilityLabel(p.name + (on ? " 선택됨" : ""))
    }

    private func fetch() {
        guard library.sourceIsAlbum else {
            report = PhotoLibrary.AlbumError.notAlbum.text
            return
        }
        let targets = fetchable.filter { p in p.fileId.map(picked.contains) ?? false }
        busy = "받는 중… 0 / \(targets.count)"
        fraction = 0
        Task {
            var done = 0
            var failed = 0
            for (n, p) in targets.enumerated() {
                busy = "받는 중… \(n + 1) / \(targets.count)"
                fraction = Double(n) / Double(targets.count)
                guard let id = p.fileId, let data = await Self.original(id) else {
                    failed += 1
                    continue
                }
                let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + p.name)
                guard (try? data.write(to: temp)) != nil else {
                    failed += 1
                    continue
                }
                // 받은 파일이 곧 그 기록의 사진이다 — 저장한 사진에 기록을 바로 붙인다
                if let localId = await library.saveToAlbum(file: temp, name: p.name), web.attach(fileId: id, key: "local:" + localId, store: store) {
                    done += 1
                } else {
                    failed += 1
                }
                try? FileManager.default.removeItem(at: temp)
            }
            picked = []
            busy = nil
            report = "\(done)장을 받아 \"\(library.sourceTitle)\" 앨범에 넣고 기록을 붙였어요."
                + (failed > 0 ? "\n\(failed)장은 받지 못했어요. 드라이브 폴더 공유가 \"링크가 있는 모든 사용자\"로 켜져 있는지 확인해 주세요." : "")
        }
    }

    /// 드라이브의 원본 파일. 공개 공유된 파일만 받아진다. 받은 것이 그림이 아니면(로그인 안내 화면 등) 버린다.
    private static func original(_ id: String) async -> Data? {
        let urls = [
            "https://drive.usercontent.google.com/download?id=\(id)&export=download&confirm=t",
            "https://drive.google.com/uc?export=download&id=\(id)",
        ]
        for text in urls {
            guard let url = URL(string: text), let (data, response) = try? await URLSession.shared.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200, UIImage(data: data) != nil
            else { continue }
            return data
        }
        return nil
    }
}
