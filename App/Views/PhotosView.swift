import Photos
import SwiftUI

private struct GridSection: Identifiable {
    let id: String
    let title: String?
    let assets: [PHAsset]
}

/// 사진 격자. 사진 탭이자, 모아보기에서 행사·사진사·퍼슈트를 눌렀을 때의 화면이다.
/// 선택 모드에서는 아래 패널로 사진사·퍼슈트를 여러 장에 한 번에 붙인다.
struct PhotosView: View {
    var isTab = false

    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var store: CatalogStore
    @AppStorage("fff.group") private var group = "event"
    @State private var filter: PhotoFilter
    @State private var selecting: Bool
    @State private var selected: Set<String> = []
    @State private var tagging = false
    @State private var logging = false

    init(filter: PhotoFilter, isTab: Bool = false) {
        self.isTab = isTab
        _filter = State(initialValue: filter)
        _selecting = State(initialValue: filter.selecting)
    }

    private func record(_ a: PHAsset) -> PhotoRecord { store.record(library.key(for: a)) }

    private var title: String {
        if isTab { return "사진" }
        if let e = store.event(filter.event) { return e.name }
        if let s = store.shooter(filter.shooter) { return s.name }
        if let p = store.person(filter.person) { return p.name }
        if let t = filter.tag { return "#\(t)" }
        if filter.planned { return "업로드 후보" }
        if filter.unset { return "정리할 사진" }
        if filter.noEvent { return "행사 미지정" }
        if filter.noShooter { return "사진사 미지정" }
        if filter.unused { return "안 쓴 사진" }
        return "사진"
    }

    private var shown: [PHAsset] {
        let kept = library.all.filter { a in
            let r = record(a)
            if filter.unset, !r.isUnfiled { return false }
            if filter.noEvent, r.event != nil { return false }
            if filter.noShooter, r.shooter != nil { return false }
            if let e = filter.event, r.event != e { return false }
            if filter.unused, r.isUsed { return false }
            if filter.planned, !r.isPlanned { return false }
            if let s = filter.shooter, r.shooter != s { return false }
            if let p = filter.person, !r.people.contains(p) { return false }
            if let t = filter.tag, !r.tags.contains(t) { return false }
            return true
        }
        if filter.planned {
            // 대기열은 담은 순서대로
            return kept.sorted { (record($0).plannedAt ?? .distantFuture) < (record($1).plannedAt ?? .distantFuture) }
        }
        return kept.sorted { ($0.creationDate ?? .distantPast) > ($1.creationDate ?? .distantPast) }
    }

    private func sections(_ shown: [PHAsset]) -> [GridSection] {
        let flat = [GridSection(id: "all", title: nil, assets: shown)]
        if filter.planned { return flat }
        switch group {
        case "event" where filter.event == nil && !filter.noEvent:
            let by = Dictionary(grouping: shown) { record($0).event ?? "" }
            var out = store.catalog.events.sorted { ($0.date ?? "") > ($1.date ?? "") }
                .compactMap { e in by[e.id].map { GridSection(id: e.id, title: e.name, assets: $0) } }
            if let none = by[""] { out.append(GridSection(id: "none", title: "행사 미지정", assets: none)) }
            return out
        case "shooter" where filter.shooter == nil && !filter.noShooter:
            let by = Dictionary(grouping: shown) { record($0).shooter ?? "" }
            var out = store.catalog.shooters.compactMap { s in by[s.id].map { GridSection(id: s.id, title: s.name, assets: $0) } }
            if let none = by[""] { out.append(GridSection(id: "none", title: "사진사 미지정", assets: none)) }
            return out
        case "person" where filter.person == nil:
            var out = store.catalog.people.compactMap { p -> GridSection? in
                let mine = shown.filter { record($0).people.contains(p.id) }
                return mine.isEmpty ? nil : GridSection(id: p.id, title: p.name, assets: mine)
            }
            let none = shown.filter { record($0).people.isEmpty }
            if !none.isEmpty { out.append(GridSection(id: "none", title: "퍼슈트 미지정", assets: none)) }
            return out
        default:
            return flat
        }
    }

