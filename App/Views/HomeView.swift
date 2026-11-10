import CoreLocation
import Photos
import SwiftUI

/// "확인할 것" — 사진의 날짜·장소·카메라에서 나오는 분류 제안. 묻기만 하고, 확정은 사람이 한다.
struct Suggestion: Identifiable {
    enum Kind {
        /// 같은 카메라로 찍힌 사진은 대개 같은 사진사다
        case shooter(camera: String, shooterId: String, rivals: Int)
        /// 찍은 날이 이미 있는 행사 기간 안이다
        case event(eventId: String)
        /// 어느 행사에도 안 걸리는 날에 사진이 몰려 있다
        case newEvent(day: String, place: CLLocation?)
    }

    let id: String
    let kind: Kind
    let why: String
    let question: String
    var note: String?
    let assets: [PHAsset]

    var isMake: Bool { if case .newEvent = kind { return true } else { return false } }

    /// "나중에"는 이번 실행 동안만 숨긴다
    @MainActor static var later: Set<String> = []
    private static let minCluster = 5
    /// 같은 날이라도 이만큼 떨어져 있으면 다른 곳으로 본다
    private static let apart: CLLocationDistance = 3000

    @MainActor private static var memo: (stamp: String, list: [Suggestion]) = ("", [])

    /// 화면을 그릴 때마다 불리므로, 바뀐 게 없으면 지난 결과를 그대로 준다
    @MainActor
    static func build(library: PhotoLibrary, store: CatalogStore, meta: MetaStore) -> [Suggestion] {
        let stamp = "\(store.catalog.updatedAt.timeIntervalSince1970)-\(library.all.count)-\(library.keys.count)-\(meta.metas.count)-\(later.count)"
        if memo.stamp == stamp { return memo.list }
        let list = compute(library: library, store: store, meta: meta)
        memo = (stamp, list)
        return list
    }

    @MainActor
    private static func compute(library: PhotoLibrary, store: CatalogStore, meta: MetaStore) -> [Suggestion] {
        var learned: [String: [String: Int]] = [:]
        var byCamera: [String: [PHAsset]] = [:]
        var byDayEvent: [String: [PHAsset]] = [:]
        var loose: [String: [PHAsset]] = [:]
        let unknown = store.catalog.shooters.first { $0.unknown }?.id
        let dated = store.catalog.events.filter { $0.date != nil }

        for a in library.all {
            let r = store.record(library.key(for: a))
            if let cam = meta.camera(a.localIdentifier) {
                if let s = r.shooter {
                    if s != unknown { learned[cam, default: [:]][s, default: 0] += 1 }
                } else {
                    byCamera[cam, default: []].append(a)
                }
            }
            if r.event == nil, let shot = a.creationDate {
                let day = Day.string(shot)
                if let e = dated.first(where: { ($0.date ?? "") <= day && day <= ($0.lastDay ?? "") }) {
                    byDayEvent["\(day)→\(e.id)", default: []].append(a)
                } else {
                    loose[day, default: []].append(a)
                }
            }
        }

        var out: [Suggestion] = []
        for (cam, assets) in byCamera {
            guard let votes = learned[cam], let best = votes.max(by: { $0.value < $1.value }), let s = store.shooter(best.key) else { continue }
            out.append(Suggestion(id: "cam:\(cam)→\(s.id)", kind: .shooter(camera: cam, shooterId: s.id, rivals: votes.count),
                                  why: "\(cam) 로 찍힌 \(assets.count)장", question: "\(s.name) 사진사가 찍은 사진인가요?",
                                  note: votes.count > 1 ? "이 카메라를 쓰는 사진사가 \(votes.count)명이라 확실하지 않아요" : nil, assets: assets))
        }
        for (key, assets) in byDayEvent {
            let parts = key.components(separatedBy: "→")
            guard parts.count == 2, let e = store.event(parts[1]) else { continue }
            out.append(Suggestion(id: "date:\(key)", kind: .event(eventId: e.id), why: "\(Day.dotted(parts[0])) 에 찍힌 \(assets.count)장",
                                  question: "\(e.name) 사진인가요?", note: nil, assets: assets))
        }
        for (day, assets) in loose {
            // 같은 날 안에서도 장소가 멀면 따로 묶는다. 위치가 없는 사진은 가장 큰 묶음에 넣는다.
            var groups: [(center: CLLocation?, assets: [PHAsset])] = []
            var nowhere: [PHAsset] = []
            for a in assets {
                guard let loc = a.location else {
                    nowhere.append(a)
                    continue
                }
                if let i = groups.firstIndex(where: { ($0.center?.distance(from: loc) ?? .infinity) < apart }) {
                    groups[i].assets.append(a)
                } else {
                    groups.append((center: Optional(loc), assets: [a]))
                }
            }
            if groups.isEmpty {
                groups = [(center: nil, assets: nowhere)]
            } else if let big = groups.indices.max(by: { groups[$0].assets.count < groups[$1].assets.count }) {
                groups[big].assets += nowhere
            }
            for (i, g) in groups.enumerated() where g.assets.count >= minCluster {
                out.append(Suggestion(id: "newev:\(day)" + (i == 0 ? "" : "#\(i)"), kind: .newEvent(day: day, place: g.center),
                                      why: "\(Day.dotted(day)) 에 \(g.assets.count)장이 몰려 있어요", question: "새 행사로 만들까요?",
                                      note: nil, assets: g.assets))
            }
        }
        let hidden = Set(store.catalog.dismissed).union(later)
        return Array(out.filter { !hidden.contains($0.id) }.sorted { $0.assets.count > $1.assets.count }.prefix(6))
    }

