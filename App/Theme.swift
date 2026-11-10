import Photos
import SwiftUI
import UIKit

// 웹 버전(app.css)의 토스 톤 색을 그대로 옮겼다. 흰 바닥 + 회색 면, 블루는 액션에만.
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

enum Tone {
    static let bg = Color(light: 0xFFFFFF, dark: 0x17171C)
    static let card = Color(light: 0xFFFFFF, dark: 0x3A3A46)
    static let fill = Color(light: 0xF2F4F6, dark: 0x23232B)
    static let g900 = Color(light: 0x191F28, dark: 0xF7F8F9)
    static let g800 = Color(light: 0x333D4B, dark: 0xE4E7EB)
    static let g700 = Color(light: 0x4E5968, dark: 0xC3C9D1)
    static let g600 = Color(light: 0x6B7684, dark: 0x98A0AB)
    static let g400 = Color(light: 0xB0B8C1, dark: 0x5C646F)
    // 강조색은 설정의 테마 색을 따라간다
    static var blue: Color { Accent.main }
    static var blueText: Color { Accent.text }
    static var blueFill: Color { Accent.fill }
    static var onBlue: Color { Accent.onMain }
    static let red = Color(light: 0xF04452, dark: 0xFF6B78)
    static let amberText = Color(light: 0x9A5B00, dark: 0xFFB84D)
    static let amberFill = Color(light: 0xFFF9E7, dark: 0x2E2415)
    static let green = Color(light: 0x03B26C, dark: 0x2FD69B)
    static let greenText = Color(light: 0x027A4B, dark: 0x3ECF95)
    static let greenFill = Color(light: 0xF0FAF6, dark: 0x132A22)
    static let amber = Color(light: 0xEE8F11, dark: 0xFFB84D)
}

extension Date {
    /// 초 단위로 자른 지금. 저장(ISO 8601)했다가 읽어도 값이 그대로여야 병합 비교가 흔들리지 않는다.
    static var nowSec: Date { Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down)) }

    var dotted: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy.MM.dd"
        return f.string(from: self)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(Tone.onBlue)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(Tone.blue, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)
    }
}

struct FillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Tone.g800)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Tone.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

struct Chip: View {
    let title: String
    var on = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: on ? .bold : .medium))
                .foregroundStyle(on ? Tone.bg : Tone.g800)
                .padding(.horizontal, 14)
                .frame(height: 44)
                .background(on ? Tone.g900 : Tone.fill, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct AddChip: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Tone.g700)
                .frame(width: 44, height: 44)
                .background(Tone.fill, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

struct SegItem<V: Hashable>: Identifiable {
    let value: V
    let title: String
    var id: V { value }
}

/// 회색 면 위에 흰 알약이 미끄러지는 세그먼트
struct Segmented<V: Hashable>: View {
    let items: [SegItem<V>]
    @Binding var selection: V
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                let on = selection == item.value
                Button {
                    withAnimation(.snappy(duration: 0.22)) { selection = item.value }
                } label: {
                    Text(item.title)
                        .font(.system(size: 14, weight: on ? .bold : .medium))
                        .foregroundStyle(on ? Tone.g900 : Tone.g700)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background {
                            if on {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Tone.card)
                                    .shadow(color: .black.opacity(0.1), radius: 1.5, y: 1)
                                    .matchedGeometryEffect(id: "pill", in: ns)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Tone.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// 사진첩 사진 한 장. 셀이 재사용돼도 다른 사진이 비치지 않게 ID 가 바뀌면 비우고 다시 받는다.
struct Thumb: View {
    let asset: PHAsset
    var side: CGFloat = 130
    var fit = false
    @EnvironmentObject private var library: PhotoLibrary
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Tone.fill
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: fit ? .fit : .fill)
            }
        }
        .task(id: asset.localIdentifier) {
            image = nil
            library.thumbnail(asset, side: side) { got in
                if let got { image = got }
            }
        }
        .accessibilityHidden(true)
    }
}

/// 줄이 넘치면 다음 줄로 내려가는 칩 배치
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let r = arrange(proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? r.width, height: r.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let r = arrange(bounds.width, subviews)
        for (i, p) in r.points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], width: CGFloat, height: CGFloat) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0, x + s.width > width {
                x = 0
                y += rowH + spacing
                rowH = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += s.width + spacing
            rowH = max(rowH, s.height)
            maxX = max(maxX, x - spacing)
        }
        return (points, maxX, y + rowH)
    }
}

enum Share {
    /// 공유 시트를 맨 위 화면에 띄운다. 실제로 어딘가에 올렸을 때만 done(true).
    @MainActor
    static func present(_ items: [Any], done: @escaping (Bool) -> Void) {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        guard var top = scene?.keyWindow?.rootViewController else {
            done(false)
            return
        }
        while let next = top.presentedViewController { top = next }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // 복사·저장·에어드롭은 게시가 아니라서 사용 기록으로 치지 않는다
        let notPosting: Set<UIActivity.ActivityType> = [.copyToPasteboard, .saveToCameraRoll, .print, .assignToContact, .airDrop]
        vc.completionWithItemsHandler = { type, completed, _, _ in
            done(completed && !(type.map(notPosting.contains) ?? true))
        }
        top.present(vc, animated: true)
    }
}