    var body: some View {
        let shown = self.shown
        let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: selecting ? 4 : 3)
        let order = Dictionary(uniqueKeysWithValues: shown.enumerated().map { ($0.element.localIdentifier, $0.offset + 1) })

        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                chips
                Text("\(shown.count)장").font(.system(size: 13)).foregroundStyle(Tone.g600).padding(.horizontal, 20)

                ForEach(sections(shown)) { section in
                    if let title = section.title {
                        HStack(alignment: .firstTextBaseline) {
                            Text(title).font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g900)
                            Spacer()
                            Text("\(section.assets.count)장").font(.system(size: 13)).foregroundStyle(Tone.g600)
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 6)
                    }
                    LazyVGrid(columns: columns, spacing: 2) {
                        ForEach(section.assets, id: \.localIdentifier) { a in
                            cell(a, queue: filter.planned ? order[a.localIdentifier] : nil)
                        }
                    }
                }

                if shown.isEmpty {
                    VStack(spacing: 10) {
                        Text(library.all.isEmpty ? "폴더에 사진이 없어요" : "조건에 맞는 사진이 없어요")
                            .font(.system(size: 15)).foregroundStyle(Tone.g600)
                        if filter.isActive, isTab {
                            Button("필터 초기화") { filter = PhotoFilter() }
                                .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.blueText)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 60)
                }
            }
            .padding(.bottom, 24)
        }
        .background(Tone.bg)
        .navigationTitle(title)
        .toolbarTitleDisplayMode(isTab ? .inlineLarge : .inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if selecting {
                    Button("전체 선택") { selected = Set(shown.map(\.localIdentifier)) }
                } else {
                    Menu {
                        Picker("묶기", selection: $group) {
                            Text("행사별").tag("event")
                            Text("사진사별").tag("shooter")
                            Text("퍼슈트별").tag("person")
                            Text("묶지 않기").tag("none")
                        }
                    } label: {
                        // 지금 무엇으로 묶여 있는지 글자로 보여준다
                        HStack(spacing: 3) {
                            Text(["event": "행사별", "shooter": "사진사별", "person": "퍼슈트별"][group] ?? "묶지 않음")
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold))
                        }
                        .font(.system(size: 15, weight: .semibold))
                    }
                    .accessibilityLabel("묶어 보기")
                }
                Button(selecting ? "취소" : "선택") {
                    selecting.toggle()
                    selected = []
                }
                .fontWeight(.bold)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if selecting, !selected.isEmpty {
                TagPanel(count: selected.count, newEvent: newEvent) { eventId, shooterId, personIds in
                    apply(eventId, shooterId, personIds)
                } menu: {
                    moreMenu
                }
                .transition(.move(edge: .bottom))
            }
        }
        .animation(.snappy(duration: 0.25), value: selected.isEmpty)
        .sheet(isPresented: $tagging) {
            TagApplySheet(keys: selectedKeys).presentationDetents([.medium])
        }
        .sheet(isPresented: $logging) {
            UsageSheet(keys: selectedKeys) {
                selected = []
                selecting = false
            }
            .presentationDetents([.medium])
        }
    }

    private var selectedKeys: [String] { selected.compactMap { library.byId[$0] }.map { library.key(for: $0) } }

    // MARK: 거르기

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if filter.unset { Chip(title: "미분류 ✕", on: true) { filter.unset = false } }
                Chip(title: "행사 미지정", on: filter.noEvent) { filter.noEvent.toggle() }
                Chip(title: "사진사 미지정", on: filter.noShooter) { filter.noShooter.toggle() }
                Chip(title: "미사용만", on: filter.unused) { filter.unused.toggle() }
                Chip(title: "업로드 후보", on: filter.planned) { filter.planned.toggle() }
                menuChip(store.event(filter.event)?.name ?? "행사", on: filter.event != nil) {
                    ForEach(store.catalog.events.sorted { ($0.date ?? "") > ($1.date ?? "") }) { e in
                        Button(e.name) { filter.event = e.id }
                    }
                    if filter.event != nil { Button("필터 해제", role: .destructive) { filter.event = nil } }
                }
                menuChip(store.shooter(filter.shooter)?.name ?? "사진사", on: filter.shooter != nil) {
                    ForEach(store.catalog.shooters) { s in Button(s.name) { filter.shooter = s.id } }
                    if filter.shooter != nil { Button("필터 해제", role: .destructive) { filter.shooter = nil } }
                }
                menuChip(store.person(filter.person)?.name ?? "퍼슈트", on: filter.person != nil) {
                    ForEach(store.catalog.people.sorted { $0.name < $1.name }) { p in Button(p.name) { filter.person = p.id } }
                    if filter.person != nil { Button("필터 해제", role: .destructive) { filter.person = nil } }
                }
                if let tag = filter.tag {
                    Chip(title: "#\(tag) ✕", on: true) { filter.tag = nil }
                }
            }
            .padding(.horizontal, 20)
        }
        .sensoryFeedback(.selection, trigger: filter)
    }

    private func menuChip<C: View>(_ title: String, on: Bool, @ViewBuilder _ content: () -> C) -> some View {
        Menu(content: content) {
            HStack(spacing: 4) {
                Text(title).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
            }
            .font(.system(size: 15, weight: on ? .bold : .medium))
            .foregroundStyle(on ? Tone.bg : Tone.g800)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(on ? Tone.g900 : Tone.fill, in: Capsule())
        }
    }

    // MARK: 칸

    @ViewBuilder
    private func cell(_ a: PHAsset, queue: Int?) -> some View {
        let id = a.localIdentifier
        let on = selected.contains(id)
        let r = record(a)
        let tile = Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { Thumb(asset: a) }
            .clipped()
            .contentShape(Rectangle())

        if selecting {
            Button {
                if on { selected.remove(id) } else { selected.insert(id) }
            } label: {
                tile
                    .overlay { if on { Rectangle().strokeBorder(Tone.blue, lineWidth: 3) } }
                    .overlay(alignment: .topTrailing) { SelectMark(on: on).padding(6) }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(on ? "사진 선택됨" : "사진 선택")
        } else {
            NavigationLink(value: Route.photo(id)) {
                tile
                    .overlay(alignment: .bottomTrailing) { StatusBadge(record: r).padding(6) }
                    .overlay(alignment: .topLeading) {
                        if let queue {
                            Text("\(queue)")
                                .font(.system(size: 12, weight: .heavy)).foregroundStyle(.white)
                                .frame(minWidth: 22, minHeight: 22)
                                .background(Color.black.opacity(0.55), in: Capsule())
                                .padding(6)
                        } else if r.isUnfiled {
                            Circle().fill(Tone.amber).frame(width: 10, height: 10)
                                .overlay(Circle().stroke(.white, lineWidth: 2))
                                .padding(8)
                                .accessibilityLabel("미분류")
                        }
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("사진 열기")
        }
    }

    // MARK: 여러 장에 적용

    /// 고른 사진 가운데 가장 이른 날짜로 새 행사를 만든다
    private func newEvent(_ name: String) -> String {
        var e = EventRecord(name: String(name.prefix(60)))
        e.date = selected.compactMap { library.byId[$0]?.creationDate }.min().map(Day.string)
        store.addEvent(e)
        return e.id
    }

    private func apply(_ eventId: String?, _ shooterId: String?, _ personIds: Set<String>) {
        let keys = selectedKeys
        store.update(keys) { r in
            if let eventId { r.event = eventId }
            if let shooterId { r.shooter = shooterId }
            for p in personIds where !r.people.contains(p) { r.people.append(p) }
        }
        let names = ([store.event(eventId)?.name, store.shooter(shooterId)?.name] + personIds.map { store.person($0)?.name }).compactMap { $0 }
        toast("\(keys.count)장 · \(names.isEmpty ? "바뀐 것 없음" : names.joined(separator: ", "))")
        selected = []
    }

    @ViewBuilder
    private var moreMenu: some View {
        let keys = selectedKeys
        let allPlanned = !keys.isEmpty && keys.allSatisfy { store.record($0).isPlanned }
        if allPlanned {
            Button("후보에서 빼기", systemImage: "bookmark.slash") {
                store.update(keys) { $0.plannedAt = nil }
                toast("후보에서 뺐어요 · \(keys.count)장")
                selected = []
            }
            Button("대기열 맨 앞으로", systemImage: "arrow.up.to.line") {
                let first = store.catalog.photos.values.compactMap(\.plannedAt).min() ?? Date()
                for (i, key) in keys.enumerated() {
                    store.update([key]) { $0.plannedAt = first.addingTimeInterval(Double(i - keys.count)) }
                }
                toast("\(keys.count)장을 맨 앞으로 옮겼어요")
                selected = []
            }
        } else {
            Button("업로드 후보로 담기", systemImage: "bookmark") {
                // 고른 순서가 아니라 화면 순서대로 줄을 세운다
                let now = Date.nowSec
                for (i, key) in keys.enumerated() where store.record(key).plannedAt == nil {
                    store.update([key]) { $0.plannedAt = now.addingTimeInterval(Double(i)) }
                }
                toast("업로드 후보에 담았어요 · \(keys.count)장")
                selected = []
            }
        }
        Button("태그 적용", systemImage: "tag") { tagging = true }
        Button("사용 기록", systemImage: "checkmark.circle") { logging = true }
        Divider()
        Button("사진사 미상으로 표시", systemImage: "questionmark.circle") {
            let id = store.unknownShooter()
            store.update(keys) { $0.shooter = id }
            toast("\(keys.count)장 · 사진사 미상")
            selected = []
        }
        Button("행사 지정 해제", systemImage: "calendar.badge.minus", role: .destructive) {
            store.update(keys) { $0.event = nil }
            toast("\(keys.count)장 · 해제")
            selected = []
        }
        Button("사진사 지정 해제", systemImage: "person.slash", role: .destructive) {
            store.update(keys) { $0.shooter = nil }
            toast("\(keys.count)장 · 해제")
            selected = []
        }
        Button("퍼슈트 지정 해제", systemImage: "pawprint", role: .destructive) {
            store.update(keys) { $0.people = [] }
            toast("\(keys.count)장 · 해제")
            selected = []
        }
    }
}

/// 사진 위 상태 표시 — 업로드 후보는 책갈피(우선), 쓴 사진은 초록 체크
struct StatusBadge: View {
    let record: PhotoRecord

    var body: some View {
        if record.isPlanned {
            mark("bookmark.fill", Tone.amber).accessibilityLabel("업로드 후보")
        } else if record.isUsed {
            mark("checkmark", Tone.green).accessibilityLabel("사용함")
        }
    }

    private func mark(_ symbol: String, _ color: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 11, weight: .heavy))
            .foregroundStyle(.white)
            .frame(width: 22, height: 22)
            .background(color, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 2))
    }
}

