import SwiftUI
import UIKit

// 여러 화면이 같이 쓰는 부품

struct Avatar: View {
    let data: Data?
    let name: String
    var size: CGFloat = 44
    var round = true

    var body: some View {
        Group {
            if let data, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(String(name.replacingOccurrences(of: "@", with: "").replacingOccurrences(of: "#", with: "").prefix(1)).uppercased())
                    .font(.system(size: size * 0.38, weight: .bold))
                    .foregroundStyle(Tone.g700)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Tone.g400.opacity(0.28))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: round ? size / 2 : size * 0.27, style: .continuous))
        .accessibilityHidden(true)
    }
}

struct SectionHead<Trailing: View>: View {
    let title: String
    var count: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title).font(.system(size: 17, weight: .bold)).foregroundStyle(Tone.g900)
            if let count { Text(count).font(.system(size: 14, weight: .medium)).foregroundStyle(Tone.g600) }
            Spacer()
            trailing()
        }
        .padding(.top, 14)
    }
}

extension SectionHead where Trailing == EmptyView {
    init(_ title: String, count: String? = nil) {
        self.init(title: title, count: count) { EmptyView() }
    }
}

/// 목록 한 줄 — 왼쪽 그림, 제목·부제, 오른쪽 값, 꺾쇠
struct ListRow<Lead: View>: View {
    let title: String
    var sub: String?
    var value: String?
    var chevron = true
    var tint: Color?
    @ViewBuilder var lead: () -> Lead

    var body: some View {
        HStack(spacing: 14) {
            lead()
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 16, weight: .bold)).foregroundStyle(tint ?? Tone.g900).lineLimit(1)
                if let sub, !sub.isEmpty {
                    Text(sub).font(.system(size: 13)).foregroundStyle(Tone.g600).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            if let value { Text(value).font(.system(size: 14)).foregroundStyle(Tone.g600) }
            if chevron {
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.g400)
            }
        }
        .frame(minHeight: 52)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

extension ListRow where Lead == EmptyView {
    init(_ title: String, sub: String? = nil, value: String? = nil, chevron: Bool = true, tint: Color? = nil) {
        self.init(title: title, sub: sub, value: value, chevron: chevron, tint: tint) { EmptyView() }
    }
}

/// 색이 있는 작은 알약 (카테고리·상태)
struct Pill: View {
    let text: String
    var color = "gray"

    var body: some View {
        let c = TagColor.pair(color)
        Text(text)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(c.text)
            .padding(.horizontal, 9)
            .frame(height: 24)
            .background(c.fill, in: Capsule())
    }
}

/// 회색 면 카드
struct Card<Content: View>: View {
    var fill = Tone.fill
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// 아래에서 올라오는 시트의 뼈대
struct SheetBody<Content: View>: View {
    let title: String
    var lead: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(title).font(.system(size: 22, weight: .bold)).foregroundStyle(Tone.g900).padding(.top, 32)
                if let lead { Text(lead).font(.system(size: 14)).foregroundStyle(Tone.g600) }
                content()
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Tone.bg)
        .presentationDragIndicator(.visible)
    }
}

/// 이름표 달린 입력칸
struct Field: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var plain = false
    var multiline = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(Tone.g700)
            Group {
                if multiline {
                    TextField(placeholder, text: $text, axis: .vertical).lineLimit(3...6)
                } else {
                    TextField(placeholder, text: $text)
                }
            }
            .font(.system(size: 16))
            .textInputAutocapitalization(plain ? .never : .sentences)
            .autocorrectionDisabled(plain)
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(Tone.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}

/// 날짜(없을 수도 있는) 고르기. 값은 "YYYY-MM-DD".
/// 날짜를 우리 글씨로 보여주고, 누르면 달력이 올라온다.
struct DayField: View {
    let label: String
    @Binding var day: String?
    @State private var picking = false

    private static let pretty: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "yyyy.MM.dd (E)"
        return f
    }()

    var body: some View {
        HStack(spacing: 4) {
            Text(label).font(.system(size: 15)).foregroundStyle(Tone.g700)
            Spacer()
            Button {
                if day == nil { day = Day.today }
                picking = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "calendar").font(.system(size: 14, weight: .semibold))
                    Text(day.map { Self.pretty.string(from: Day.local($0)) } ?? "정하기")
                        .font(.system(size: 15, weight: .bold).monospacedDigit())
                }
                .foregroundStyle(day == nil ? Tone.blueText : Tone.g900)
                .padding(.horizontal, 14)
                .frame(height: 40)
                .background(day == nil ? Tone.blueFill : Tone.fill, in: Capsule())
            }
            .buttonStyle(.plain)
            if day != nil {
                IconButton(symbol: "xmark", label: "\(label) 지우기") { day = nil }
            }
        }
        .frame(minHeight: 48)
        .sheet(isPresented: $picking) {
            VStack(spacing: 8) {
                DatePicker(label, selection: Binding(get: { Day.local(day ?? Day.today) }, set: { day = Day.string($0) }),
                           displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.locale, Locale(identifier: "ko_KR"))
                Button("완료") { picking = false }.buttonStyle(PrimaryButtonStyle())
            }
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .presentationDetents([.height(480)])
            .presentationDragIndicator(.visible)
        }
    }
}

