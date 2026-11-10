import PhotosUI
import SwiftUI

// 프로필 탭 — 내 프로필과 내 퍼슈트 대장(메이커·데뷔일·관리 기록). 착용 횟수는 행사 기록에서 센다.

struct ProfileView: View {
    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @State private var editingMe = false
    @State private var addingSuit = false
    @State private var bulk: Suit?

    var body: some View {
        let me = store.catalog.me
        let active = store.activeSuits.sorted { $0.name < $1.name }
        let retired = store.catalog.suits.filter { $0.retiredAt != nil }.sorted { $0.name < $1.name }

        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    editingMe = true
                } label: {
                    if me.nick.isEmpty && me.x == nil {
                        ListRow("내 프로필 설정하기", tint: Tone.blueText)
                    } else {
                        ListRow(title: me.nick.isEmpty ? "@\(me.x ?? "")" : me.nick, sub: me.x.map { "@\($0)" } ?? "X 아이디 없음") {
                            Avatar(data: me.avatar, name: me.nick.isEmpty ? (me.x ?? "") : me.nick, size: 56)
                        }
                    }
                }
                .buttonStyle(.plain)

                SectionHead(title: "내 퍼슈트", count: nil) {
                    if !active.isEmpty {
                        Button("퍼슈트 등록", systemImage: "plus") { addingSuit = true }
                            .labelStyle(.iconOnly).font(.system(size: 17, weight: .bold)).foregroundStyle(Tone.blueText)
                    }
                }
                if active.isEmpty {
                    VStack(spacing: 12) {
                        Text("퍼슈트를 등록해 보세요").font(.system(size: 16, weight: .bold)).foregroundStyle(Tone.g900)
                        Button("퍼슈트 등록") { addingSuit = true }.buttonStyle(PrimaryButtonStyle())
                    }
                    .padding(18)
                    .background(Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                ForEach(active) { row($0) }

                if !retired.isEmpty {
                    SectionHead("은퇴한 퍼슈트", count: "\(retired.count)")
                    ForEach(retired) { row($0).opacity(0.55) }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Tone.bg)
        .navigationTitle("프로필")
        .toolbarTitleDisplayMode(.inlineLarge)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.settings) { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("설정")
            }
        }
        .sheet(isPresented: $editingMe) { MeSheet().presentationDetents([.medium]) }
        .sheet(isPresented: $addingSuit) {
            SuitSheet(editing: nil) { created in
                // 쓰는 퍼슈트가 이것 하나뿐이면 물어볼 것이 없다 — 지금 있는 사진·행사에 한 번에 붙일지 묻는다
                if store.activeSuits.count == 1 { bulk = created }
            }
        }
        .confirm("지금 있는 것에 한 번에 붙일까요?",
                 message: "등록한 퍼슈트가 \"\(bulk?.name ?? "")\" 하나뿐이라, 아직 캐릭터가 없는 사진과 참가한 행사에 한 번에 기록합니다. 나중에 사진별로 바꿀 수 있어요.",
                 action: "전부 붙이기", isPresented: Binding(get: { bulk != nil }, set: { if !$0 { bulk = nil } })) {
            if let suit = bulk { tagEverything(suit) }
            bulk = nil
        }
    }

    private func row(_ s: Suit) -> some View {
        let wears = store.wears(s.id).count
        let open = s.log.filter { $0.doneAt == nil }.count
        return NavigationLink(value: Route.suit(s.id)) {
            ListRow(title: s.name, sub: [wears > 0 ? "\(wears)회 착용" : "기록 없음", s.maker].compactMap { $0 }.joined(separator: " · "),
                    value: open > 0 ? "할 일 \(open)" : nil) {
                Avatar(data: s.avatar, name: s.name, size: 56)
            }
        }
        .buttonStyle(.plain)
    }

    private func tagEverything(_ suit: Suit) {
        let mine = Set(store.catalog.suits.map(\.personId))
        let keys = library.all.map { library.key(for: $0) }.filter { key in !store.record(key).people.contains(where: mine.contains) }
        store.update(keys) { $0.people.append(suit.personId) }
        var events = 0
        store.edit { c in
            for i in c.events.indices where c.events[i].going && !c.events[i].suits.contains(suit.id) {
                c.events[i].suits.append(suit.id)
                events += 1
            }
        }
        toast("사진 \(keys.count)장 · 행사 \(events)개에 기록했어요")
    }
}