struct SelectMark: View {
    let on: Bool

    var body: some View {
        ZStack {
            Circle().fill(on ? Tone.blue : Color.black.opacity(0.12))
            Circle().strokeBorder(.white, lineWidth: on ? 0 : 2)
            if on {
                Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)).foregroundStyle(Tone.onBlue)
            }
        }
        .frame(width: 24, height: 24)
    }
}

/// 선택한 사진들에 행사·사진사·퍼슈트를 붙이는 아래 패널. 왼쪽 점 세 개에 나머지 동작이 들어 있다.
struct TagPanel<MenuItems: View>: View {
    let count: Int
    /// 이름을 받아 새 행사를 만들고 그 ID 를 돌려준다
    let newEvent: (String) -> String
    let apply: (String?, String?, Set<String>) -> Void
    @ViewBuilder var menu: () -> MenuItems

    @EnvironmentObject private var store: CatalogStore
    @State private var event: String?
    @State private var addingEvent = false
    @State private var shooter: String?
    @State private var people: Set<String> = []
    @State private var addingShooter = false
    @State private var addingPerson = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            row("행사") {
                // 최근 행사가 앞에 온다
                ForEach(store.catalog.events.sorted { ($0.date ?? "") > ($1.date ?? "") }) { e in
                    Chip(title: e.name, on: event == e.id) { event = event == e.id ? nil : e.id }
                }
                AddChip(label: "행사 추가") { addingEvent = true }
            }
            row("사진사") {
                ForEach(store.catalog.shooters.filter { !$0.unknown }) { s in
                    Chip(title: s.name, on: shooter == s.id) { shooter = shooter == s.id ? nil : s.id }
                }
                AddChip(label: "사진사 추가") { addingShooter = true }
            }
            row("퍼슈트") {
                ForEach(store.catalog.people) { p in
                    Chip(title: p.name, on: people.contains(p.id)) {
                        if people.contains(p.id) { people.remove(p.id) } else { people.insert(p.id) }
                    }
                }
                AddChip(label: "퍼슈트 추가") { addingPerson = true }
            }
            HStack(spacing: 10) {
                Menu(content: menu) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(Tone.g700)
                        .frame(width: 56, height: 56)
                        .background(Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .accessibilityLabel("더보기")
                Button("\(count)장에 적용") {
                    apply(event, shooter, people)
                    event = nil
                    shooter = nil
                    people = []
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(event == nil && shooter == nil && people.isEmpty)
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
        }
        .padding(.top, 20)
        .padding(.bottom, 8)
        // 사진 위에 떠 있는 유리판 — 뒤의 사진이 비쳐야 유리로 보인다
        .liquidGlassCard(cornerRadius: 28)
        .padding(.horizontal, 8)
        .padding(.bottom, 6)
        .sensoryFeedback(.selection, trigger: people)
        .sensoryFeedback(.selection, trigger: shooter)
        .sensoryFeedback(.selection, trigger: event)
        .namePrompt("새 행사", placeholder: "예: 케이퍼리 2026", isPresented: $addingEvent) { name in
            event = newEvent(name)
        }
        .namePrompt("새 사진사", placeholder: "이름 또는 @아이디", isPresented: $addingShooter) { name in
            // "@아이디"로 적으면 X 아이디로도 쓴다
            if let id = store.addShooter(name, x: name.hasPrefix("@") ? name : nil) { shooter = id }
        }
        .namePrompt("새 퍼슈트", isPresented: $addingPerson) { name in
            if let id = store.addPerson(name) { people.insert(id) }
        }
    }

    private func row<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Tone.g700)
                .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) { content() }
                    .padding(.horizontal, 20)
            }
        }
    }
}

/// 자유 태그를 붙이고 뗀다. 태그는 설정에서만 만든다 — 오타로 태그가 갈라지지 않게.
struct TagApplySheet: View {
    let keys: [String]
    @EnvironmentObject private var store: CatalogStore

    var body: some View {
        SheetBody(title: "태그 적용") {
            if store.catalog.tags.isEmpty {
                EmptyNote(text: "태그가 없어요. 프로필 › 설정 › 태그 관리에서 만들 수 있어요.")
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(store.catalog.tags, id: \.self) { tag in
                        let have = keys.filter { store.record($0).tags.contains(tag) }.count
                        Chip(title: have > 0 && have < keys.count ? "\(tag) \(have)/\(keys.count)" : tag, on: have == keys.count) {
                            if have == keys.count {
                                store.update(keys) { $0.tags.removeAll { $0 == tag } }
                                toast("\(tag) 태그를 뺐어요 · \(keys.count)장")
                            } else {
                                store.update(keys) { if !$0.tags.contains(tag) { $0.tags.append(tag) } }
                                toast("\(tag) 태그를 적용했어요 · \(keys.count)장")
                            }
                        }
                    }
                }
            }
        }
    }
}
