import SwiftUI

/// iOS 26 리퀴드 글래스. Xcode 26(Swift 6.2) SDK 로 빌드했고 기기가 iOS 26 이상이면 진짜 glassEffect,
/// 아니면 반투명 재질로 비슷하게. 앱 안의 버튼·세그먼트에 쓴다. 폼·내비게이션 바는 iOS 26 이 알아서 글래스로 그린다.
extension View {
    @ViewBuilder
    func liquidGlass(tint: Color? = nil) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            if let tint {
                self.glassEffect(.regular.tint(tint).interactive(), in: Capsule())
            } else {
                self.glassEffect(.regular.interactive(), in: Capsule())
            }
        } else {
            self.background(.ultraThinMaterial, in: Capsule())
        }
        #else
        self.background(.ultraThinMaterial, in: Capsule())
        #endif
    }

    @ViewBuilder
    func liquidGlassRect(cornerRadius: CGFloat = 16, tint: Color? = nil) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            if let tint {
                self.glassEffect(.regular.tint(tint).interactive(), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            } else {
                self.glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            }
        } else {
            self.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
        #else
        self.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        #endif
    }
}

extension View {
    /// 큰 카드·목록용 글래스(눌림 반응 없음)
    @ViewBuilder
    func liquidGlassCard(cornerRadius: CGFloat = 26) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else {
            self.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
        #else
        self.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        #endif
    }
}
