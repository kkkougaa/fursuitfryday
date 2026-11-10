import Photos
import PhotosUI
import SwiftUI

// 일정 탭. 행사 = 일정 — 여기서 만든 일정이 사진 분류에도 바로 쓰인다.

private func ddayTone(_ e: EventRecord) -> (text: Color, fill: Color) {
    if !e.going { return (Tone.g600, Tone.fill) }
    if e.isLive { return (Tone.greenText, Tone.greenFill) }
    if case .before(let n) = e.phase, n <= 7 { return (Tone.amberText, Tone.amberFill) }
    return (Tone.blueText, Tone.blueFill)
}

/// 약속 한 줄
struct SubRow: View {
    let event: EventRecord
    let sub: SubItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(sub.time ?? "--:--")
                .font(.system(size: 14, weight: .bold).monospacedDigit())
                .foregroundStyle(Tone.g700)
                .frame(width: 48, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(sub.title).font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g900)
                let meta = [event.dayIndex(sub.day).map { "\($0)일차" }, sub.place].compactMap { $0 }.joined(separator: " · ")
                if !meta.isEmpty { Text(meta).font(.system(size: 13)).foregroundStyle(Tone.g600) }
                if let note = sub.note { Text(note).font(.system(size: 13)).foregroundStyle(Tone.g600).lineLimit(2) }
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// 홈과 일정 탭 맨 위의 디데이 카드. 진행 중 > 다가오는 확정 > 다가오는 미정 순으로 하나를 잡는다.
struct DdayCard: View {
    @EnvironmentObject private var store: CatalogStore
    @State private var open = false
    @State private var adding = false
    @State private var addingSub = false

    var body: some View {
        if let e = store.catalog.events.next {
            let tone = ddayTone(e)
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    NavigationLink(value: Route.event(e.id)) {
                        HStack(spacing: 12) {
                            if let logo = e.logo { Avatar(data: logo, name: e.name, size: 40, round: false) }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.isLive ? "● 행사 진행 중" : (e.going ? "다음 행사" : "참가 미정"))
                                    .font(.system(size: 13, weight: .bold)).foregroundStyle(tone.text)
                                Text(e.name).font(.system(size: 18, weight: .bold)).foregroundStyle(Tone.g900).lineLimit(1)
                                Text([e.range, e.place, e.prep.isEmpty ? nil : "사전 준비 \(e.prepDone)/\(e.prep.count)"]
                                    .compactMap { $0 }.joined(separator: " · "))
                                    .font(.system(size: 13)).foregroundStyle(Tone.g700).lineLimit(2)
                            }
                            Spacer(minLength: 8)
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(e.dday.big).font(.system(size: e.isLive ? 22 : 28, weight: .bold)).foregroundStyle(tone.text)
                                if let sub = e.dday.sub { Text(sub).font(.system(size: 12, weight: .medium)).foregroundStyle(tone.text) }
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    IconButton(symbol: open ? "chevron.up" : "chevron.down", label: open ? "접기" : "펼치기", color: tone.text) {
                        withAnimation(.snappy(duration: 0.25)) { open.toggle() }
                    }
                }
                if open {
                    let ahead = e.aheadSub
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("잡아둔 약속").font(.system(size: 14, weight: .bold)).foregroundStyle(Tone.g900)
                            Spacer()
                            Text(ahead.isEmpty ? "없음" : "\(ahead.count)건").font(.system(size: 13)).foregroundStyle(Tone.g700)
                        }
                        .padding(.top, 10)
                        ForEach(ahead.prefix(5)) { SubRow(event: e, sub: $0) }
                        if ahead.count > 5 { Text("+\(ahead.count - 5)건 더").font(.system(size: 13)).foregroundStyle(Tone.g700) }
                        HStack(spacing: 10) {
                            Button("약속 추가") { addingSub = true }.buttonStyle(FillButtonStyle())
                            NavigationLink(value: Route.checklist(e.id)) {
                                Text("체크리스트 \(e.prep.isEmpty ? "설정" : "\(e.prepDone)/\(e.prep.count)")")
                                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g800)
                                    .frame(maxWidth: .infinity).frame(height: 48)
                                    .background(Tone.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.top, 6)
                    }
                }
            }
            .padding(.leading, 18)
            .padding(.trailing, 8)
            .padding(.vertical, 14)
            .background(tone.fill, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .sheet(isPresented: $addingSub) { SubSheet(eventId: e.id, editing: nil).presentationDetents([.large]) }
        } else {
            Button {
                adding = true
            } label: {
                HStack {
                    Text("다음 행사를 등록해 주세요").font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g800)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.g400)
                }
                .padding(.horizontal, 18)
                .frame(height: 56)
                .background(Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $adding) { EventSheet(editing: nil) }
        }
    }
}