/// X 아이디를 고치면 프로필 사진을 새로 받는다. 실패해도 아이디는 저장된다.
@MainActor
func refreshAvatar(x: String?, force: Bool = false, apply: @escaping (Data) -> Void) {
    guard let x else { return }
    Task {
        do {
            let data = try await Avatars.fetch(x: x, force: force)
            apply(data)
        } catch {
            toast(((error as? Avatars.Failure)?.text ?? "프로필 사진을 받아오지 못했어요") + " 아이디는 저장돼요.")
        }
    }
}

struct MeSheet: View {
    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var nick = ""
    @State private var x = ""

    var body: some View {
        SheetBody(title: "내 프로필") {
            Field(label: "닉네임", text: $nick)
            Field(label: "X 아이디", text: $x, placeholder: "@handle 또는 x.com/handle", plain: true)
            Button("저장") {
                let handle = normX(x)
                if !x.trimmingCharacters(in: .whitespaces).isEmpty, handle == nil {
                    toast("X 아이디 형식이 아니에요 (영문·숫자·밑줄 15자)")
                    return
                }
                let changed = handle != store.catalog.me.x
                store.edit { c in
                    c.me.nick = String(nick.trimmingCharacters(in: .whitespaces).prefix(40))
                    c.me.x = handle
                    if handle == nil { c.me.avatar = nil }
                }
                if changed { refreshAvatar(x: handle) { data in store.edit { $0.me.avatar = data } } }
                toast("프로필을 저장했어요")
                dismiss()
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(nick.trimmingCharacters(in: .whitespaces).isEmpty && x.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .onAppear {
            nick = store.catalog.me.nick
            x = store.catalog.me.x ?? ""
        }
    }
}

// MARK: 퍼슈트 상세

struct SuitDetailView: View {
    let suitId: String

    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var addingCare = false
    @State private var editingCare: CareLog?
    @State private var deleting = false

    var body: some View {
        if let s = store.suit(suitId) {
            content(s)
        } else {
            EmptyNote(text: "지워진 퍼슈트예요")
        }
    }

    private func content(_ s: Suit) -> some View {
        let wears = store.wears(s.id)
        let photos = library.all.filter { store.record(library.key(for: $0)).people.contains(s.personId) }.count
        let lastWorn = wears.compactMap(\.date).filter { $0 <= Day.today }.max()
        let todo = s.log.filter { $0.doneAt == nil }.sorted { $0.at < $1.at }
        let done = s.log.filter { $0.doneAt != nil }.sorted { ($0.doneAt ?? "") > ($1.doneAt ?? "") }

        return ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 14) {
                    Avatar(data: s.avatar, name: s.name, size: 72)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.name).font(.system(size: 22, weight: .bold)).foregroundStyle(Tone.g900)
                        if let x = s.x { Text("@\(x)").font(.system(size: 14)).foregroundStyle(Tone.g600) }
                    }
                    Spacer()
                    Button("편집") { editing = true }
                        .font(.system(size: 14, weight: .bold)).foregroundStyle(Tone.blueText)
                        .padding(.horizontal, 14).frame(height: 40).background(Tone.blueFill, in: Capsule())
                        .buttonStyle(.plain)
                }

                HStack(spacing: 10) {
                    stat("착용 횟수", "\(wears.count)")
                    if photos > 0 {
                        NavigationLink(value: Route.photos(PhotoFilter(person: s.personId))) { stat("찍힌 사진", "\(photos)") }.buttonStyle(.plain)
                    } else {
                        stat("찍힌 사진", "0")
                    }
                }
                .padding(.top, 8)

                Card {
                    if let maker = s.maker { kv("메이커", maker) }
                    if let debut = s.debutAt {
                        let years = (Day.diff(debut, Day.today) ?? 0) / 365
                        kv("데뷔일", Day.dotted(debut) + (years >= 1 ? " · \(years + 1)년째" : ""))
                    }
                    if let birthday = s.birthday { kv("생일", birthdayText(birthday)) }
                    if let lastWorn { kv("마지막 착용", Day.dotted(lastWorn)) }
                    if s.maker == nil, s.debutAt == nil, s.birthday == nil, lastWorn == nil { kv("기록", "아직 없어요") }
                }
                if let memo = s.memo {
                    Text(memo).font(.system(size: 14)).foregroundStyle(Tone.g800)
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Tone.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                SectionHead(title: "관리 기록", count: nil) {
                    Button("기록 추가") { addingCare = true }.font(.system(size: 14, weight: .bold)).foregroundStyle(Tone.blueText)
                }
                if s.log.isEmpty { EmptyNote(text: "세탁하거나 수리한 것을 적어 두면 다음에 언제 해야 할지 알 수 있어요.") }
                ForEach(todo + done) { log in
                    Button {
                        editingCare = log
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                if log.kinds.isEmpty {
                                    Text("태그 없음").font(.system(size: 13)).foregroundStyle(Tone.g600)
                                } else {
                                    FlowLayout(spacing: 6) {
                                        ForEach(log.kinds, id: \.self) { Pill(text: $0, color: store.tagColor($0, care: true)) }
                                    }
                                }
                                if let note = log.note { Text(note).font(.system(size: 14)).foregroundStyle(Tone.g800) }
                            }
                            Spacer(minLength: 8)
                            Text(log.doneAt.map(Day.dotted) ?? "아직 안 함")
                                .font(.system(size: 13, weight: .bold)).foregroundStyle(log.doneAt == nil ? Tone.amberText : Tone.g600)
                        }
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }

                since(s, done, wears)

                VStack(spacing: 10) {
                    Button(s.retiredAt == nil ? "은퇴 처리" : "은퇴 취소") {
                        store.updateSuit(s.id) { $0.retiredAt = $0.retiredAt == nil ? Day.today : nil }
                        toast(s.retiredAt == nil ? "\"\(s.name)\" 은퇴 처리했어요" : "\"\(s.name)\" 다시 쓰기로 했어요")
                    }
                    .buttonStyle(FillButtonStyle())
                    Button("대장에서 지우기") { deleting = true }
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.red)
                        .frame(maxWidth: .infinity).frame(height: 48)
                }
                .padding(.top, 16)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Tone.bg)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editing) { SuitSheet(editing: s) { _ in } }
        .sheet(isPresented: $addingCare) { CareSheet(suitId: s.id, editing: nil) }
        .sheet(item: $editingCare) { CareSheet(suitId: s.id, editing: $0) }
        .confirm("\"\(s.name)\" 지울까요?",
                 message: photos > 0 ? "관리 기록은 사라지지만, 이 캐릭터로 지정한 사진 \(photos)장의 기록은 그대로 남습니다." : "관리 기록도 함께 사라집니다.",
                 action: "지우기", isPresented: $deleting) {
            store.edit { c in
                c.suits.removeAll { $0.id == s.id }
                for i in c.events.indices { c.events[i].suits.removeAll { $0 == s.id } }
            }
            store.markDeleted("suits", s.id)
            toast("\"\(s.name)\" 지웠어요")
            dismiss()
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 13)).foregroundStyle(Tone.g600)
            Text(value).font(.system(size: 24, weight: .bold)).foregroundStyle(Tone.g900)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func kv(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key).font(.system(size: 15)).foregroundStyle(Tone.g600)
            Spacer()
            Text(value).font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g900)
        }
        .frame(minHeight: 44)
    }

    /// "10월 24일 · 12일 뒤"
    private func birthdayText(_ day: String) -> String {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return Day.dotted(day) }
        let year = Int(Day.today.prefix(4)) ?? 2026
        var next = String(format: "%04d-%02d-%02d", year, p[1], p[2])
        if next < Day.today { next = String(format: "%04d-%02d-%02d", year + 1, p[1], p[2]) }
        let left = Day.diff(Day.today, next) ?? 0
        return "\(p[1])월 \(p[2])일 · " + (left == 0 ? "오늘이에요" : "\(left)일 뒤")
    }

    /// 지난 관리 이후 몇 번 입었는지 — 다음에 언제 해야 할지의 근거
    @ViewBuilder
    private func since(_ s: Suit, _ done: [CareLog], _ wears: [EventRecord]) -> some View {
        let kinds = Array(Set(done.flatMap(\.kinds))).sorted()
        let rows = kinds.compactMap { kind -> (String, Int)? in
            guard let last = done.filter({ $0.kinds.contains(kind) }).compactMap(\.doneAt).max() else { return nil }
            let n = wears.filter { ($0.date ?? "") >= last && ($0.date ?? "9999") <= Day.today }.count
            return n > 0 ? (kind, n) : nil
        }
        if !rows.isEmpty {
            SectionHead("지난 관리 이후")
            ForEach(rows, id: \.0) { kind, n in
                HStack {
                    Pill(text: kind, color: store.tagColor(kind, care: true))
                    Spacer()
                    Text("\(n)회 착용").font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g900)
                }
                .frame(minHeight: 40)
            }
        }
    }
}

