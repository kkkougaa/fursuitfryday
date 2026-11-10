import Photos
import SwiftUI
import UIKit

// 설정과 그 안의 화면들 — 테마, 홈 이름, 사람 관리, 카테고리·태그, 복사 템플릿

struct SettingsView: View {
    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @State private var theming = false
    @State private var naming = false
    @State private var choosingFolder = false
    @State private var keying = false

    var body: some View {
        let o = store.catalog.opts
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                SectionHead("표시")
                Button { theming = true } label: { ListRow("테마 색", value: Accent.name(o)) }.buttonStyle(.plain)
                Button { naming = true } label: {
                    ListRow("홈 화면 이름", value: o.homeTitle.isEmpty ? "모아보기" : o.homeTitle)
                }
                .buttonStyle(.plain)
                SwitchRow(title: "금요일 블록", isOn: Binding(get: { o.friday }, set: { on in store.edit { $0.opts.friday = on } }))

                SectionHead("사진첩과 백업")
                Button { choosingFolder = true } label: {
                    ListRow("사진첩 앨범", value: library.sourceTitle.isEmpty ? "고르기" : library.sourceTitle)
                }
                .buttonStyle(.plain)
                DropboxRow().padding(.top, 4)

                SectionHead("사람과 퍼슈트")
                NavigationLink(value: Route.shooters) { ListRow("사진사", value: "\(store.catalog.shooters.count)명") }.buttonStyle(.plain)
                NavigationLink(value: Route.people) { ListRow("같이 찍은 퍼슈트", value: "\(store.catalog.people.count)명") }.buttonStyle(.plain)

                SectionHead("일정")
                NavigationLink(value: Route.packing) { ListRow("짐 챙기기 목록", value: "\(store.catalog.packing.count)개") }.buttonStyle(.plain)
                NavigationLink(value: Route.categories) { ListRow("행사 카테고리", value: "\(store.catalog.eventTags.count)개") }.buttonStyle(.plain)
                NavigationLink(value: Route.careTags) { ListRow("관리 태그", value: "\(store.catalog.careTags.count)개") }.buttonStyle(.plain)

                SectionHead("태그와 복사")
                NavigationLink(value: Route.tagBrowse) { ListRow("태그로 찾기") }.buttonStyle(.plain)
                NavigationLink(value: Route.tagManage) { ListRow("태그 관리", value: "\(store.catalog.tags.count)개") }.buttonStyle(.plain)
                NavigationLink(value: Route.copyTemplate) {
                    ListRow("복사 템플릿", value: "해시태그 \(o.tags.count)개 · 작가 아이디 \(o.prefix)")
                }
                .buttonStyle(.plain)

                SectionHead("키")
                Button { keying = true } label: {
                    ListRow("unavatar 키", value: (UserDefaults.standard.string(forKey: "fff.unavatar.pk") ?? "").isEmpty ? "없음" : "저장됨")
                }
                .buttonStyle(.plain)

                Text("버전 \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                    .font(.system(size: 13)).foregroundStyle(Tone.g600)
                    .frame(maxWidth: .infinity).padding(.top, 24)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Tone.bg)
        .navigationTitle("설정")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $theming) { ThemeSheet().presentationDetents([.medium, .large]) }
        .sheet(isPresented: $naming) { HomeNameSheet().presentationDetents([.medium]) }
        .sheet(isPresented: $choosingFolder) { SetupView(firstRun: false) }
        // 키는 이 기기에만 둔다 — 기록 파일(드롭박스)에는 넣지 않는다
        .namePrompt("unavatar 키", placeholder: "퍼블리셔블 키", action: "저장", isPresented: $keying) { key in
            UserDefaults.standard.set(key, forKey: "fff.unavatar.pk")
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
    }

    @EnvironmentObject private var store: CatalogStore
    @State private var editing: Entry?
    @State private var adding = false

    private var entries: [Entry] {
        let records = Array(store.catalog.photos.values)
        switch kind {
        case .shooter:
            return store.catalog.shooters.filter { !$0.unknown }.sorted { $0.name < $1.name }.map { s in
                Entry(id: s.id, name: s.name, x: s.x, role: nil, avatar: s.avatar, count: records.filter { $0.shooter == s.id }.count)
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

    var body: some View {
        SheetBody(title: entry.name) {
            Field(label: "이름", text: $name)
            if kind == .person { Field(label: "역할 (선택)", text: $role, placeholder: "예: 주최") }
            Field(label: "X 아이디 (선택)", text: $x, placeholder: "@handle 또는 x.com/handle", plain: true)
            Button("저장") { save(refetch: false) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            if let handle = entry.x, let url = URL(string: "https://x.com/\(handle)") {
                // 주소로 열면 X 앱이 있을 때 앱으로 넘어간다
                Button("X 에서 @\(handle) 열기") { openURL(url) }.buttonStyle(FillButtonStyle())
                Button("아바타 새로 받기") { save(refetch: true) }.buttonStyle(FillButtonStyle())
            }
        }
        .onAppear {
            name = entry.name
            role = entry.role ?? ""
            x = entry.x ?? ""
        }
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
        if refetch || handle != entry.x { refreshAvatar(x: handle) { setAvatar($0) } }
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
