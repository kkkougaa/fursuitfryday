import Photos
import SwiftUI
import UIKit

/// 행사 사진을 모아 둔 앨범 고르기 + 드롭박스 연결. 처음 켤 때와, 설정에서 앨범을 바꿀 때 쓴다.
struct SetupView: View {
    var firstRun = false

    @EnvironmentObject private var library: PhotoLibrary
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var folders: [SourceInfo] = []
    @State private var picked: String?
    @State private var naming = false
    @State private var name = "FursuitFriday"
    @State private var failure: String?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("행사 사진을 모아 둘\n앨범을 골라요")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(Tone.g900)
                        .padding(.top, firstRun ? 40 : 12)

                    switch library.status {
                    case .authorized:
                        folderList
                    case .notDetermined:
                        Button("사진 접근 허용") { Task { await library.requestAccess(); refresh() } }
                            .buttonStyle(PrimaryButtonStyle())
                    default:
                        // "선택한 사진만"이나 거부 상태. 앨범 구조를 읽으려면 전체 접근이 필요하다.
                        VStack(alignment: .leading, spacing: 12) {
                            Text("앨범을 읽으려면 사진 접근을 ‘전체 접근’으로 바꿔야 해요")
                                .font(.system(size: 15))
                                .foregroundStyle(Tone.g700)
                            Button("설정 열기") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                            }
                            .buttonStyle(PrimaryButtonStyle())
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("기록 백업")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Tone.g700)
                        DropboxRow()
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }

            Button(firstRun ? "시작하기" : "이 앨범으로 바꾸기") {
                if let picked { library.choose(picked) }
                if !firstRun { dismiss() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(picked == nil)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(Tone.bg)
        .onAppear {
            picked = library.sourceId
            refresh()
        }
        .onChange(of: library.status) { _, _ in refresh() }
        .alert("새 앨범", isPresented: $naming) {
            TextField("앨범 이름", text: $name)
            Button("만들기") { create() }
            Button("취소", role: .cancel) {}
        }
        .alert("앨범을 만들지 못했어요", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("확인") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var folderList: some View {
        VStack(spacing: 8) {
            ForEach(folders) { f in
                let on = picked == f.id
                Button {
                    picked = f.id
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: f.isFolder ? "folder" : "rectangle.stack")
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(on ? Tone.blueText : Tone.g600)
                            .frame(width: 44, height: 44)
                            .background(Tone.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(f.title)
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(Tone.g900)
                                .lineLimit(1)
                            Text((f.isFolder ? "폴더 · " : "") + "\(f.photoCount.formatted())장")
                                .font(.system(size: 13))
                                .foregroundStyle(Tone.g700)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: on ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 24))
                            .foregroundStyle(on ? Tone.blue : Tone.g400)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 72)
                    .background(on ? Tone.blueFill : Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }

            Button {
                naming = true
            } label: {
                Label("새 앨범 만들기", systemImage: "plus")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Tone.blueText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .frame(height: 52)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .sensoryFeedback(.selection, trigger: picked)
    }

    private func refresh() {
        folders = library.sources()
    }

    private func create() {
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        Task {
            do {
                picked = try await library.createAlbum(title)
                refresh()
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}

/// 드롭박스 연결 줄. 승인 화면을 열고, 거기 뜬 코드를 붙여넣어 연결한다.
struct DropboxRow: View {
    @EnvironmentObject private var dropbox: DropboxSync
    @Environment(\.openURL) private var openURL
    @State private var asking = false
    @State private var code = ""
    @State private var failure: String?

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "icloud")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Tone.g600)
                .frame(width: 44, height: 44)
                .background(Tone.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text("드롭박스")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Tone.g900)
                if case .failed(let why) = dropbox.phase {
                    Text(why).font(.system(size: 13)).foregroundStyle(Tone.amber).lineLimit(2)
                } else if let at = dropbox.lastSync {
                    Text("\(at.formatted(date: .omitted, time: .shortened)) 저장").font(.system(size: 13)).foregroundStyle(Tone.g700)
                }
            }
            Spacer(minLength: 8)
            if dropbox.appKey.isEmpty {
                Text("앱 키 없음").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.g600)
            } else if dropbox.linked {
                Menu {
                    Button("지금 동기화") { Task { await dropbox.sync() } }
                    Button("연결 끊기", role: .destructive) { dropbox.unlink() }
                } label: {
                    pill("연결됨", Tone.greenText)
                }
            } else {
                Button {
                    openURL(dropbox.authorizeURL())
                    asking = true
                } label: {
                    pill("연결", Tone.blueText)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .frame(minHeight: 72)
        .background(Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .alert("드롭박스 코드", isPresented: $asking) {
            TextField("승인 화면의 코드 붙여넣기", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("연결") {
                let value = code
                code = ""
                Task {
                    do {
                        try await dropbox.finish(code: value)
                    } catch {
                        failure = (error as? DropboxError)?.text ?? error.localizedDescription
                    }
                }
            }
            Button("취소", role: .cancel) { code = "" }
        }
        .alert("연결하지 못했어요", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("확인") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 16)
            .frame(height: 44)
            .background(Tone.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