/// 켜고 끄는 줄
struct SwitchRow: View {
    let title: String
    var sub: String?
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 16, weight: .bold)).foregroundStyle(Tone.g900)
                if let sub { Text(sub).font(.system(size: 13)).foregroundStyle(Tone.g600) }
            }
        }
        .tint(Tone.green)
        .frame(minHeight: 52)
        .padding(.vertical, 4)
    }
}

/// 체크 표시가 있는 한 줄 (체크리스트·할 일)
struct CheckRow<Trailing: View>: View {
    let text: String
    let done: Bool
    var sub: String?
    let toggle: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            Button(action: toggle) {
                HStack(spacing: 12) {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 24))
                        .foregroundStyle(done ? Tone.green : Tone.g400)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(text)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(done ? Tone.g600 : Tone.g900)
                            .strikethrough(done, color: Tone.g400)
                        if let sub { Text(sub).font(.system(size: 12)).foregroundStyle(Tone.g600) }
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(done ? .isSelected : [])
            trailing()
        }
        .sensoryFeedback(.selection, trigger: done)
    }
}

extension CheckRow where Trailing == EmptyView {
    init(text: String, done: Bool, sub: String? = nil, toggle: @escaping () -> Void) {
        self.init(text: text, done: done, sub: sub, toggle: toggle) { EmptyView() }
    }
}

/// 작은 아이콘 버튼 (지우기·고정 등)
struct IconButton: View {
    let symbol: String
    let label: String
    var color = Tone.g600
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// 한 줄 입력 + 추가 버튼
struct AddLine: View {
    let placeholder: String
    let add: (String) -> Void
    @State private var text = ""

    var body: some View {
        HStack(spacing: 8) {
            TextField(placeholder, text: $text)
                .font(.system(size: 16))
                .onSubmit(submit)
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(Tone.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            Button("추가", action: submit)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Tone.blueText)
                .frame(width: 60, height: 48)
                .background(Tone.blueFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .buttonStyle(.plain)
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func submit() {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        add(value)
        text = ""
    }
}

struct EmptyNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(Tone.g600)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 22)
    }
}

// MARK: 토스트

@MainActor
final class Toaster: ObservableObject {
    static let shared = Toaster()
    @Published private(set) var text: String?
    private var hide: Task<Void, Never>?

    func show(_ message: String) {
        text = message
        hide?.cancel()
        hide = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            if !Task.isCancelled { self?.text = nil }
        }
    }
}

@MainActor
func toast(_ message: String) { Toaster.shared.show(message) }

struct ToastHost: ViewModifier {
    @ObservedObject private var toaster = Toaster.shared

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let text = toaster.text {
                Text(text)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Tone.g900)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 44)
                    .liquidGlass()
                    .padding(.bottom, 96)
                    .padding(.horizontal, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .animation(.snappy(duration: 0.25), value: toaster.text)
    }
}

/// 이름 하나만 받는 알림창
struct NamePrompt: ViewModifier {
    let title: String
    var placeholder = "이름"
    var action = "만들기"
    @Binding var isPresented: Bool
    let done: (String) -> Void
    @State private var name = ""

    func body(content: Content) -> some View {
        content.alert(title, isPresented: $isPresented) {
            TextField(placeholder, text: $name)
            Button(action) {
                let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
                name = ""
                if !value.isEmpty { done(value) }
            }
            Button("취소", role: .cancel) { name = "" }
        }
    }
}

extension View {
    func namePrompt(_ title: String, placeholder: String = "이름", action: String = "만들기", isPresented: Binding<Bool>,
                    done: @escaping (String) -> Void) -> some View {
        modifier(NamePrompt(title: title, placeholder: placeholder, action: action, isPresented: isPresented, done: done))
    }

    /// 되돌릴 수 없는 동작 앞의 확인
    func confirm(_ title: String, message: String? = nil, action: String, isPresented: Binding<Bool>, run: @escaping () -> Void) -> some View {
        confirmationDialog(title, isPresented: isPresented, titleVisibility: .visible) {
            Button(action, role: .destructive, action: run)
            Button("취소", role: .cancel) {}
        } message: {
            if let message { Text(message) }
        }
    }
}