    /// 사용자가 "앞으로"를 켠 카메라는 묻지 않고 채운다. 이미 사진사가 있는 사진은 건드리지 않는다.
    @MainActor
    static func applyRules(library: PhotoLibrary, store: CatalogStore, meta: MetaStore) {
        let rules = store.catalog.rules
        let named = store.catalog.shooters.filter { !($0.filePattern ?? "").isEmpty }
        guard !rules.isEmpty || !named.isEmpty else { return }
        var byShooter: [String: [String]] = [:]
        for a in library.all {
            let key = library.key(for: a)
            guard store.record(key).shooter == nil else { continue }
            // 사진사별 파일명 규칙이 먼저, 그다음 카메라 규칙
            if let name = meta.names[a.localIdentifier], let s = named.first(where: { $0.matches(fileName: name) }) {
                byShooter[s.id, default: []].append(key)
            } else if let cam = meta.camera(a.localIdentifier), let id = rules[cam], store.shooter(id) != nil {
                byShooter[id, default: []].append(key)
            }
        }
        for (id, keys) in byShooter { store.update(keys) { $0.shooter = id } }
    }
}

private struct PersonRow: Identifiable {
    let person: Person
    let records: [PhotoRecord]
    var id: String { person.id }
}

/// "이 사진들이 이 퍼슈트 같아요" 묶음. id 는 퍼슈트(사람) ID.
private struct SuitGroup: Identifiable {
    let id: String
    let assets: [PHAsset]
}

/// 새 행사로 묶을 사진들
private struct MakeJob: Identifiable {
    let id = UUID()
    let suggestion: Suggestion
    let assets: [PHAsset]
}

/// 모아보기 — 금요일, 디데이, 확인할 것, 정리할 사진, 행사·사진사·퍼슈트 목록
struct HomeView: View {
    enum Axis: Hashable { case event, shooter, person }

    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var meta: MetaStore
    @ObservedObject private var places = PlaceNames.shared
    @State private var axis: Axis = .event
    @State private var reviewing: Suggestion?
    @State private var pendingMake: MakeJob?
    @State private var making: MakeJob?
    @State private var always: Set<String> = []
    @State private var laterTick = 0
    @State private var suitGroups: [SuitGroup] = []
    @State private var suitReview: SuitGroup?
    @State private var suitTick = 0

    private func record(_ a: PHAsset) -> PhotoRecord { store.record(library.key(for: a)) }

