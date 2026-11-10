import Photos
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// 설정과 그 안의 화면들 — 테마, 홈 이름, 사람 관리, 카테고리·태그, 복사 템플릿, 기록 내보내기·가져오기

/// 설정 한 줄 — 색 네모 안의 아이콘, 제목, 오른쪽 값
private struct SettingLabel: View {
    let icon: String
    let color: String
    let title: String
    var value: String?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(TagColor.pair(color).text, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(title).font(.system(size: 16)).foregroundStyle(Tone.g900)
            Spacer(minLength: 8)
            if let value { Text(value).font(.system(size: 15)).foregroundStyle(Tone.g600).lineLimit(1) }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var meta: MetaStore
    @ObservedObject private var web = WebImport.shared
    @State private var theming = false
    @State private var naming = false
    @State private var choosingAlbum = false
    @State private var keying = false
    @State private var importing = false
    @State private var dropping = false
    /// 파일 고르기는 한 화면에 하나만 붙일 수 있어서, 무엇을 고르는지를 따로 둔다
    @State private var pickingPhotos = false
    @State private var busy: String?
    /// 0~1. nil 이면 얼마나 걸릴지 모르는 작업.
    @State private var fraction: Double?
    @State private var report: String?

    var body: some View {
        let o = store.catalog.opts
        List {
            Section("표시") {
                button("paintpalette.fill", "pink", "테마 색", Accent.name(o)) { theming = true }
                button("textformat", "blue", "홈 화면 이름", o.homeTitle.isEmpty ? "모아보기" : o.homeTitle) { naming = true }
                Toggle(isOn: Binding(get: { o.friday }, set: { on in store.edit { $0.opts.friday = on } })) {
                    SettingLabel(icon: "calendar.badge.clock", color: "amber", title: "금요일 블록")
                }
                .tint(Tone.green)
            }

            Section("사진") {
                button("rectangle.stack.fill", "teal", "사진첩 앨범", library.sourceTitle.isEmpty ? "고르기" : library.sourceTitle) {
                    choosingAlbum = true
                }
                button("folder.fill.badge.plus", "blue", "파일에서 사진 가져오기", nil) {
                    pickingPhotos = true
                    importing = true
                }
            }

            Section("사람과 퍼슈트") {
                link(.shooters, "camera.fill", "purple", "사진사", "\(store.catalog.shooters.filter { !$0.unknown }.count)명")
                link(.people, "pawprint.fill", "green", "같이 찍은 퍼슈트", "\(store.catalog.people.count)명")
            }

            Section("일정") {
                link(.packing, "bag.fill", "amber", "짐 챙기기 목록", "\(store.catalog.packing.count)개")
                link(.categories, "tag.fill", "red", "행사 카테고리", "\(store.catalog.eventTags.count)개")
                link(.careTags, "sparkles", "teal", "관리 태그", "\(store.catalog.careTags.count)개")
            }

            Section("태그와 복사") {
                link(.tagBrowse, "magnifyingglass", "blue", "태그로 찾기", nil)
                link(.tagManage, "number", "purple", "태그 관리", "\(store.catalog.tags.count)개")
                link(.copyTemplate, "doc.on.doc.fill", "green", "복사 템플릿", "해시태그 \(o.tags.count)개 · \(o.prefix)")
            }

            Section {
                button("square.and.arrow.up", "blue", "기록 내보내기", nil) { export() }
                button("square.and.arrow.down", "green", "기록 가져오기", nil) {
                    pickingPhotos = false
                    importing = true
                }
                if !web.pending.isEmpty {
                    button("clock.arrow.circlepath", "amber", "웹 기록 대기", "\(web.pending.count)장") { dropping = true }
                }
            } header: {
                Text("기록")
            } footer: {
                Text("기록은 이 기기에만 있고 아이폰 백업에 포함됩니다. 가져오기는 이 앱에서 내보낸 파일과 웹 버전의 기록 파일(fursuitfryday.catalog.json)을 모두 받습니다.")
            }

            Section {
                button("key.fill", "gray", "unavatar 키", (UserDefaults.standard.string(forKey: "fff.unavatar.pk") ?? "").isEmpty ? "없음" : "저장됨") {
                    keying = true
                }
            } header: {
                Text("키")
            } footer: {
                Text("버전 \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
            }
        }
        .listStyle(.insetGrouped)
        // 오래 걸리는 작업은 어디를 보고 있든 보이게 아래에 띄운다
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let busy {
                VStack(alignment: .leading, spacing: 10) {
                    Text(busy).font(.system(size: 15, weight: .bold).monospacedDigit()).foregroundStyle(Tone.g900)
                    if let fraction {
                        ProgressView(value: fraction).tint(Tone.blue)
                    } else {
                        ProgressView().frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .liquidGlassCard(cornerRadius: 22)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.25), value: busy == nil)
        .allowsHitTesting(busy == nil)
        .alert("끝났어요", isPresented: Binding(get: { report != nil }, set: { if !$0 { report = nil } })) {
            Button("확인") { report = nil }
        } message: {
            Text(report ?? "")
        }
        .navigationTitle("설정")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $theming) { ThemeSheet().presentationDetents([.medium, .large]) }
        .sheet(isPresented: $naming) { HomeNameSheet().presentationDetents([.medium]) }
        .sheet(isPresented: $choosingAlbum) { SetupView(firstRun: false) }
        // 키는 이 기기에만 둔다 — 기록 파일에는 넣지 않는다
        .namePrompt("unavatar 키", placeholder: "퍼블리셔블 키", action: "저장", isPresented: $keying) { key in
            UserDefaults.standard.set(key, forKey: "fff.unavatar.pk")
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: pickingPhotos ? [.image] : [.json],
                      allowsMultipleSelection: pickingPhotos) { result in
            guard case .success(let urls) = result, !urls.isEmpty else {
                toast("파일을 열지 못했어요")
                return
            }
            if pickingPhotos { importPhotos(urls) } else { load(urls[0]) }
        }
        .confirmationDialog("짝을 못 찾은 웹 기록 \(web.pending.count)장", isPresented: $dropping, titleVisibility: .visible) {
            Button("사진첩에서 찾아 앨범에 넣기") { findInLibrary() }
            Button("대기 기록 버리기", role: .destructive) { web.discardPending() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("웹 버전에서 가져온 사진 기록 가운데, 같은 파일 이름의 사진이 아직 앨범에 없는 것들입니다. 사진첩 어딘가에 그 사진이 있으면 이름으로 찾아 앨범에 넣을 수 있습니다. 앨범에 들어오면 기록이 저절로 붙습니다.")
        }
    }

    private func button(_ icon: String, _ color: String, _ title: String, _ value: String?, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { SettingLabel(icon: icon, color: color, title: title, value: value) }
    }

    private func link(_ route: Route, _ icon: String, _ color: String, _ title: String, _ value: String?) -> some View {
        NavigationLink(value: route) { SettingLabel(icon: icon, color: color, title: title, value: value) }
    }

    /// 사진첩 전체에서 웹 기록과 이름이 같은 사진을 찾아 앨범에 넣는다
    private func findInLibrary() {
        let waiting = web.pending.count
        busy = "사진첩에서 찾는 중…"
        fraction = 0
        Task {
            do {
                let result = try await library.addToAlbum(stems: web.pendingStems, shots: web.pendingShots, days: web.pendingDays) { seen, total in
                    busy = "사진첩에서 찾는 중… \(seen.formatted()) / \(total.formatted())"
                    fraction = total > 0 ? Double(seen) / Double(total) : nil
                }
                report = result.added > 0
                    ? "사진첩 \(result.scanned.formatted())장을 훑어 \(result.added)장을 \"\(library.sourceTitle)\" 앨범에 넣었어요. 기록은 잠시 뒤 저절로 붙습니다."
                    : "사진첩 \(result.scanned.formatted())장을 훑었지만 웹 기록 \(waiting)장과 같은 사진을 찾지 못했어요. 파일 이름도, 촬영 시각·해상도도 맞는 사진이 없습니다."
            } catch {
                report = (error as? PhotoLibrary.AlbumError)?.text ?? "앨범에 넣지 못했어요: \(error.localizedDescription)"
            }
            busy = nil
            fraction = nil
        }
    }

    /// 파일에서 고른 사진을 사진첩에 저장하고 앨범에 넣는다
    private func importPhotos(_ urls: [URL]) {
        busy = "사진 가져오는 중… 0 / \(urls.count)"
        fraction = 0
        Task {
            do {
                let done = try await library.importFiles(urls) { n in
                    busy = "사진 가져오는 중… \(n) / \(urls.count)"
                    fraction = Double(n) / Double(urls.count)
                }
                report = "\(done)장을 \"\(library.sourceTitle)\" 앨범에 넣었어요." + (done < urls.count ? " \(urls.count - done)장은 가져오지 못했어요." : "")
            } catch {
                report = (error as? PhotoLibrary.AlbumError)?.text ?? "사진을 가져오지 못했어요: \(error.localizedDescription)"
            }
            busy = nil
            fraction = nil
        }
    }

    /// 기록 파일을 공유 시트로 내보낸다 — 파일 앱·에어드롭·메일 어디로든
    private func export() {
        guard let data = try? Catalog.encode(store.catalog) else {
            toast("기록을 내보내지 못했어요")
            return
        }
        let name = "fursuitfryday-\(Day.today).json"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try data.write(to: url, options: .atomic)
            Share.present([url]) { _ in }
        } catch {
            toast("기록을 내보내지 못했어요")
        }
    }

    /// 이 앱의 기록 파일이면 합치고, 웹 버전의 기록 파일이면 옮겨 온다
    private func load(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            toast("파일을 읽지 못했어요")
            return
        }
        if WebImport.looksLikeWeb(data) {
            do {
                let summary = try web.run(data, store: store)
                let linked = web.match(library: library, store: store, meta: meta)
                toast("웹 기록을 가져왔어요 · \(summary) · 연결 \(linked)장")
            } catch {
                toast("웹 기록 파일을 읽지 못했어요")
            }
        } else if let other = try? Catalog.decode(data) {
            store.importNative(other)
            toast("기록을 합쳤어요 · 사진 \(other.photos.count)장")
        } else {
            toast("기록 파일이 아니에요")
        }
    }
}

struct ThemeSheet: View {
    @EnvironmentObject private var store: CatalogStore
    @State private var hex = ""

