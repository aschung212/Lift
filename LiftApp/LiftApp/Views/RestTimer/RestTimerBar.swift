import SwiftUI

struct RestTimerBar: View {
    @Binding var showRestTimer: Bool
    @Environment(RestTimerStore.self) private var timer
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        let colors = theme.colors

        Button {
            showRestTimer = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "clock")
                    .font(.system(size: 14))
                    .opacity(0.8)

                if timer.isActive {
                    Text(timer.display)
                        .font(.system(size: 18, weight: .semibold))
                        .monospacedDigit()
                    Text("remaining")
                        .font(.system(size: 13, weight: .medium))
                        .opacity(0.8)
                } else {
                    Text("Start Rest Timer")
                        .font(.system(size: 14, weight: .medium))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .foregroundColor(timer.isActive ? .white : colors.textSecondary)
            .background(
                GeometryReader { geo in
                    if timer.isActive {
                        colors.accent
                            .overlay(alignment: .leading) {
                                Rectangle()
                                    .fill(Color.white.opacity(0.12))
                                    .frame(width: geo.size.width * timer.progress)
                                    .animation(.linear(duration: 1), value: timer.progress)
                            }
                    } else {
                        colors.bgSecondary
                    }
                }
            )
            .overlay(alignment: .top) {
                if !timer.isActive {
                    Rectangle().fill(colors.border).frame(height: 0.5)
                }
            }
        }
        .frame(height: 44)
        .frame(maxWidth: .infinity)
    }
}