struct ScheduleView: View {
    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @State private var adding = false
    @State private var category: String?
    @State private var todoOpen = false

    var body: some View {
        let all = store.catalog.events.filter { category == nil || $0.tags.contains(category!) }
        let dated = all.filter { $0.date != nil }
        let upcoming = dated.filter { if case .after = $0.phase { return false } else { return true } }.sorted { ($0.date ?? "") < ($1.date ?? "") }
        let past = dated.filter { if case .after = $0.phase { return true } else { return false } }.sorted { ($0.date ?? "") > ($1.date ?? "") }
        let undated = all.filter { $0.date == nil }

        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                DdayCard()
                todos

                SectionHead(title: "다가오는 일정", count: nil) {
                    Menu {
                        ForEach(store.catalog.eventTags) { t in Button(t.name) { category = t.name } }
                        if category != nil { Button("전체 보기", systemImage: "xmark") { category = nil } }
                    } label: {
                        Text(category.map { "\($0) ✕" } ?? "카테고리")
                            .font(.system(size: 13, weight: .bold)).foregroundStyle(category == nil ? Tone.g700 : Tone.blueText)
                            .padding(.horizontal, 12).frame(height: 32)
                            .background(category == nil ? Tone.fill : Tone.blueFill, in: Capsule())
                    }
                    .disabled(store.catalog.eventTags.isEmpty)
                }
                if upcoming.isEmpty {
                    EmptyNote(text: category == nil ? "다가오는 일정이 없어요." : "이 카테고리에 해당하는 다가오는 일정이 없어요.")
                }
                ForEach(upcoming) { row($0, upcoming: true) }

                if !undated.isEmpty {
                    SectionHead("날짜 미정", count: "\(undated.count)")
                    ForEach(undated) { row($0, upcoming: false) }
                }
                if !past.isEmpty {
                    SectionHead("지난 일정", count: "\(past.count)")
                    ForEach(past) { row($0, upcoming: false) }
                }

                Button("일정 추가") { adding = true }.buttonStyle(FillButtonStyle()).padding(.top, 10)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Tone.bg)
        .navigationTitle("일정")
        .toolbarTitleDisplayMode(.inlineLarge)
        .sheet(isPresented: $adding) { EventSheet(editing: nil) }
    }

    private func row(_ e: EventRecord, upcoming: Bool) -> some View {
        let photos = library.assets(event: e.id)
        let tone = ddayTone(e)
        return NavigationLink(value: Route.event(e.id)) {
            HStack(spacing: 14) {
                if let logo = e.logo {
                    Avatar(data: logo, name: e.name, size: 56, round: false)
                } else if let cover = photos.first {
                    Thumb(asset: cover, side: 56).frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                } else {
                    Avatar(data: nil, name: e.name, size: 56, round: false)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(e.name).font(.system(size: 16, weight: .bold)).foregroundStyle(Tone.g900).lineLimit(1)
                    Text([e.range, e.place, photos.isEmpty ? nil : "사진 \(photos.count)장"].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 13)).foregroundStyle(Tone.g600).lineLimit(1)
                    HStack(spacing: 6) {
                        if !e.going { Pill(text: "미정") }
                        ForEach(e.tags, id: \.self) { Pill(text: $0, color: store.tagColor($0)) }
                        if !e.sub.isEmpty { Pill(text: "약속 \(e.sub.count)") }
                        if upcoming, !e.prep.isEmpty {
                            let done = e.prepDone == e.prep.count
                            Pill(text: done ? "준비 완료" : "준비 \(e.prepDone)/\(e.prep.count)", color: done ? "green" : "gray")
                        }
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(e.dday.big).font(.system(size: 17, weight: .bold)).foregroundStyle(upcoming ? tone.text : Tone.g600)
                    if let sub = e.dday.sub { Text(sub).font(.system(size: 11)).foregroundStyle(tone.text) }
                }
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: 할 일

    /// 행사에 묶이지 않은 할 일 + 행사 체크리스트에서 핀을 꽂은 항목
    private var todos: some View {
        let pinned = store.catalog.events.flatMap { e in e.prep.filter(\.pin).map { (e, $0) } }
        let free = store.catalog.todos.sorted { $0.at < $1.at }
        let left = free.filter { !$0.done }.count + pinned.filter { !$0.1.done }.count
        let total = free.count + pinned.count
        return Card {
            Button {
                withAnimation(.snappy(duration: 0.25)) { todoOpen.toggle() }
            } label: {
                HStack {
                    Text("할 일").font(.system(size: 16, weight: .bold)).foregroundStyle(Tone.g900)
                    Text(total == 0 ? "없음" : (left == 0 ? "다 했어요" : "\(left)개 남음")).font(.system(size: 13)).foregroundStyle(Tone.g600)
                    Spacer()
                    Image(systemName: todoOpen ? "chevron.up" : "chevron.down").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.g400)
                }
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if todoOpen {
                // 안 한 것 먼저
                ForEach(free.filter { !$0.done } + free.filter(\.done)) { t in
                    CheckRow(text: t.text, done: t.done) {
                        store.edit { c in
                            if let i = c.todos.firstIndex(where: { $0.id == t.id }) { c.todos[i].done.toggle() }
                        }
                    } trailing: {
                        IconButton(symbol: "xmark", label: "할 일 지우기") {
                            store.edit { $0.todos.removeAll { $0.id == t.id } }
                            store.markDeleted("todos", t.id)
                        }
                    }
                }
                ForEach(pinned, id: \.1.id) { e, item in
                    CheckRow(text: item.text, done: item.done, sub: e.name) {
                        store.updateEvent(e.id) { ev in
                            if let i = ev.prep.firstIndex(where: { $0.id == item.id }) { ev.prep[i].done.toggle() }
                        }
                    } trailing: {
                        IconButton(symbol: "bookmark.fill", label: "고정 떼기", color: Tone.blueText) {
                            store.updateEvent(e.id) { ev in
                                if let i = ev.prep.firstIndex(where: { $0.id == item.id }) { ev.prep[i].pin = false }
                            }
                            toast("고정을 뗐어요")
                        }
                    }
                }
                AddLine(placeholder: "단순 할 일 추가") { text in
                    store.edit { $0.todos.append(Todo(text: String(text.prefix(60)))) }
                }
                .padding(.vertical, 8)
            }
        }
    }
}

// MARK: 행사 상세

struct EventDetailView: View {
    let eventId: String

    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var meta: MetaStore
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var deleting = false
    @State private var addingSub = false
    @State private var editingSub: SubItem?
    @State private var addingCategory = false
    @State private var logoItem: PhotosPickerItem?
    @State private var review: Review?
    @State private var addingShooter: [PHAsset]?

    /// 여러 장을 훑어보고 사진사나 퍼슈트를 붙이는 작업
    struct Review: Identifiable {
        let id = UUID()
        let title: String
        let assets: [PHAsset]
        var preselected: Set<String>?
        let shooterId: String?
        let personId: String?
    }

    var body: some View {
        if let e = store.event(eventId) {
            content(e)
        } else {
            EmptyNote(text: "삭제된 일정입니다.")
        }
    }

    private func record(_ a: PHAsset) -> PhotoRecord { store.record(library.key(for: a)) }

    private func content(_ e: EventRecord) -> some View {
        let photos = library.assets(event: e.id)
        let tone = ddayTone(e)

        return ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 14) {
                    Avatar(data: e.logo, name: e.name, size: 64, round: false)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.name).font(.system(size: 22, weight: .bold)).foregroundStyle(Tone.g900)
                        Text([e.range, e.place].compactMap { $0 }.joined(separator: " · ")).font(.system(size: 14)).foregroundStyle(Tone.g600)
                        Text([e.dday.big, e.dday.sub].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 14, weight: .bold)).foregroundStyle(tone.text)
                    }
                }

                Card {
                    SwitchRow(title: e.going ? "참가 확정" : "참가 미정",
                              sub: e.going ? "홈 화면에 디데이로 올라갑니다" : "홈 디데이는 확정된 행사부터 보여줍니다",
                              isOn: Binding(get: { e.going }, set: { on in
                                  store.updateEvent(e.id) { $0.going = on }
                                  toast(on ? "참가 확정으로 바꿨어요" : "참가 미정으로 바꿨어요")
                              }))
                }
                if let note = e.note {
                    Text(note).font(.system(size: 14)).foregroundStyle(Tone.g800)
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Tone.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                subs(e)

                NavigationLink(value: Route.checklist(e.id)) {
                    HStack {
                        Text("체크리스트").font(.system(size: 16, weight: .bold))
                        Spacer()
                        Text(e.prep.isEmpty ? "설정" : "\(e.prepDone)/\(e.prep.count)").font(.system(size: 15, weight: .bold))
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(Tone.blueText)
                    .padding(.horizontal, 18).frame(height: 56)
                    .background(Tone.blueFill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.top, 8)

                categories(e)
                if !photos.isEmpty { shooters(e, photos) }
                if !store.catalog.suits.isEmpty { suits(e, photos) }

                SectionHead("이 행사 사진", count: "\(photos.count)장")
                if photos.isEmpty {
                    EmptyNote(text: "사진 탭에서 이 행사로 지정하면 모입니다")
                } else {
                    NavigationLink(value: Route.photos(PhotoFilter(event: e.id))) { ListRow("사진 보기") }.buttonStyle(.plain)
                }

                VStack(spacing: 10) {
                    PhotosPicker(selection: $logoItem, matching: .images) {
                        Text(e.logo == nil ? "로고 설정" : "로고 바꾸기")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g800)
                            .frame(maxWidth: .infinity).frame(height: 48)
                            .background(Tone.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    if e.logo != nil {
                        Button("로고 지우고 대표 사진 쓰기") { store.updateEvent(e.id) { $0.logo = nil } }.buttonStyle(FillButtonStyle())
                    }
                    Button("일정 편집") { editing = true }.buttonStyle(FillButtonStyle())
                    Button("일정 삭제") { deleting = true }
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
        .sheet(isPresented: $editing) { EventSheet(editing: e) }
        .sheet(isPresented: $addingSub) { SubSheet(eventId: e.id, editing: nil) }
        .sheet(item: $editingSub) { SubSheet(eventId: e.id, editing: $0) }
        .sheet(item: $review) { job in
            ReviewSheet(title: job.title, assets: job.assets, preselected: job.preselected, label: { "\($0)장 지정하기" }) { chosen in
                finish(job, chosen)
            }
        }
        .namePrompt("카테고리 만들기", isPresented: $addingCategory) { name in
            let name = String(name.replacingOccurrences(of: "#", with: "").prefix(16))
            store.edit { c in
                if !c.eventTags.contains(where: { $0.name == name }) {
                    c.eventTags.append(EventTag(name: name, color: TagColor.names.randomElement() ?? "gray"))
                }
            }
            store.updateEvent(e.id) { if !$0.tags.contains(name) { $0.tags.append(name) } }
        }
        .namePrompt("새 사진사", placeholder: "이름 또는 @아이디",
                    isPresented: Binding(get: { addingShooter != nil }, set: { if !$0 { addingShooter = nil } })) { name in
            if let assets = addingShooter, let id = store.addShooter(name, x: name.hasPrefix("@") ? name : nil) {
                review = Review(title: name, assets: assets, shooterId: id, personId: nil)
            }
        }
        .confirm("이 일정을 삭제할까요?",
                 message: photos.isEmpty ? "체크리스트 · 약속 · 카테고리도 함께 사라집니다."
                     : "이 행사로 분류된 사진 \(photos.count)장이 행사 미지정으로 돌아갑니다. 사진과 사용 이력은 지워지지 않습니다.",
                 action: "삭제", isPresented: $deleting) {
            // 사진은 지우지 않고 행사만 뗀다
            store.update(photos.map { library.key(for: $0) }) { $0.event = nil }
            store.edit { $0.events.removeAll { $0.id == e.id } }
            store.markDeleted("events", e.id)
            toast("일정을 삭제했어요")
            dismiss()
        }
        .onChange(of: logoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                   let small = Avatars.square(image, side: 128) {
                    store.updateEvent(e.id) { $0.logo = small }
                } else {
                    toast("이미지를 처리하지 못했어요")
                }
                logoItem = nil
            }
        }
    }

    // MARK: 약속

    @ViewBuilder
    private func subs(_ e: EventRecord) -> some View {
        SectionHead("행사 안의 약속", count: e.sub.isEmpty ? nil : "\(e.sub.count)건")
        if e.sub.isEmpty { EmptyNote(text: "아직 없어요. 아래에서 추가하세요.") }
        let days = Dictionary(grouping: e.sortedSub) { $0.day ?? e.date ?? "" }
        ForEach(days.keys.sorted(), id: \.self) { day in
            if e.dayCount > 1, !day.isEmpty {
                Text([e.dayIndex(day).map { "\($0)일차" }, Day.short(day)].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.g700).padding(.top, 6)
            }
            ForEach(days[day] ?? []) { sub in
                HStack(spacing: 0) {
                    Button {
                        editingSub = sub
                    } label: {
                        SubRow(event: e, sub: sub)
                    }
                    .buttonStyle(.plain)
                    IconButton(symbol: "xmark", label: "약속 지우기") {
                        store.updateEvent(e.id) { $0.sub.removeAll { $0.id == sub.id } }
                    }
                }
            }
        }
        Button("약속 추가") { addingSub = true }.buttonStyle(FillButtonStyle())
    }

    // MARK: 카테고리

    @ViewBuilder
    private func categories(_ e: EventRecord) -> some View {
        SectionHead(title: "행사 카테고리", count: nil) {
            Menu {
                ForEach(store.catalog.eventTags) { t in
                    Button {
                        store.updateEvent(e.id) { ev in
                            if ev.tags.contains(t.name) { ev.tags.removeAll { $0 == t.name } } else { ev.tags.append(t.name) }
                        }
                    } label: {
                        if e.tags.contains(t.name) { Label(t.name, systemImage: "checkmark") } else { Text(t.name) }
                    }
                }
                Divider()
                Button("카테고리 만들기", systemImage: "plus") { addingCategory = true }
            } label: {
                Text("고르기").font(.system(size: 14, weight: .bold)).foregroundStyle(Tone.blueText)
            }
        }
        if !e.tags.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(e.tags, id: \.self) { Pill(text: $0, color: store.tagColor($0)) }
            }
        }
    }

    // MARK: 사진사

    /// 정해진 사진사는 장수 순으로, 아직 없는 사진은 카메라 모델로 묶어 한 번에 지정하게 한다.
    /// 같은 바디로 찍힌 사진은 대개 같은 사진사다 — 여기서 한 번 지정하면 홈의 제안이 그걸 배운다.
    @ViewBuilder
    private func shooters(_ e: EventRecord, _ photos: [PHAsset]) -> some View {
        let by = Dictionary(grouping: photos) { record($0).shooter ?? "" }
        let assigned = store.catalog.shooters.compactMap { s in by[s.id].map { (s, $0.count) } }.sorted { $0.1 > $1.1 }
        SectionHead("사진사", count: assigned.isEmpty ? nil : "\(assigned.count)명")
        ForEach(assigned, id: \.0.id) { s, n in
            NavigationLink(value: Route.photos(PhotoFilter(event: e.id, shooter: s.id))) {
                ListRow(title: s.name, sub: s.unknown ? nil : (s.x.map { "@\($0)" } ?? "X 아이디 없음"), value: "\(n)장") {
                    Avatar(data: s.avatar, name: s.name)
                }
            }
            .buttonStyle(.plain)
        }
        let cameras = Dictionary(grouping: by[""] ?? []) { meta.camera($0.localIdentifier) ?? "카메라 정보 없음" }
        ForEach(cameras.keys.sorted { (cameras[$0]?.count ?? 0) > (cameras[$1]?.count ?? 0) }, id: \.self) { cam in
            let group = cameras[cam] ?? []
            Menu {
                ForEach(store.catalog.shooters.filter { !$0.unknown }) { s in
                    Button(s.name) { review = Review(title: s.name, assets: group, shooterId: s.id, personId: nil) }
                }
                Divider()
                Button("새 사진사 만들기", systemImage: "plus") { addingShooter = group }
                Button("사진사 미상으로 표시", systemImage: "questionmark.circle") {
                    review = Review(title: "사진사 미상", assets: group, shooterId: store.unknownShooter(), personId: nil)
                }
            } label: {
                ListRow("사진사 지정하기", sub: cam, value: "\(group.count)장", tint: Tone.amberText)
            }
        }
    }

    // MARK: 데려간 퍼슈트

    @ViewBuilder
    private func suits(_ e: EventRecord, _ photos: [PHAsset]) -> some View {
        SectionHead(title: "데려간 퍼슈트", count: nil) {
            Menu {
                ForEach(store.activeSuits.sorted { $0.name < $1.name }) { s in
                    Button {
                        store.updateEvent(e.id) { ev in
                            if ev.suits.contains(s.id) { ev.suits.removeAll { $0 == s.id } } else { ev.suits.append(s.id) }
                        }
                    } label: {
                        if e.suits.contains(s.id) { Label(s.name, systemImage: "checkmark") } else { Text(s.name) }
                    }
                }
            } label: {
                Text(e.suits.isEmpty ? "고르기" : "바꾸기").font(.system(size: 14, weight: .bold)).foregroundStyle(Tone.blueText)
            }
        }
        let brought = e.suits.compactMap { store.suit($0) }
        ForEach(brought) { s in
            let tagged = photos.filter { record($0).people.contains(s.personId) }
            Button {
                if photos.isEmpty {
                    toast("이 행사에 붙은 사진이 아직 없어요")
                } else {
                    review = Review(title: s.name, assets: photos, preselected: Set(tagged.map(\.localIdentifier)), shooterId: nil, personId: s.personId)
                }
            } label: {
                ListRow(title: s.name, sub: tagged.isEmpty ? "아직 지정한 사진 없음" : "\(photos.count)장 중 \(tagged.count)장") {
                    Avatar(data: s.avatar, name: s.name)
                }
            }
            .buttonStyle(.plain)
        }
        if brought.count == 1, let only = brought.first {
            let rest = photos.filter { !record($0).people.contains(only.personId) }
            if !rest.isEmpty {
                Button("남은 \(rest.count)장 모두 \"\(only.name)\"") {
                    store.update(rest.map { library.key(for: $0) }) { $0.people.append(only.personId) }
                    toast("\"\(only.name)\" · \(rest.count)장 지정했어요")
                }
                .buttonStyle(FillButtonStyle())
            }
        }
    }

    private func finish(_ job: Review, _ chosen: [PHAsset]) {
        let keys = chosen.map { library.key(for: $0) }
        if let shooterId = job.shooterId {
            store.update(keys) { $0.shooter = shooterId }
        }
        if let personId = job.personId {
            // 고른 사진에는 붙이고, 뺀 사진에서는 뗀다
            let picked = Set(chosen.map(\.localIdentifier))
            let off = job.assets.filter { !picked.contains($0.localIdentifier) }.map { library.key(for: $0) }
            store.update(keys) { if !$0.people.contains(personId) { $0.people.append(personId) } }
            store.update(off.filter { store.record($0).people.contains(personId) }) { $0.people.removeAll { $0 == personId } }
        }
        toast("\"\(job.title)\" · \(chosen.count)장 지정했어요")
    }
}