// MARK: 퍼슈트 등록 · 편집

struct SuitSheet: View {
    let editing: Suit?
    let created: (Suit) -> Void

    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var x = ""
    @State private var maker = ""
    @State private var debutAt: String?
    @State private var birthday: String?
    @State private var memo = ""
    @State private var avatar: Data?
    @State private var picked = false
    @State private var item: PhotosPickerItem?

    var body: some View {
        SheetBody(title: editing == nil ? "퍼슈트 등록" : "퍼슈트 편집") {
            HStack(spacing: 14) {
                Avatar(data: avatar, name: name.isEmpty ? "?" : name, size: 64)
                VStack(alignment: .leading, spacing: 6) {
                    PhotosPicker(selection: $item, matching: .images) {
                        Text(avatar == nil ? "이미지 고르기" : "다른 이미지 고르기").font(.system(size: 14, weight: .bold)).foregroundStyle(Tone.blueText)
                    }
                    if avatar != nil {
                        Button("이미지 지우기") {
                            avatar = nil
                            picked = true
                        }
                        .font(.system(size: 14, weight: .bold)).foregroundStyle(Tone.g600)
                    }
                }
            }
            Field(label: "이름", text: $name, placeholder: "예: 라온")
            Field(label: "X 아이디 (선택)", text: $x, placeholder: "@handle 또는 x.com/handle", plain: true)
            Field(label: "메이커", text: $maker, placeholder: "예: 아무개 스튜디오")
            DayField(label: "데뷔일", day: $debutAt)
            DayField(label: "생일", day: $birthday)
            Field(label: "메모 (선택)", text: $memo, placeholder: "예: 헤드는 상단 선반, 바디는 옷장", multiline: true)
            Button(editing == nil ? "등록" : "저장") { save() }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .onAppear {
            guard let s = editing else { return }
            name = s.name
            x = s.x ?? ""
            maker = s.maker ?? ""
            debutAt = s.debutAt
            birthday = s.birthday
            memo = s.memo ?? ""
            avatar = s.avatar
        }
        .onChange(of: item) { _, new in
            guard let new else { return }
            Task {
                if let data = try? await new.loadTransferable(type: Data.self), let image = UIImage(data: data),
                   let small = Avatars.square(image, side: 96) {
                    avatar = small
                    picked = true
                } else {
                    toast("이미지를 처리하지 못했어요")
                }
                item = nil
            }
        }
    }

    private func save() {
        let title = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        let handle = normX(x)
        if !x.trimmingCharacters(in: .whitespaces).isEmpty, handle == nil {
            toast("X 아이디 형식이 아니에요 (영문·숫자·밑줄 15자)")
            return
        }
        func text(_ s: String, _ max: Int) -> String? {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : String(t.prefix(max))
        }
        let suitId: String
        let personId: String
        let oldX = editing?.x
        if let editing {
            suitId = editing.id
            personId = editing.personId
        } else {
            // 사진에 붙는 건 짝이 되는 '퍼슈트(사람)' 항목이다
            let person = Person(name: title)
            let suit = Suit(name: title, personId: person.id)
            suitId = suit.id
            personId = person.id
            store.edit { c in
                c.people.append(person)
                c.suits.append(suit)
            }
        }
        store.edit { c in
            if let i = c.suits.firstIndex(where: { $0.id == suitId }) {
                c.suits[i].name = title
                c.suits[i].x = handle
                c.suits[i].maker = text(maker, 40)
                c.suits[i].debutAt = debutAt
                c.suits[i].birthday = birthday
                c.suits[i].memo = text(memo, 300)
                c.suits[i].avatar = avatar
            }
            if let i = c.people.firstIndex(where: { $0.id == personId }) {
                c.people[i].name = title
                c.people[i].x = handle
                c.people[i].avatar = avatar
            }
        }
        // 직접 고른 이미지가 없을 때만 X 프로필 사진을 받는다
        if !picked, avatar == nil || handle != oldX {
            refreshAvatar(x: handle) { data in
                store.edit { c in
                    if let i = c.suits.firstIndex(where: { $0.id == suitId }) { c.suits[i].avatar = data }
                    if let i = c.people.firstIndex(where: { $0.id == personId }) { c.people[i].avatar = data }
                }
            }
        }
        if editing == nil {
            toast("\"\(title)\" 등록했어요")
            if let made = store.suit(suitId) { created(made) }
        } else {
            toast("저장했어요")
        }
        dismiss()
    }
}

// MARK: 관리 기록

struct CareSheet: View {
    let suitId: String
    let editing: CareLog?

    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var kinds: Set<String> = []
    @State private var note = ""
    @State private var done = false
    @State private var doneAt: String? = Day.today
    @State private var deleting = false