    var body: some View {
        let o = store.catalog.opts
        SheetBody(title: "테마 색") {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
                ForEach(Accent.presets, id: \.key) { preset in
                    Button {
                        store.edit { $0.opts.accent = preset.key }
                    } label: {
                        VStack(spacing: 6) {
                            Circle().fill(Color(uiColor: UIColor(hex: preset.hex))).frame(width: 44, height: 44)
                                .overlay {
                                    if o.accent == preset.key {
                                        Image(systemName: "checkmark").font(.system(size: 16, weight: .heavy)).foregroundStyle(.white)
                                    }
                                }
                            Text(preset.name).font(.system(size: 13, weight: .medium)).foregroundStyle(Tone.g800)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(o.accent == preset.key ? .isSelected : [])
                }
            }
            Field(label: "컬러 코드로 색 정하기", text: $hex, placeholder: "#FF6B9D", plain: true)
            if let value = Accent.parse(hex), !Accent.holdsWhite(value) {
                Text("흰 글자가 잘 안 보일 수 있는 밝은 색이에요. 조금 더 진한 색을 권해요.")
                    .font(.system(size: 13)).foregroundStyle(Tone.amberText)
            }
            Button("이 색으로") {
                guard let value = Accent.parse(hex) else {
                    toast("여섯 자리 컬러 코드가 아니에요.")
                    return
                }
                let text = String(format: "#%06X", value)
                store.edit { c in
                    c.opts.accent = "custom"
                    c.opts.accentHex = text
                }
                toast("테마 색을 \(text) 로 바꿨어요")
            }
            .buttonStyle(FillButtonStyle())
            .disabled(hex.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .onAppear { hex = o.accentHex }
        .sensoryFeedback(.selection, trigger: o.accent)
    }
}

struct HomeNameSheet: View {
    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var tab = ""

    var body: some View {
        SheetBody(title: "홈 화면 이름") {
            Field(label: "제목", text: $title, placeholder: "모아보기")
            Field(label: "탭 이름", text: $tab, placeholder: "비우면 제목을 씁니다")
            Button("저장") {
                store.edit { c in
                    c.opts.homeTitle = String(title.trimmingCharacters(in: .whitespaces).prefix(40))
                    c.opts.homeTab = String(tab.trimmingCharacters(in: .whitespaces).prefix(12))
                }
                toast("홈 이름을 바꿨어요")
                dismiss()
            }
            .buttonStyle(PrimaryButtonStyle())
        }
        .onAppear {
            title = store.catalog.opts.homeTitle
            tab = store.catalog.opts.homeTab
        }
    }
}

// MARK: 사진사 · 같이 찍은 퍼슈트

struct PeopleListView: View {
    enum Kind { case shooter, person }
    let kind: Kind

    struct Entry: Identifiable {
        let id: String
        let name: String
        let x: String?
        let role: String?
        let avatar: Data?
        let count: Int
        var pattern: String?
    }

    @EnvironmentObject private var store: CatalogStore
    @State private var editing: Entry?
    @State private var adding = false

    private var entries: [Entry] {
        let records = Array(store.catalog.photos.values)
        switch kind {
        case .shooter:
            return store.catalog.shooters.filter { !$0.unknown }.sorted { $0.name < $1.name }.map { s in
                Entry(id: s.id, name: s.name, x: s.x, role: nil, avatar: s.avatar, count: records.filter { $0.shooter == s.id }.count,
                      pattern: s.filePattern)
            }
        case .person:
            return store.catalog.people.sorted { $0.name < $1.name }.map { p in
                Entry(id: p.id, name: p.name, x: p.x, role: p.role, avatar: p.avatar, count: records.filter { $0.people.contains(p.id) }.count)
            }
        }
    }

    var body: some View {
        let label = kind == .shooter ? "사진사" : "퍼슈트"
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                if entries.isEmpty { EmptyNote(text: "아직 등록된 항목이 없어요.") }
                ForEach(entries) { e in
                    Button {
                        editing = e
                    } label: {
                        ListRow(title: e.name, sub: [e.role, e.x.map { "@\($0)" } ?? "X 아이디 입력하기"].compactMap { $0 }.joined(separator: " · "),
                                value: "\(e.count)장") {
                            Avatar(data: e.avatar, name: e.name)
                        }
                    }
                    .buttonStyle(.plain)
                }
                Button("새로 만들기") { adding = true }.buttonStyle(FillButtonStyle()).padding(.top, 12)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(Tone.bg)
        .navigationTitle(kind == .shooter ? "사진사" : "같이 찍은 퍼슈트")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { EntitySheet(kind: kind, entry: $0).presentationDetents([.medium, .large]) }
        .namePrompt("새 \(label)", isPresented: $adding) { name in
            if kind == .shooter { store.addShooter(name) } else { store.addPerson(name) }
        }
    }
}

struct EntitySheet: View {
    let kind: PeopleListView.Kind
    let entry: PeopleListView.Entry

    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var name = ""
    @State private var role = ""
    @State private var x = ""
    @State private var pattern = ""
    @State private var deleting = false

    /// 내 퍼슈트와 짝인 항목은 프로필의 퍼슈트 대장에서 지운다
    private var isMySuit: Bool { kind == .person && store.catalog.suits.contains { $0.personId == entry.id } }

    var body: some View {
        SheetBody(title: entry.name) {
            Field(label: "이름", text: $name)
            if kind == .person { Field(label: "역할 (선택)", text: $role, placeholder: "예: 주최") }
            Field(label: "X 아이디 (선택)", text: $x, placeholder: "@handle 또는 x.com/handle", plain: true)
            if kind == .shooter {
                // 이 사진사가 주는 파일 이름의 모양. 맞는 사진은 묻지 않고 이 사진사로 채운다.
                Field(label: "파일명 규칙 (선택)", text: $pattern, placeholder: "예: HARU_ 또는 *_haru*", plain: true)
            }
            Button("저장") { save(refetch: false) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            if let handle = entry.x, let url = URL(string: "https://x.com/\(handle)") {
                // 주소로 열면 X 앱이 있을 때 앱으로 넘어간다
                Button("X 에서 @\(handle) 열기") { openURL(url) }.buttonStyle(FillButtonStyle())
                Button("아바타 새로 받기") { save(refetch: true) }.buttonStyle(FillButtonStyle())
            }
            if !isMySuit {
                Button("목록에서 지우기") { deleting = true }
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.red)
                    .frame(maxWidth: .infinity).frame(height: 44)
            }
        }
        .confirm("\"\(entry.name)\" 지울까요?",
                 message: entry.count > 0 ? "이 \(kind == .shooter ? "사진사" : "퍼슈트")로 지정한 사진 \(entry.count)장에서 지정이 풀립니다. 사진과 사용 이력은 그대로 남습니다."
                     : "목록에서 사라집니다.",
                 action: "지우기", isPresented: $deleting) {
            remove()
            dismiss()
        }
        .onAppear {
            name = entry.name
            role = entry.role ?? ""
            x = entry.x ?? ""
            pattern = entry.pattern ?? ""
        }
    }

    /// 목록에서 지우고, 이 항목을 가리키던 사진·규칙에서도 뗀다
    private func remove() {
        let id = entry.id
        if kind == .shooter {
            let keys = store.catalog.photos.filter { $0.value.shooter == id }.map(\.key)
            store.update(keys) { $0.shooter = nil }
            store.edit { c in
                c.shooters.removeAll { $0.id == id }
                c.rules = c.rules.filter { $0.value != id }
            }
            store.markDeleted("shooters", id)
        } else {
            let keys = store.catalog.photos.filter { $0.value.people.contains(id) }.map(\.key)
            store.update(keys) { $0.people.removeAll { $0 == id } }
            store.edit { $0.people.removeAll { $0.id == id } }
            store.markDeleted("people", id)
        }
        toast("\"\(entry.name)\" 지웠어요")
    }

    private func save(refetch: Bool) {
        let title = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        let handle = normX(x)
        if !x.trimmingCharacters(in: .whitespaces).isEmpty, handle == nil {
            toast("X 아이디 형식이 아니에요 (영문·숫자·밑줄 15자)")
            return
        }
        let id = entry.id
        let isShooter = kind == .shooter
        let roleText = role.trimmingCharacters(in: .whitespaces)
        let rule = pattern.trimmingCharacters(in: .whitespaces)
        let setAvatar: (Data?) -> Void = { data in
            store.edit { c in
                if isShooter {
                    if let i = c.shooters.firstIndex(where: { $0.id == id }) { c.shooters[i].avatar = data }
                } else {
                    if let i = c.people.firstIndex(where: { $0.id == id }) { c.people[i].avatar = data }
                    // 내 퍼슈트와 짝인 항목이면 대장 쪽 사진도 같이 바꾼다
                    if let i = c.suits.firstIndex(where: { $0.personId == id }) { c.suits[i].avatar = data }
                }
            }
        }
        store.edit { c in
            if isShooter {
                if let i = c.shooters.firstIndex(where: { $0.id == id }) {
                    c.shooters[i].name = title
                    c.shooters[i].x = handle
                    c.shooters[i].filePattern = rule.isEmpty ? nil : rule
                }
            } else if let i = c.people.firstIndex(where: { $0.id == id }) {
                c.people[i].name = title
                c.people[i].x = handle
                c.people[i].role = roleText.isEmpty ? nil : roleText
                if let j = c.suits.firstIndex(where: { $0.personId == id }) {
                    c.suits[j].name = title
                    c.suits[j].x = handle
                }
            }
        }
        if handle == nil { setAvatar(nil) }
        if refetch || handle != entry.x { refreshAvatar(x: handle, force: refetch) { setAvatar($0) } }
        toast("저장했어요")
        dismiss()
    }
}

// MARK: 행사 카테고리 · 관리 태그 (색이 있는 이름표)

struct TagListView: View {
    let care: Bool

    @EnvironmentObject private var store: CatalogStore
    @State private var editing: EventTag?
    @State private var adding = false

    private var tags: [EventTag] { care ? store.catalog.careTags : store.catalog.eventTags }

    private func uses(_ name: String) -> Int {
        care ? store.catalog.suits.flatMap(\.log).filter { $0.kinds.contains(name) }.count
            : store.catalog.events.filter { $0.tags.contains(name) }.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                if tags.isEmpty { EmptyNote(text: "아직 없어요. 아래에서 만들어 보세요.") }
                ForEach(tags) { t in
                    Button {
                        editing = t
                    } label: {
                        HStack {
                            Pill(text: t.name, color: t.color)
                            Spacer()
                            Text(care ? "\(uses(t.name))번 쓰임" : "\(uses(t.name))건").font(.system(size: 14)).foregroundStyle(Tone.g600)
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.g400)
                        }
                        .frame(minHeight: 52)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                Button(care ? "태그 만들기" : "카테고리 만들기") { adding = true }.buttonStyle(FillButtonStyle()).padding(.top, 12)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(Tone.bg)
        .navigationTitle(care ? "관리 태그" : "행사 카테고리")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { TagEditSheet(care: care, tag: $0).presentationDetents([.medium]) }
        .namePrompt(care ? "태그 만들기" : "카테고리 만들기", placeholder: care ? "예: 세탁" : "이름", isPresented: $adding) { raw in
            let name = String(raw.replacingOccurrences(of: "#", with: "").prefix(care ? 20 : 16))
            guard !name.isEmpty else { return }
            if tags.contains(where: { $0.name == name }) {
                toast("같은 이름이 이미 있어요")
                return
            }
            let tag = EventTag(name: name, color: TagColor.names.randomElement() ?? "gray")
            store.edit { c in
                if care { c.careTags.append(tag) } else { c.eventTags.append(tag) }
                // 예전에 지운 이름을 다시 만들면 지운 표시를 거둔다
                c.deleted.removeAll { $0 == "\(care ? "careTags" : "eventTags"):\(name)" }
            }
        }
    }
}

struct TagEditSheet: View {
    let care: Bool
    let tag: EventTag

    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var color = "gray"
    @State private var deleting = false

    var body: some View {
        SheetBody(title: care ? "태그 편집" : "카테고리 편집") {
            Field(label: "이름", text: $name)
            VStack(alignment: .leading, spacing: 8) {
                Text("색").font(.system(size: 13, weight: .medium)).foregroundStyle(Tone.g700)
                HStack(spacing: 8) {
                    ForEach(TagColor.names, id: \.self) { c in
                        Button {
                            color = c
                        } label: {
                            Circle().fill(TagColor.pair(c).text).frame(width: 32, height: 32)
                                .overlay { if color == c { Image(systemName: "checkmark").font(.system(size: 13, weight: .heavy)).foregroundStyle(.white) } }
                                .frame(width: 40, height: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(c)
                        .accessibilityAddTraits(color == c ? .isSelected : [])
                    }
                }
                Pill(text: name.isEmpty ? tag.name : name, color: color)
            }
            Button("저장") { save() }.buttonStyle(PrimaryButtonStyle()).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            Button("지우기") { deleting = true }
                .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.red)
                .frame(maxWidth: .infinity).frame(height: 44)
        }
        .onAppear {
            name = tag.name
            color = tag.color
        }
        .confirm("\"\(tag.name)\" 을 지울까요?", message: care ? "이 태그가 붙은 기록에서 태그만 사라집니다. 기록 자체는 남습니다." : "이 카테고리가 붙은 일정에서도 함께 빠집니다.",
                 action: "지우기", isPresented: $deleting) {
            rename(to: nil)
            store.markDeleted(care ? "careTags" : "eventTags", tag.name)
            dismiss()
        }
    }

    private func save() {
        let new = String(name.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "").prefix(care ? 20 : 16))
        let list = care ? store.catalog.careTags : store.catalog.eventTags
        if new != tag.name, list.contains(where: { $0.name == new }) {
            toast("같은 이름이 이미 있어요")
            return
        }
        rename(to: EventTag(name: new, color: color))
        if new != tag.name { store.markDeleted(care ? "careTags" : "eventTags", tag.name) }
        dismiss()
    }

    /// 이름을 바꾸면 그 이름을 쓰던 곳도 따라 바꾼다. nil 이면 지운다.
    private func rename(to new: EventTag?) {
        let old = tag.name
        let isCare = care
        store.edit { c in
            func replace(_ names: inout [String]) {
                if let new {
                    names = names.map { $0 == old ? new.name : $0 }
                } else {
                    names.removeAll { $0 == old }
                }
            }
            if isCare {
                if let i = c.careTags.firstIndex(where: { $0.name == old }) {
                    if let new { c.careTags[i] = new } else { c.careTags.remove(at: i) }
                }
                for s in c.suits.indices { for l in c.suits[s].log.indices { replace(&c.suits[s].log[l].kinds) } }
            } else {
                if let i = c.eventTags.firstIndex(where: { $0.name == old }) {
                    if let new { c.eventTags[i] = new } else { c.eventTags.remove(at: i) }
                }
                for e in c.events.indices { replace(&c.events[e].tags) }
            }
        }
    }
}

// MARK: 자유 태그

/// 행사·사진사·퍼슈트·자유 태그 어느 것으로든 사진을 찾는다
struct TagBrowseView: View {
    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary

    var body: some View {
        let records = library.all.map { store.record(library.key(for: $0)) }
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                SectionHead("행사")
                ForEach(store.catalog.events.sorted { ($0.date ?? "") > ($1.date ?? "") }) { e in
                    link(e.name, records.filter { $0.event == e.id }.count, PhotoFilter(event: e.id))
                }
                SectionHead("사진사")
                ForEach(store.catalog.shooters.sorted { $0.name < $1.name }) { s in
                    link(s.name, records.filter { $0.shooter == s.id }.count, PhotoFilter(shooter: s.id))
                }
                SectionHead("같이 찍은 퍼슈트")
                ForEach(store.catalog.people.sorted { $0.name < $1.name }) { p in
                    link(p.name, records.filter { $0.people.contains(p.id) }.count, PhotoFilter(person: p.id))
                }
                SectionHead("자유 태그")
                if store.catalog.tags.isEmpty { EmptyNote(text: "아직 없어요.") }
                ForEach(store.catalog.tags, id: \.self) { t in
                    link("#\(t)", records.filter { $0.tags.contains(t) }.count, PhotoFilter(tag: t))
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Tone.bg)
        .navigationTitle("태그로 찾기")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func link(_ title: String, _ count: Int, _ filter: PhotoFilter) -> some View {
        NavigationLink(value: Route.photos(filter)) { ListRow(title, value: "\(count)장") }.buttonStyle(.plain)
    }
}

/// 자유 태그는 여기서만 만든다 — 사진에 달 때는 고르기만 해서 오타로 태그가 갈라지지 않는다
struct TagManageView: View {
    @EnvironmentObject private var store: CatalogStore
    @State private var removing: String?

    private func count(_ tag: String) -> Int { store.catalog.photos.values.filter { $0.tags.contains(tag) }.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                AddLine(placeholder: "새 태그") { raw in
                    let tag = String(raw.replacingOccurrences(of: "#", with: "").prefix(20))
                    guard !tag.isEmpty else { return }
                    if store.catalog.tags.contains(tag) {
                        toast("이미 있는 태그예요")
                    } else {
                        store.edit { c in
                            c.tags.append(tag)
                            c.deleted.removeAll { $0 == "tags:\(tag)" }
                        }
                        toast("\"\(tag)\" 태그를 만들었어요")
                    }
                }
                if store.catalog.tags.isEmpty { EmptyNote(text: "태그가 없어요") }
                FlowLayout(spacing: 8) {
                    ForEach(store.catalog.tags, id: \.self) { tag in
                        Chip(title: "\(tag) \(count(tag))") { removing = tag }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(Tone.bg)
        .navigationTitle("태그 관리")
        .navigationBarTitleDisplayMode(.inline)
        .confirm("\"\(removing ?? "")\" 태그를 지울까요?",
                 message: removing.map { count($0) > 0 ? "이 태그가 붙은 \(count($0))장에서도 함께 빠집니다." : "이 태그가 붙은 사진은 없습니다." },
                 action: "태그 삭제", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            if let tag = removing {
                let keys = store.catalog.photos.filter { $0.value.tags.contains(tag) }.map(\.key)
                store.update(keys) { $0.tags.removeAll { $0 == tag } }
                store.edit { $0.tags.removeAll { $0 == tag } }
                store.markDeleted("tags", tag)
            }
            removing = nil
        }
    }
}

// MARK: 복사 템플릿

struct CopyTemplateView: View {
    @EnvironmentObject private var store: CatalogStore

    var body: some View {
        let o = store.catalog.opts
        let sampleEvent = store.catalog.events.first?.name ?? "행사이름"
        let sampleShooter = store.catalog.shooters.first { $0.x != nil }
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                SwitchRow(title: "행사명을 해시태그로", sub: hashtagify(sampleEvent),
                          isOn: Binding(get: { o.eventTag }, set: { on in store.edit { $0.opts.eventTag = on } }))

                SectionHead("기본 해시태그")
                FlowLayout(spacing: 8) {
                    ForEach(o.tags, id: \.self) { tag in
                        Chip(title: "\(tag) ✕") { store.edit { $0.opts.tags.removeAll { $0 == tag } } }
                    }
                }
                AddLine(placeholder: "해시태그 추가") { raw in
                    let tag = hashtagify(raw)
                    guard !tag.isEmpty else { return }
                    if o.tags.contains(tag) { toast("이미 있어요") } else { store.edit { $0.opts.tags.append(tag) } }
                }

                SectionHead("작가 아이디 표기")
                Segmented(items: [SegItem(value: "#", title: "해시태그 #"), SegItem(value: "@", title: "멘션 @")],
                          selection: Binding(get: { o.prefix }, set: { v in store.edit { $0.opts.prefix = v } }))
                if o.prefix == "@" {
                    Text("인스타그램에서는 @ 가 실제 멘션이 되어 상대에게 알림이 갑니다.").font(.system(size: 13)).foregroundStyle(Tone.amberText)
                }

                SectionHead("미리보기")
                let preview = store.copyText(shooter: sampleShooter?.id, eventName: sampleEvent)
                Text(preview.isEmpty ? "복사할 텍스트가 없어요" : preview)
                    .font(.system(size: 15)).foregroundStyle(Tone.g800)
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Tone.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Tone.bg)
        .navigationTitle("복사 템플릿")
        .navigationBarTitleDisplayMode(.inline)
    }
}
