import Photos
import SwiftUI
import UIKit

/// 사진 한 장 — 상태, 분류, 사용 이력, 크레딧, 퍼슈트, 태그, 촬영 정보. 아래에 후보 담기와 사용하기.
struct PhotoView: View {
    let localId: String

    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var store: CatalogStore
    @Environment(\.openURL) private var openURL
    @State private var using = false
    @State private var tagging = false
    @State private var addingEvent = false
    @State private var addingShooter = false
    @State private var addingPerson = false
    @State private var removing: Usage?
    @State private var suggested: [String] = []
    /// 이 사진과 닮은 순서 — 퍼슈트 고르는 목록을 이 순서로 세운다
    @State private var ranked: [String] = []
    @State private var meta: PhotoMeta?

    var body: some View {
        if let asset = library.byId[localId] {
            content(asset)
        } else {
            // 사진 앱에서 지웠거나 폴더 밖으로 옮긴 경우. 기록은 지우지 않는다.
            EmptyNote(text: "이 사진은 사진첩 폴더에서 사라졌어요.")
        }
    }

    private func content(_ asset: PHAsset) -> some View {
        let key = library.key(for: asset)
        let r = store.record(key)
        let event = store.event(r.event)
        let shooter = store.shooter(r.shooter)

        return ScrollView {
            VStack(spacing: 0) {
                Thumb(asset: asset, side: 430, fit: true)
                    .frame(maxWidth: .infinity)
                    .frame(height: 400)
                    .clipped()

                VStack(alignment: .leading, spacing: 4) {
                    statePill(r).padding(.top, 14)

                    SectionHead("분류")
                    eventMenu(key, asset, event)
                    if let event {
                        NavigationLink(value: Route.event(event.id)) { ListRow("일정에서 열기", sub: event.range) }.buttonStyle(.plain)
                    }
                    shooterMenu(key, r, shooter)

                    SectionHead("SNS 사용 이력", count: r.usages.isEmpty ? nil : "\(r.usages.count)건")
                    if r.usages.isEmpty { EmptyNote(text: "아직 등록된 사용 이력이 없어요") }
                    ForEach(r.usages.sorted { $0.date > $1.date }) { use in useRow(use) }

                    if let shooter, !shooter.unknown {
                        SectionHead("사진사")
                        HStack(spacing: 12) {
                            Avatar(data: shooter.avatar, name: shooter.name)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(shooter.name).font(.system(size: 16, weight: .bold)).foregroundStyle(Tone.g900)
                                Text(shooter.x.map { "@\($0)" } ?? "X 아이디 없음").font(.system(size: 13)).foregroundStyle(Tone.g600)
                            }
                            Spacer()
                            Button("크레딧") {
                                if let text = store.credit(shooter.id) {
                                    UIPasteboard.general.string = text
                                    toast("\(text) 복사했어요")
                                } else {
                                    toast("\(shooter.name) 사진사의 X 아이디가 없어요")
                                }
                            }
                            .font(.system(size: 14, weight: .bold)).foregroundStyle(Tone.blueText)
                            .padding(.horizontal, 14).frame(height: 40)
                            .background(Tone.blueFill, in: Capsule())
                            .buttonStyle(.plain)
                        }
                        .frame(minHeight: 56)
                    }

                    SectionHead("같이 찍은 퍼슈트", count: r.people.isEmpty ? nil : "\(r.people.count)명")
                    people(key, r).padding(.vertical, 6)

                    SectionHead("태그")
                    FlowLayout(spacing: 8) {
                        ForEach(r.tags, id: \.self) { tag in
                            NavigationLink(value: Route.photos(PhotoFilter(tag: tag))) {
                                Text("#\(tag)").font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g900)
                                    .padding(.horizontal, 14).frame(height: 44).background(Tone.fill, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                        AddChip(label: "태그 추가") { tagging = true }
                    }
                    .padding(.vertical, 6)

                    SectionHead("촬영 정보")
                    info("촬영시각", asset.creationDate?.formatted(date: .numeric, time: .shortened))
                    info("카메라", meta?.camera)
                    info("렌즈", meta?.lens)
                    info("노출", [meta?.exposure, meta?.iso.map { "ISO \($0)" }].compactMap { $0 }.joined(separator: " · "))
                    info("해상도", "\(asset.pixelWidth) × \(asset.pixelHeight)")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        .background(Tone.bg)
        .navigationTitle("사진")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    let on = !r.isPlanned
                    store.update([key]) { $0.plannedAt = on ? Date() : nil }
                    toast(on ? "업로드 후보에 담았어요" : "후보에서 뺐어요")
                } label: {
                    Image(systemName: r.isPlanned ? "bookmark.fill" : "bookmark")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(r.isPlanned ? Tone.amber : Tone.g700)
                        .frame(width: 56, height: 56)
                        .background(Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(r.isPlanned ? "업로드 후보에서 빼기" : "업로드 후보로 담기")
                .sensoryFeedback(.selection, trigger: r.isPlanned)

                Button("사용하기") { using = true }.buttonStyle(PrimaryButtonStyle())
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Tone.bg)
        }
        .sheet(isPresented: $using) {
            UseSheet(asset: asset, recordKey: key, eventName: event?.name)
                .presentationDetents([.fraction(0.78), .large])
        }
        .sheet(isPresented: $tagging) { TagApplySheet(keys: [key]).presentationDetents([.medium]) }
        .namePrompt("새 행사", placeholder: "예: 케이퍼리 2026", isPresented: $addingEvent) { name in
            // 찍은 날을 행사 날짜로 잡는다
            var e = EventRecord(name: String(name.prefix(60)))
            e.date = asset.creationDate.map(Day.string)
            store.addEvent(e)
            store.update([key]) { $0.event = e.id }
        }
        .namePrompt("새 사진사", placeholder: "이름 또는 @아이디", isPresented: $addingShooter) { name in
            if let id = store.addShooter(name, x: name.hasPrefix("@") ? name : nil) { store.update([key]) { $0.shooter = id } }
        }
        .namePrompt("새 퍼슈트", isPresented: $addingPerson) { name in
            if let id = store.addPerson(name) { store.update([key]) { if !$0.people.contains(id) { $0.people.append(id) } } }
        }
        .confirm("이 기록을 지울까요?", message: "게시물은 그대로 남고, 이 앱의 기록만 지웁니다.", action: "기록 삭제",
                 isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            if let target = removing {
                store.update([key]) { $0.usages.removeAll { $0.id == target.id } }
                toast("기록을 지웠어요")
            }
            removing = nil
        }
        .task(id: r.people) {
            // 퍼슈트를 한 명만 태그한 사진들을 본보기로 삼아, 이 사진과 닮은 퍼슈트를 추천한다
            let singles = library.all.compactMap { a -> (key: String, localId: String, suitId: String)? in
                let k = library.key(for: a)
                let rec = store.record(k)
                return rec.people.count == 1 ? (key: k, localId: a.localIdentifier, suitId: rec.people[0]) : nil
            }
            await SuitMatcher.shared.reindex(singles)
            let ids = await SuitMatcher.shared.suggest(localId: localId, key: key, excluding: r.people)
            suggested = ids.filter { store.person($0) != nil }
            ranked = await SuitMatcher.shared.order(localId: localId)
        }
        .task { meta = await MetaStore.shared.load(localId) }
    }

    // MARK: 조각

    private func statePill(_ r: PhotoRecord) -> some View {
        if r.isPlanned { return Pill(text: "업로드 후보", color: "amber") }
        if r.isUsed { return Pill(text: "사용됨 \(r.usages.count)건", color: "green") }
        if r.isUnfiled { return Pill(text: "분류 필요", color: "red") }
        return Pill(text: "미사용", color: "gray")
    }

    private func eventMenu(_ key: String, _ asset: PHAsset, _ event: EventRecord?) -> some View {
        // 찍은 날과 가까운 행사가 위에 온다
        let day = asset.creationDate.map(Day.string) ?? Day.today
        let sorted = store.catalog.events.sorted {
            abs($0.date.flatMap { Day.diff($0, day) } ?? 9999) < abs($1.date.flatMap { Day.diff($0, day) } ?? 9999)
        }
        return Menu {
            ForEach(sorted) { e in
                Button {
                    store.update([key]) { $0.event = e.id }
                } label: {
                    if event?.id == e.id { Label(e.name, systemImage: "checkmark") } else { Text(e.name) }
                }
            }
            Divider()
            Button("새 행사 만들기", systemImage: "plus") { addingEvent = true }
            if event != nil {
                Button("지정 해제", systemImage: "xmark", role: .destructive) { store.update([key]) { $0.event = nil } }
            }
        } label: {
            ListRow("행사", value: event?.name ?? "행사 지정하기", tint: event == nil ? Tone.amberText : nil)
        }
    }

    private func shooterMenu(_ key: String, _ r: PhotoRecord, _ shooter: Shooter?) -> some View {
        Menu {
            ForEach(store.catalog.shooters.filter { !$0.unknown }) { s in
                Button {
                    store.update([key]) { $0.shooter = s.id }
                } label: {
                    if r.shooter == s.id { Label(s.name, systemImage: "checkmark") } else { Text(s.name) }
                }
            }
            Divider()
            Button("새 사진사 만들기", systemImage: "plus") { addingShooter = true }
            Button("사진사 미상으로 표시", systemImage: "questionmark.circle") {
                let id = store.unknownShooter()
                store.update([key]) { $0.shooter = id }
            }
            if r.shooter != nil {
                Button("지정 해제", systemImage: "xmark", role: .destructive) { store.update([key]) { $0.shooter = nil } }
            }
        } label: {
            ListRow("사진사", value: shooter?.name ?? "사진사 지정하기", tint: shooter == nil ? Tone.amberText : nil)
        }
    }

    private func people(_ key: String, _ r: PhotoRecord) -> some View {
        FlowLayout(spacing: 8) {
            ForEach(r.people, id: \.self) { id in
                Menu {
                    Button("빼기", systemImage: "minus.circle", role: .destructive) {
                        store.update([key]) { $0.people.removeAll { $0 == id } }
                    }
                } label: {
                    Text(store.person(id)?.name ?? "?")
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.g900)
                        .padding(.horizontal, 14).frame(height: 44).background(Tone.fill, in: Capsule())
                }
            }
            Menu {
                ForEach(candidates(r)) { p in
                    Button(p.name) { store.update([key]) { $0.people.append(p.id) } }
                }
                Divider()
                Button("새 퍼슈트 만들기", systemImage: "plus") { addingPerson = true }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(Tone.g700)
                    .frame(width: 44, height: 44).background(Tone.fill, in: Circle())
            }
            .accessibilityLabel("퍼슈트 추가")

            // 추천은 확정이 아니다 — 눌러야 붙는다. ✕ 로 "아니야"를 알려 주면 다음 추천이 그만큼 조심스러워진다.
            ForEach(suggested.filter { !r.people.contains($0) }, id: \.self) { id in
                HStack(spacing: 0) {
                    Button {
                        store.update([key]) { if !$0.people.contains(id) { $0.people.append(id) } }
                    } label: {
                        Label("\(store.person(id)?.name ?? "") 추천", systemImage: "plus")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(Tone.blueText)
                            .padding(.leading, 14).frame(height: 44)
                    }
                    .buttonStyle(.plain)
                    Button {
                        suggested.removeAll { $0 == id }
                        Task { await SuitMatcher.shared.reject(localId: localId, key: key, suitId: id) }
                    } label: {
                        Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Tone.blueText)
                            .frame(width: 40, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(store.person(id)?.name ?? "") 추천 아니야")
                }
                .background(Tone.blueFill, in: Capsule())
            }
        }
    }

    /// 아직 안 붙은 퍼슈트. 닮은 순으로, 비교할 수 없는 건 이름순으로 뒤에.
    private func candidates(_ r: PhotoRecord) -> [Person] {
        let rank = Dictionary(uniqueKeysWithValues: ranked.enumerated().map { ($0.element, $0.offset) })
        return store.catalog.people.filter { !r.people.contains($0.id) }.sorted { a, b in
            switch (rank[a.id], rank[b.id]) {
            case let (x?, y?): return x < y
            case (_?, nil): return true
            case (nil, _?): return false
            default: return a.name < b.name
            }
        }
    }

    private func useRow(_ use: Usage) -> some View {
        HStack(spacing: 10) {
            Text(badge(use.ch))
                .font(.system(size: 12, weight: .heavy)).foregroundStyle(.white)
                .frame(width: 40, height: 28)
                .background(Tone.green, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(use.url ?? "링크 없음").font(.system(size: 14, weight: .medium)).foregroundStyle(Tone.g900).lineLimit(1)
                Text("\(Day.dotted(use.date)) 게시").font(.system(size: 12)).foregroundStyle(Tone.g600)
            }
            Spacer(minLength: 4)
            if let text = use.url, let url = URL(string: "https://" + text) {
                IconButton(symbol: "arrow.up.right", label: "게시물 열기", color: Tone.blueText) { openURL(url) }
            }
            IconButton(symbol: "trash", label: "기록 삭제") { removing = use }
        }
        .frame(minHeight: 52)
    }

    private func badge(_ ch: String) -> String {
        switch ch {
        case "instagram": return "IG"
        case "x": return "X"
        case "blog": return "Blog"
        case "linkedin": return "in"
        case "threads": return "@"
        case "etc": return "etc"
        default: return "✓"
        }
    }

    @ViewBuilder
    private func info(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundStyle(Tone.g600)
            Spacer()
            Text(value.flatMap { $0.isEmpty ? nil : $0 } ?? "없음").font(.system(size: 14, weight: .medium)).foregroundStyle(Tone.g800)
        }
        .frame(minHeight: 36)
    }
}

/// 사용하기 — 공유 시트로 사진과 글을 한 번에 넘기고, 올렸으면 사용 기록을 남긴다
struct UseSheet: View {
    let asset: PHAsset
    let recordKey: String
    let eventName: String?

    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var busy = false
    @State private var copied = 0

    private var caption: String { store.copyText(shooter: store.record(recordKey).shooter, eventName: eventName) }

    var body: some View {
        SheetBody(title: "사용하기") {
            HStack(alignment: .top, spacing: 14) {
                Thumb(asset: asset, side: 80)
                    .frame(width: 64, height: 80)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(caption.isEmpty ? "복사할 텍스트가 없어요" : caption)
                    .font(.system(size: 15))
                    .foregroundStyle(caption.isEmpty ? Tone.g600 : Tone.g800)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(14)
            .background(Tone.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

            Button {
                share()
            } label: {
                if busy { ProgressView().tint(Tone.onBlue) } else { Label("공유하고 기록하기", systemImage: "square.and.arrow.up") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy)

            HStack(spacing: 10) {
                Button("사진 복사") { copyPhoto() }.buttonStyle(FillButtonStyle()).disabled(busy)
                Button("글 복사") {
                    UIPasteboard.general.string = caption
                    copied += 1
                    toast("글을 복사했어요")
                }
                .buttonStyle(FillButtonStyle())
                .disabled(caption.isEmpty)
            }
            .sensoryFeedback(.success, trigger: copied)

            LinkField(link: $link)

            Button("공유 없이 기록만") {
                record()
                dismiss()
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Tone.g700)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
        }
    }

    private func record() {
        let value = cleanLink(link)
        store.update([recordKey]) { r in
            r.usages.append(Usage(ch: value.map(channelOf) ?? "", url: value))
            r.plannedAt = nil
        }
        toast("사용 이력을 저장했어요")
    }

    private func share() {
        busy = true
        let text = caption
        Task {
            let file = await library.shareFile(asset)
            busy = false
            guard let file else {
                toast("사진을 가져오지 못했어요 (iCloud 원본)")
                return
            }
            let items: [Any] = text.isEmpty ? [file] : [file, text]
            Share.present(items) { posted in
                try? FileManager.default.removeItem(at: file)
                if posted {
                    record()
                    dismiss()
                }
            }
        }
    }

    private func copyPhoto() {
        busy = true
        Task {
            let image = await library.original(asset)
            busy = false
            if let image {
                UIPasteboard.general.image = image
                copied += 1
                toast("사진을 복사했어요")
            } else {
                toast("사진을 가져오지 못했어요 (iCloud 원본)")
            }
        }
    }
}

/// http(s):// 를 떼고, 비었으면 nil
func cleanLink(_ raw: String) -> String? {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    for head in ["https://", "http://"] where s.lowercased().hasPrefix(head) { s = String(s.dropFirst(head.count)) }
    return s.isEmpty ? nil : s
}

/// 게시물 링크 입력칸. 붙여넣으면 어느 채널인지 알아본다.
struct LinkField: View {
    @Binding var link: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("게시물 링크").font(.system(size: 13, weight: .medium)).foregroundStyle(Tone.g700)
            HStack(spacing: 8) {
                TextField("올린 뒤에 넣어도 돼요", text: $link)
                    .font(.system(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button("붙여넣기") {
                    if let text = UIPasteboard.general.string { link = text }
                }
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Tone.blueText)
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(Tone.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .buttonStyle(.plain)
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .frame(height: 52)
            .background(Tone.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            if let value = cleanLink(link) {
                let ch = channelOf(value)
                Text(ch == "etc" ? "처음 보는 도메인이에요. 기타로 저장됩니다." : "\(channelName(ch))으로 확인했어요")
                    .font(.system(size: 13)).foregroundStyle(Tone.g600)
            }
        }
    }
}

/// 게시물 기록 — 한 장 또는 여러 장을 한 게시물로
struct UsageSheet: View {
    let keys: [String]
    let done: () -> Void

    @EnvironmentObject private var store: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var day: String? = Day.today

    var body: some View {
        SheetBody(title: "게시물 기록", lead: keys.count > 1 ? "\(keys.count)장을 한 게시물로 기록해요." : nil) {
            LinkField(link: $link)
            DayField(label: "게시일", day: $day)
            Button("기록 저장") {
                let value = cleanLink(link)
                let hadPlanned = keys.contains { store.record($0).isPlanned }
                store.update(keys) { r in
                    r.usages.append(Usage(ch: value.map(channelOf) ?? "", url: value, date: day ?? Day.today))
                    r.plannedAt = nil
                }
                toast("사용 이력을 저장했어요 · \(keys.count)장" + (hadPlanned ? " · 후보에서 뺐어요" : ""))
                done()
                dismiss()
            }
            .buttonStyle(PrimaryButtonStyle())
        }
    }
}