    var body: some View {
        SheetBody(title: editing == nil ? "관리 기록 추가" : "관리 기록") {
            VStack(alignment: .leading, spacing: 8) {
                Text("태그").font(.system(size: 13, weight: .medium)).foregroundStyle(Tone.g700)
                FlowLayout(spacing: 8) {
                    ForEach(store.catalog.careTags) { t in
                        Chip(title: t.name, on: kinds.contains(t.name)) {
                            if kinds.contains(t.name) { kinds.remove(t.name) } else { kinds.insert(t.name) }
                        }
                    }
                }
            }
            Field(label: "메모 (선택)", text: $note, placeholder: "예: 왼쪽 발 지퍼 터짐")
            VStack(alignment: .leading, spacing: 6) {
                Text("상태").font(.system(size: 13, weight: .medium)).foregroundStyle(Tone.g700)
                Segmented(items: [SegItem(value: false, title: "해야 함"), SegItem(value: true, title: "완료")], selection: $done)
            }
            if done { DayField(label: "한 날", day: $doneAt) }
            Button("저장") { save() }.buttonStyle(PrimaryButtonStyle())
            if editing != nil {
                Button("기록 지우기") { deleting = true }
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.red)
                    .frame(maxWidth: .infinity).frame(height: 44)
            }
        }
        .onAppear {
            guard let log = editing else { return }
            kinds = Set(log.kinds)
            note = log.note ?? ""
            done = log.doneAt != nil
            doneAt = log.doneAt ?? Day.today
        }
        .confirm("이 기록을 지울까요?", action: "지우기", isPresented: $deleting) {
            if let log = editing { store.updateSuit(suitId) { $0.log.removeAll { $0.id == log.id } } }
            dismiss()
        }
    }

    private func save() {
        var log = editing ?? CareLog()
        // 태그는 목록에 있는 순서대로 남긴다
        log.kinds = store.catalog.careTags.map(\.name).filter(kinds.contains)
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        log.note = text.isEmpty ? nil : String(text.prefix(120))
        log.doneAt = done ? (doneAt ?? Day.today) : nil
        let saved = log
        store.updateSuit(suitId) { s in
            if let i = s.log.firstIndex(where: { $0.id == saved.id }) { s.log[i] = saved } else { s.log.append(saved) }
        }
        toast(done ? "기록했어요" : "할 일에 담았어요")
        dismiss()
    }
}