    var body: some View {
        let records = library.all.map(record)
        let unused = zip(library.all, records).filter { !$0.1.isUsed }.map { $0.0 }
        let planned = records.filter(\.isPlanned).count
        let unfiled = records.filter(\.isUnfiled).count
        let suggestions = Suggestion.build(library: library, store: store, meta: meta)
        let title = store.catalog.opts.homeTitle.isEmpty ? "모아보기" : store.catalog.opts.homeTitle

        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if store.catalog.opts.friday { fridayCard(unused, planned) }
                DdayCard()

                if let error = store.loadError {
                    Text(error).font(.system(size: 13)).foregroundStyle(Tone.amberText)
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Tone.amberFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                if library.all.isEmpty {
                    EmptyNote(text: "앨범에 사진이 없어요. 사진 앱에서 \"\(library.sourceTitle)\" 앨범에 사진을 넣어 주세요.")
                }

                if !suggestions.isEmpty || !suitGroups.isEmpty {
                    SectionHead("확인할 것", count: "\(suggestions.count + suitGroups.count)")
                    ForEach(suggestions.prefix(3)) { card($0) }
                    ForEach(suitGroups.prefix(2)) { suitCard($0) }
                }

                if unfiled > 0 {
                    strip("행사·사진사를 정할 사진 \(unfiled)장", "정리하기", strong: true,
                          to: .photos(PhotoFilter(unset: true, selecting: true)))
                }
                if planned > 0 {
                    strip("업로드 후보 \(planned)장", "보기", strong: false, to: .photos(PhotoFilter(planned: true)))
                }

                Segmented(items: [SegItem(value: Axis.event, title: "행사별"),
                                  SegItem(value: Axis.shooter, title: "사진사별"),
                                  SegItem(value: Axis.person, title: "퍼슈트별")],
                          selection: $axis)
                    .padding(.top, 4)

                VStack(spacing: 0) {
                    switch axis {
                    case .event: eventRows(records)
                    case .shooter: shooterRows(records)
                    case .person: personRows(records)
                    }
                }
                .padding(.horizontal, -8)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Tone.bg)
        .navigationTitle(title)
        .toolbarTitleDisplayMode(.inlineLarge)
        .task(id: "\(meta.metas.count)-\(meta.names.count)-\(library.all.count)") {
            Suggestion.applyRules(library: library, store: store, meta: meta)
            let linked = WebImport.shared.match(library: library, store: store, meta: meta)
            if linked > 0 { toast("웹 기록 \(linked)장을 사진에 연결했어요") }
        }
        .task(id: "\(library.all.count)-\(store.catalog.people.count)-\(suitTick)") { await scanSuits() }
        .sheet(item: $suitReview) { g in
            ReviewSheet(title: "\(store.person(g.id)?.name ?? "") 인가요?", assets: g.assets, label: { "\($0)장에 붙이기" }) { chosen in
                acceptSuit(g, chosen)
            }
        }
        .sheet(item: $reviewing, onDismiss: {
            // 훑어보기가 닫힌 뒤에 다음 시트를 올린다 — 동시에 두 장은 못 띄운다
            making = pendingMake
            pendingMake = nil
        }) { s in
            ReviewSheet(title: s.question, assets: s.assets, label: { s.isMake ? "\($0)장 · 행사 정하기" : "\($0)장에 적용" }) { chosen in
                if s.isMake { pendingMake = MakeJob(suggestion: s, assets: chosen) } else { accept(s, chosen) }
            }
        }
        .sheet(item: $making) { job in
            NewEventSheet(assets: job.assets, day: day(of: job.suggestion), place: placeName(job.suggestion)) {
                store.edit { $0.dismissed.append(job.suggestion.id) }
            }
        }
    }

    private func day(of s: Suggestion) -> String {
        if case .newEvent(let day, _) = s.kind { return day }
        return Day.today
    }

    private func placeName(_ s: Suggestion) -> String? {
        if case .newEvent(_, let place) = s.kind { return places.name(place) }
        return nil
    }

    // MARK: 금요일