// MARK: 일정 추가 · 편집

struct EventSheet: View {
    let editing: EventRecord?

    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var multi = false
    @State private var date: String?
    @State private var endDate: String?
    @State private var place = ""
    @State private var note = ""
    @State private var going = true

    var body: some View {
        SheetBody(title: editing == nil ? "일정 추가" : "일정 편집") {
            Field(label: "행사 이름", text: $name, placeholder: "예: 케이퍼리 2026")
            Segmented(items: [SegItem(value: false, title: "하루"), SegItem(value: true, title: "여러 날")], selection: $multi)
            DayField(label: multi ? "시작일" : "날짜", day: $date)
            if multi { DayField(label: "종료일", day: $endDate) }
            Field(label: "장소 (선택)", text: $place, placeholder: "예: 킨텍스 제2전시장")
            Field(label: "메모 (선택)", text: $note)
            VStack(alignment: .leading, spacing: 6) {
                Text("참가").font(.system(size: 13, weight: .medium)).foregroundStyle(Tone.g700)
                Segmented(items: [SegItem(value: true, title: "확정"), SegItem(value: false, title: "미정")], selection: $going)
            }
            Button(editing == nil ? "추가" : "저장") { save() }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .onAppear {
            guard let e = editing else { return }
            name = e.name
            multi = e.endDate != nil
            date = e.date
            endDate = e.endDate
            place = e.place ?? ""
            note = e.note ?? ""
            going = e.going
        }
    }

    private func save() {
        let title = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        // 종료일은 시작일보다 뒤일 때만 남긴다
        let end = (multi && date != nil && (endDate ?? "") > (date ?? "")) ? endDate : nil
        let fill: (inout EventRecord) -> Void = { e in
            e.name = title
            e.date = date
            e.endDate = end
            e.place = place.trimmingCharacters(in: .whitespaces).isEmpty ? nil : String(place.prefix(40))
            e.note = note.trimmingCharacters(in: .whitespaces).isEmpty ? nil : String(note.prefix(80))
            e.going = going
            // 기간이 바뀌어 밖으로 나간 약속은 시작일로 옮긴다
            for i in e.sub.indices {
                if let day = e.sub[i].day, let start = date, day < start || day > (end ?? start) { e.sub[i].day = start }
            }
        }
        if let editing {
            store.updateEvent(editing.id, fill)
            toast("저장했어요")
        } else {
            var e = EventRecord(name: title)
            fill(&e)
            store.addEvent(e)
            toast("\"\(title)\" 일정을 추가했어요")
        }
        dismiss()
    }
}

struct SubSheet: View {
    let eventId: String
    let editing: SubItem?

    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var day: String?
    @State private var timed = false
    @State private var time = Date()
    @State private var place = ""
    @State private var note = ""

