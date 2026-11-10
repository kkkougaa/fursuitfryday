import SwiftUI

@main
struct FursuitFrydayApp: App {
    @StateObject private var store: CatalogStore
    @StateObject private var library: PhotoLibrary
    @StateObject private var meta = MetaStore.shared
    @Environment(\.scenePhase) private var phase

    init() {
        let s = CatalogStore()
        _store = StateObject(wrappedValue: s)
        _library = StateObject(wrappedValue: PhotoLibrary(store: s))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(library)
                .environmentObject(meta)
                .tint(Tone.blue)
                .modifier(ToastHost())
                .onChange(of: phase) { _, now in
                    if now == .active {
                        // 사진 앱에서 앨범을 고치고 돌아온 경우를 바로 반영한다
                        library.reload()
                    } else if now == .background {
                        store.saveNow()
                    }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var library: PhotoLibrary

    var body: some View {
        if library.isReady {
            MainTabs()
        } else {
            SetupView(firstRun: true)
        }
    }
}

struct MainTabs: View {
    @EnvironmentObject private var store: CatalogStore
    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var meta: MetaStore

    var body: some View {
        let o = store.catalog.opts
        let home = o.homeTab.isEmpty ? (o.homeTitle.isEmpty ? "모아보기" : o.homeTitle) : o.homeTab
        TabView {
            NavigationStack { HomeView().routes() }
                .tabItem { Label(home, systemImage: "square.grid.2x2") }
            NavigationStack { PhotosView(filter: PhotoFilter(), isTab: true).routes() }
                .tabItem { Label("사진", systemImage: "photo") }
            NavigationStack { ScheduleView().routes() }
                .tabItem { Label("일정", systemImage: "calendar") }
            NavigationStack { ProfileView().routes() }
                .tabItem { Label("프로필", systemImage: "person") }
        }
    }
}

/// 사진 탭의 거르기 조건
struct PhotoFilter: Hashable {
    /// 행사나 사진사가 비어 있는 사진 (모아보기의 "정리하기"에서 온다)
    var unset = false
    var noEvent = false
    var noShooter = false
    var unused = false
    /// 업로드 후보
    var planned = false
    var event: String?
    var shooter: String?
    var person: String?
    var tag: String?
    /// 들어가자마자 선택 모드
    var selecting = false

    var isActive: Bool { unset || noEvent || noShooter || unused || planned || event != nil || shooter != nil || person != nil || tag != nil }
}

/// 화면 이동 값. 사진은 사진첩의 로컬 ID 로 가리킨다.
enum Route: Hashable {
    case photos(PhotoFilter)
    case photo(String)
    case event(String)
    case checklist(String)
    case packing
    case suit(String)
    case settings
    case tagBrowse
    case tagManage
    case copyTemplate
    case shooters
    case people
    case categories
    case careTags
}

extension View {
    func routes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .photos(let filter): PhotosView(filter: filter)
            case .photo(let id): PhotoView(localId: id)
            case .event(let id): EventDetailView(eventId: id)
            case .checklist(let id): ChecklistView(eventId: id)
            case .packing: PackingView()
            case .suit(let id): SuitDetailView(suitId: id)
            case .settings: SettingsView()
            case .tagBrowse: TagBrowseView()
            case .tagManage: TagManageView()
            case .copyTemplate: CopyTemplateView()
            case .shooters: PeopleListView(kind: .shooter)
            case .people: PeopleListView(kind: .person)
            case .categories: TagListView(care: false)
            case .careTags: TagListView(care: true)
            }
        }
    }
}