    private var daysToFriday: Int {
        let weekday = Calendar.current.component(.weekday, from: Date()) // 일요일 = 1, 금요일 = 6
        return (6 - weekday + 7) % 7
    }

    private func fridayCard(_ unused: [PHAsset], _ planned: Int) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(daysToFriday == 0 ? "오늘은 #FursuitFriday" : "이번 금요일")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Tone.g700)
                Text(daysToFriday == 0 ? "오늘" : "D-\(daysToFriday)")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Tone.g900)
            }
            Spacer()
            HStack(spacing: -14) {
                ForEach(unused.suffix(3), id: \.localIdentifier) { a in
                    Thumb(asset: a, side: 44)
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Tone.fill, lineWidth: 2))
                }
            }
            // 담아 둔 후보가 있으면 그 대기열부터, 없으면 아직 안 올린 사진에서 고른다
            NavigationLink(value: Route.photos(planned > 0 ? PhotoFilter(planned: true) : PhotoFilter(unused: true))) {
                Text(planned > 0 ? "후보 \(planned)장" : "사진 고르기")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Tone.onBlue)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(Tone.blue, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 20)
        .padding([.vertical, .trailing], 18)
        .background(Tone.fill, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func strip(_ text: String, _ action: String, strong: Bool, to route: Route) -> some View {
        NavigationLink(value: route) {
            HStack {
                Text(text)
                Spacer()
                Text(action)
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(strong ? Tone.blueText : Tone.g800)
            .padding(.horizontal, 18)
            .frame(height: 56)
            .background(strong ? Tone.blueFill : Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: 확인할 것

    private func card(_ s: Suggestion) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text([s.why, placeName(s)].compactMap { $0 }.joined(separator: " · ")).font(.system(size: 13)).foregroundStyle(Tone.g600)
            Text(s.question).font(.system(size: 17, weight: .bold)).foregroundStyle(Tone.g900)
            if let note = s.note { Text(note).font(.system(size: 13)).foregroundStyle(Tone.amberText) }
            HStack(spacing: 6) {
                ForEach(s.assets.prefix(3), id: \.localIdentifier) { a in
                    Thumb(asset: a, side: 96).frame(height: 96).frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            if case .shooter(let camera, let shooterId, let rivals) = s.kind, rivals == 1 {
                Toggle("앞으로 \(camera) 은 \(store.shooter(shooterId)?.name ?? "")", isOn: Binding(
                    get: { always.contains(s.id) },
                    set: { on in if on { always.insert(s.id) } else { always.remove(s.id) } }))
                    .font(.system(size: 14))
                    .tint(Tone.green)
            }
            HStack(spacing: 10) {
                Button(s.isMake ? "나중에" : "아니요") {
                    if s.isMake {
                        Suggestion.later.insert(s.id)
                        laterTick += 1
                    } else {
                        store.edit { $0.dismissed.append(s.id) }
                    }
                }
                .buttonStyle(FillButtonStyle())
                Button(s.isMake ? "만들기" : "맞아요") { reviewing = s }
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.onBlue)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(Tone.blue, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(Tone.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Tone.fill, lineWidth: 2))
        .id("\(s.id)-\(laterTick)")
    }

    private func accept(_ s: Suggestion, _ chosen: [PHAsset]) {
        // 빈 칸만 채운다
        var keys = chosen.map { library.key(for: $0) }
        switch s.kind {
        case .shooter(let camera, let shooterId, _):
            keys = keys.filter { store.record($0).shooter == nil }
            store.update(keys) { $0.shooter = shooterId }
            if always.contains(s.id) { store.edit { $0.rules[camera] = shooterId } }
        case .event(let eventId):
            keys = keys.filter { store.record($0).event == nil }
            store.update(keys) { $0.event = eventId }
        case .newEvent:
            return
        }
        store.edit { $0.dismissed.append(s.id) }
        let out = s.assets.count - chosen.count
        toast(out > 0 ? "\(keys.count)장 적용 · \(out)장 제외" : "\(keys.count)장에 적용했어요")
    }

    // MARK: 퍼슈트 묶음 제안

    /// 앨범을 조금씩 훑어 "이 사진들이 ○○ 같아요" 묶음을 만든다. 사진 앱의 인물 확인과 같은 흐름이다.
    private func scanSuits() async {
        let items = library.all.map { a -> (key: String, localId: String, people: [String]) in
            let key = library.key(for: a)
            return (key: key, localId: a.localIdentifier, people: store.record(key).people)
        }
        let singles = items.filter { $0.people.count == 1 }.map { (key: $0.key, localId: $0.localId, suitId: $0.people[0]) }
        guard !singles.isEmpty else {
            suitGroups = []
            return
        }
        await SuitMatcher.shared.reindex(singles)
        let result = await SuitMatcher.shared.groups(items, budget: 60)
        suitGroups = result.found.compactMap { id, locals -> SuitGroup? in
            let assets = locals.compactMap { library.byId[$0] }
            // 한두 장은 사진 상세에서 칩으로 충분하다. 묶음은 세 장부터.
            return assets.count >= 3 && store.person(id) != nil ? SuitGroup(id: id, assets: assets) : nil
        }
        .sorted { $0.assets.count > $1.assets.count }
        // 아직 안 훑은 사진이 남았으면 잠깐 쉬었다가 이어서 한다
        if result.left > 0 {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if !Task.isCancelled { suitTick += 1 }
        }
    }

    private func suitCard(_ g: SuitGroup) -> some View {
        let name = store.person(g.id)?.name ?? ""
        return VStack(alignment: .leading, spacing: 10) {
            Text("닮은 사진 \(g.assets.count)장").font(.system(size: 13)).foregroundStyle(Tone.g600)
            Text("이 사진들이 \(name) 인가요?").font(.system(size: 17, weight: .bold)).foregroundStyle(Tone.g900)
            HStack(spacing: 6) {
                ForEach(g.assets.prefix(4), id: \.localIdentifier) { a in
                    Thumb(asset: a, side: 80).frame(height: 80).frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            HStack(spacing: 10) {
                Button("아니요") {
                    // 전부 아니라고 알려 주면 이 퍼슈트는 다음부터 더 조심스럽게 추천한다
                    let pairs = g.assets.map { (localId: $0.localIdentifier, key: library.key(for: $0)) }
                    suitGroups.removeAll { $0.id == g.id }
                    Task {
                        for p in pairs { await SuitMatcher.shared.reject(localId: p.localId, key: p.key, suitId: g.id) }
                    }
                }
                .buttonStyle(FillButtonStyle())
                Button("확인하기") { suitReview = g }
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.onBlue)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(Tone.blue, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(Tone.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Tone.fill, lineWidth: 2))
    }

    private func acceptSuit(_ g: SuitGroup, _ chosen: [PHAsset]) {
        let picked = Set(chosen.map(\.localIdentifier))
        store.update(chosen.map { library.key(for: $0) }) { if !$0.people.contains(g.id) { $0.people.append(g.id) } }
        // 뺀 사진은 "아니야"로 기억한다
        let refused = g.assets.filter { !picked.contains($0.localIdentifier) }.map { (localId: $0.localIdentifier, key: library.key(for: $0)) }
        suitGroups.removeAll { $0.id == g.id }
        Task {
            for p in refused { await SuitMatcher.shared.reject(localId: p.localId, key: p.key, suitId: g.id) }
        }
        toast("\(store.person(g.id)?.name ?? "") · \(chosen.count)장")
    }

    // MARK: 목록

    @ViewBuilder
    private func eventRows(_ records: [PhotoRecord]) -> some View {
        let events = store.catalog.events.sorted { ($0.date ?? "") > ($1.date ?? "") }
        // 행사마다 장수와 대표 사진을 한 번만 훑어 모은다
        let pairs = Array(zip(library.all, records))
        let grouped = Dictionary(grouping: pairs) { $0.1.event ?? "" }
        if events.isEmpty, grouped[""] == nil { EmptyNote(text: "아직 등록된 항목이 없어요.") }
        ForEach(events) { e in
            let mine = grouped[e.id] ?? []
            NavigationLink(value: Route.photos(PhotoFilter(event: e.id))) {
                groupRow(e.name, [e.date.map(Day.dotted) ?? "날짜 미정", "\(mine.count)장"].joined(separator: " · "),
                         used: mine.filter { $0.1.isUsed }.count) {
                    if let logo = e.logo {
                        Avatar(data: logo, name: e.name, size: 60, round: false)
                    } else if let cover = mine.first?.0 {
                        Thumb(asset: cover, side: 60).frame(width: 60, height: 60)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    } else {
                        Avatar(data: nil, name: e.name, size: 60, round: false)
                    }
                }
            }
            .buttonStyle(.plain)
        }
        if let none = grouped[""] {
            NavigationLink(value: Route.photos(PhotoFilter(noEvent: true))) {
                groupRow("행사 미지정", "\(none.count)장", used: none.filter { $0.1.isUsed }.count) {
                    Avatar(data: nil, name: "?", size: 60, round: false)
                }
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private func shooterRows(_ records: [PhotoRecord]) -> some View {
        let counts = Dictionary(grouping: records.filter { $0.shooter != nil }, by: { $0.shooter! })
        let sorted = store.catalog.shooters.sorted { (counts[$0.id]?.count ?? 0) > (counts[$1.id]?.count ?? 0) }
        let none = records.filter { $0.shooter == nil }
        if sorted.isEmpty, none.isEmpty { EmptyNote(text: "아직 등록된 항목이 없어요.") }
        ForEach(sorted) { s in
            let mine = counts[s.id] ?? []
            NavigationLink(value: Route.photos(PhotoFilter(shooter: s.id))) {
                groupRow(s.name, [s.unknown ? nil : (s.x.map { "@\($0)" } ?? "X 아이디 없음"), "\(mine.count)장"].compactMap { $0 }.joined(separator: " · "),
                         used: mine.filter(\.isUsed).count) {
                    Avatar(data: s.avatar, name: s.name, size: 60)
                }
            }
            .buttonStyle(.plain)
        }
        if !none.isEmpty {
            NavigationLink(value: Route.photos(PhotoFilter(noShooter: true))) {
                groupRow("사진사 미지정", "\(none.count)장", used: none.filter(\.isUsed).count) { Avatar(data: nil, name: "?", size: 60) }
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private func personRows(_ records: [PhotoRecord]) -> some View {
        let rows = store.catalog.people.map { p in PersonRow(person: p, records: records.filter { $0.people.contains(p.id) }) }
            .filter { !$0.records.isEmpty }.sorted { $0.records.count > $1.records.count }
        if rows.isEmpty { EmptyNote(text: "사진에 퍼슈트를 지정하면 여기 모입니다.") }
        ForEach(rows) { row in
            let p = row.person
            let mine = row.records
            NavigationLink(value: Route.photos(PhotoFilter(person: p.id))) {
                groupRow(p.name, [p.role ?? p.x.map { "@\($0)" }, "\(mine.count)장"].compactMap { $0 }.joined(separator: " · "),
                         used: mine.filter(\.isUsed).count) {
                    Avatar(data: p.avatar, name: p.name, size: 60)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func groupRow<L: View>(_ title: String, _ meta: String, used: Int, @ViewBuilder lead: () -> L) -> some View {
        HStack(spacing: 14) {
            lead()
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 17, weight: .bold)).foregroundStyle(Tone.g900).lineLimit(1)
                Text(meta).font(.system(size: 13)).foregroundStyle(Tone.g600).lineLimit(1)
            }
            Spacer(minLength: 8)
            if used > 0 {
                Text("사용 \(used)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Tone.greenText)
                    .padding(.horizontal, 9)
                    .frame(height: 26)
                    .background(Tone.greenFill, in: Capsule())
            }
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.g400)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
    }
}

/// 몰려 있는 사진들을 어느 행사로 묶을지 — 기존 행사에 넣거나 새로 만든다
struct NewEventSheet: View {
    let assets: [PHAsset]
    let day: String
    let place: String?
    let done: () -> Void

    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @Environment(\.dismiss) private var dismiss
    @State private var join = false
    @State private var name = ""
    @State private var date: String?
    @State private var spot = ""

    var body: some View {
        SheetBody(title: "\(Day.dotted(day)) · \(assets.count)장") {
            if !store.catalog.events.isEmpty {
                Segmented(items: [SegItem(value: true, title: "기존 행사"), SegItem(value: false, title: "새 행사")], selection: $join)
            }
            if join {
                // 날짜가 가까운 행사부터
                let sorted = store.catalog.events.sorted { gap($0) < gap($1) }
                ForEach(sorted) { e in
                    Button {
                        assign(e.id, e.name)
                    } label: {
                        ListRow(e.name, sub: e.range, value: gapLabel(e), chevron: false)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                Field(label: "행사 이름", text: $name, placeholder: "예: 케이퍼리 2026")
                DayField(label: "행사 날짜", day: $date)
                Field(label: "장소 (선택)", text: $spot)
                Button("\(assets.count)장을 이 행사로") {
                    var e = EventRecord(name: String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60)))
                    e.date = date
                    e.place = spot.trimmingCharacters(in: .whitespaces).isEmpty ? nil : String(spot.prefix(40))
                    store.addEvent(e)
                    assign(e.id, e.name)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .onAppear {
            join = !store.catalog.events.isEmpty
            date = day
            spot = place ?? ""
        }
    }

    private func gap(_ e: EventRecord) -> Int { e.date.flatMap { Day.diff($0, day) }.map(abs) ?? 9999 }

    private func gapLabel(_ e: EventRecord) -> String? {
        let g = gap(e)
        if g == 0 { return "같은 날" }
        return g <= 3 ? "\(g)일 차이" : nil
    }

    private func assign(_ eventId: String, _ label: String) {
        // 빈 칸만 채운다
        let keys = assets.map { library.key(for: $0) }.filter { store.record($0).event == nil }
        store.update(keys) { $0.event = eventId }
        done()
        toast("\(label) · \(keys.count)장")
        dismiss()
    }
}

/// 여러 장 가운데 아닌 것을 빼고 적용하는 시트. 처음엔 전부 골라져 있다.
struct ReviewSheet: View {
    let title: String
    let assets: [PHAsset]
    let label: (Int) -> String
    let apply: ([PHAsset]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var picked: Set<String>

    init(title: String, assets: [PHAsset], preselected: Set<String>? = nil, label: @escaping (Int) -> String,
         apply: @escaping ([PHAsset]) -> Void) {
        self.title = title
        self.assets = assets
        self.label = label
        self.apply = apply
        _picked = State(initialValue: preselected ?? Set(assets.map(\.localIdentifier)))
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(title).font(.system(size: 22, weight: .bold)).foregroundStyle(Tone.g900).lineLimit(2)
                        Spacer()
                        Button(picked.isEmpty ? "전체 되돌리기" : "전체 빼기") {
                            picked = picked.isEmpty ? Set(assets.map(\.localIdentifier)) : []
                        }
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Tone.blueText)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)

                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 4), spacing: 2) {
                        ForEach(assets, id: \.localIdentifier) { a in
                            let on = picked.contains(a.localIdentifier)
                            Button {
                                if on { picked.remove(a.localIdentifier) } else { picked.insert(a.localIdentifier) }
                            } label: {
                                Color.clear.aspectRatio(1, contentMode: .fit)
                                    .overlay { Thumb(asset: a, side: 100) }
                                    .clipped()
                                    .opacity(on ? 1 : 0.35)
                                    .overlay(alignment: .topTrailing) { SelectMark(on: on).padding(6) }
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(on ? "사진 선택됨" : "사진 빠짐")
                        }
                    }
                }
            }
            Button(picked.isEmpty ? "적용할 사진이 없어요" : label(picked.count)) {
                apply(assets.filter { picked.contains($0.localIdentifier) })
                dismiss()
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(picked.isEmpty)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(Tone.bg)
        .presentationDragIndicator(.visible)
    }
}