    var body: some View {
        let e = store.event(eventId)
        SheetBody(title: editing == nil ? "약속 추가" : "약속 편집", lead: e.map { "\($0.name) 안에서 잡은 약속입니다." }) {
            Field(label: "무엇", text: $title, placeholder: "예: 단체 사진 촬영")
            if let e, let start = e.date, e.dayCount > 1 {
                Picker("며칠차", selection: $day) {
                    ForEach(0..<e.dayCount, id: \.self) { i in
                        let d = Day.add(start, i)
                        Text("\(i + 1)일차 · \(Day.short(d))").tag(Optional(d))
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Toggle("시각", isOn: $timed).font(.system(size: 15)).tint(Tone.green)
            if timed {
                DatePicker("시각", selection: $time, displayedComponents: .hourAndMinute).labelsHidden()
            }
            Field(label: "장소 (선택)", text: $place, placeholder: "예: 3홀 포토존")
            Field(label: "메모 (선택)", text: $note, placeholder: "누구와 · 준비물 · 기억할 것", multiline: true)
            Button(editing == nil ? "추가" : "저장") { save() }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .onAppear {
            day = editing?.day ?? e?.date
            guard let s = editing else { return }
            title = s.title
            place = s.place ?? ""
            note = s.note ?? ""
            if let t = s.time {
                let p = t.split(separator: ":").compactMap { Int($0) }
                if p.count == 2, let d = Calendar.current.date(bySettingHour: p[0], minute: p[1], second: 0, of: Date()) {
                    time = d
                    timed = true
                }
            }
        }
    }

    private func save() {
        var item = editing ?? SubItem(title: "")
        item.title = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        item.day = day
        if timed {
            let c = Calendar.current.dateComponents([.hour, .minute], from: time)
            item.time = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
        } else {
            item.time = nil
        }
        item.place = place.trimmingCharacters(in: .whitespaces).isEmpty ? nil : String(place.prefix(30))
        item.note = note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : String(note.prefix(300))
        let saved = item
        store.updateEvent(eventId) { e in
            if let i = e.sub.firstIndex(where: { $0.id == saved.id }) { e.sub[i] = saved } else { e.sub.append(saved) }
        }
        if editing == nil { toast("약속을 추가했어요") }
        dismiss()
    }
}

// MARK: 체크리스트 · 짐 챙기기

struct ChecklistView: View {
    let eventId: String

    @EnvironmentObject private var store: CatalogStore
    @State private var resetting = false

    var body: some View {
        if let e = store.event(eventId) {
            let packing = store.catalog.packing
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    Text(e.name).font(.system(size: 22, weight: .bold)).foregroundStyle(Tone.g900)
                    Text(e.range).font(.system(size: 14)).foregroundStyle(Tone.g600)

                    progress("사전 준비", e.prepDone, e.prep.count)
                    if e.prep.isEmpty { EmptyNote(text: "아직 없어요. 아래에서 추가하세요.") }
                    ForEach(e.prep) { item in
                        CheckRow(text: item.text, done: item.done) {
                            edit(item.id) { $0.done.toggle() }
                        } trailing: {
                            IconButton(symbol: item.pin ? "bookmark.fill" : "bookmark", label: item.pin ? "고정 떼기" : "할 일에 고정",
                                       color: item.pin ? Tone.blueText : Tone.g600) {
                                edit(item.id) { $0.pin.toggle() }
                                toast(item.pin ? "고정을 뗐어요" : "할 일 목록에 고정했어요")
                            }
                            IconButton(symbol: "xmark", label: "항목 지우기") {
                                store.updateEvent(e.id) { $0.prep.removeAll { $0.id == item.id } }
                            }
                        }
                    }
                    AddLine(placeholder: "할 일 추가") { text in
                        store.updateEvent(e.id) { $0.prep.append(PrepItem(text: String(text.prefix(40)))) }
                    }
                    .padding(.top, 6)

                    progress("짐 챙기기", e.packDone(packing), packing.count)
                    if packing.isEmpty { EmptyNote(text: "공용 목록이 비어 있어요.") }
                    ForEach(packing) { item in
                        CheckRow(text: item.text, done: e.packed.contains(item.id)) {
                            store.updateEvent(e.id) { ev in
                                if ev.packed.contains(item.id) { ev.packed.removeAll { $0 == item.id } } else { ev.packed.append(item.id) }
                            }
                        }
                    }
                    NavigationLink(value: Route.packing) {
                        Text("공용 목록 편집").font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g800)
                            .frame(maxWidth: .infinity).frame(height: 48)
                            .background(Tone.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)

                    Button("이 행사 체크 모두 지우기") { resetting = true }
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.red)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .padding(.top, 12)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .background(Tone.bg)
            .navigationTitle("체크리스트")
            .navigationBarTitleDisplayMode(.inline)
            .confirm("체크를 모두 지울까요?", message: "항목은 남고 체크만 풀립니다.", action: "모두 지우기", isPresented: $resetting) {
                store.updateEvent(e.id) { ev in
                    ev.packed = []
                    for i in ev.prep.indices { ev.prep[i].done = false }
                }
                toast("체크를 지웠어요")
            }
        } else {
            EmptyNote(text: "삭제된 일정입니다.")
        }
    }

    private func edit(_ itemId: String, _ change: (inout PrepItem) -> Void) {
        store.updateEvent(eventId) { e in
            if let i = e.prep.firstIndex(where: { $0.id == itemId }) { change(&e.prep[i]) }
        }
    }

    private func progress(_ title: String, _ done: Int, _ total: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.system(size: 17, weight: .bold)).foregroundStyle(Tone.g900)
                Spacer()
                Text("\(done)/\(total)").font(.system(size: 14, weight: .bold))
                    .foregroundStyle(total > 0 && done == total ? Tone.greenText : Tone.g600)
            }
            ProgressView(value: total == 0 ? 0 : Double(done) / Double(total))
                .tint(total > 0 && done == total ? Tone.green : Tone.blue)
        }
        .padding(.top, 20)
    }
}

/// 모든 행사가 함께 쓰는 짐 목록. 체크 상태는 행사마다 따로 남는다.
struct PackingView: View {
    @EnvironmentObject private var store: CatalogStore
    @State private var removing: PackItem?

    var body: some View {
        let items = store.catalog.packing
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                AddLine(placeholder: "챙길 것 추가") { text in
                    let value = String(text.prefix(40))
                    if items.contains(where: { $0.text == value }) {
                        toast("이미 있는 항목이에요")
                    } else {
                        store.edit { $0.packing.append(PackItem(text: value)) }
                    }
                }
                if items.isEmpty { EmptyNote(text: "항목이 없어요.") }
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    HStack(spacing: 0) {
                        Text(item.text).font(.system(size: 16, weight: .medium)).foregroundStyle(Tone.g900)
                        Spacer()
                        if index > 0 {
                            IconButton(symbol: "arrow.up", label: "위로") {
                                store.edit { $0.packing.swapAt(index, index - 1) }
                            }
                        }
                        IconButton(symbol: "xmark", label: "지우기") { removing = item }
                    }
                    .frame(minHeight: 48)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(Tone.bg)
        .navigationTitle("짐 챙기기 목록")
        .navigationBarTitleDisplayMode(.inline)
        .confirm("\"\(removing?.text ?? "")\" 를 지울까요?",
                 message: removing.map { item in
                     let n = store.catalog.events.filter { $0.packed.contains(item.id) }.count
                     return n > 0 ? "이미 체크해 둔 행사 \(n)건에서도 함께 빠집니다." : "공용 목록에서 사라집니다."
                 },
                 action: "지우기", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            if let item = removing {
                store.edit { c in
                    c.packing.removeAll { $0.id == item.id }
                    for i in c.events.indices { c.events[i].packed.removeAll { $0 == item.id } }
                }
                store.markDeleted("packing", item.id)
            }
            removing = nil
        }
    }
}
