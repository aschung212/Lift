import SwiftUI

struct TabBarView: View {
    @Binding var activeTab: TabID
    @Binding var showSettings: Bool
    let visibleTabs: [TabID]
    @Environment(ThemeStore.self) private var theme

    // All items: visible tabs + settings
    private var allItemCount: Int { visibleTabs.count + 1 }

    var body: some View {
        let colors = theme.colors

        HStack(spacing: 0) {
            ForEach(visibleTabs, id: \.self) { tab in
                Button {
                    showSettings = false
                    activeTab = tab
                } label: {
                    VStack(spacing: 3) {
                        tabIcon(tab)
                            .font(.system(size: 18))
                            .frame(width: 24, height: 24)
                        Text(tab.rawValue.capitalized)
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundColor(activeTab == tab && !showSettings ? colors.accent : colors.textMuted)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                }
            }

            // Settings button
            Button {
                showSettings.toggle()
            } label: {
                VStack(spacing: 3) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 18))
                        .frame(width: 24, height: 24)
                    Text("Settings")
                        .font(.system(size: 11, weight: .semibold))
                }
                .foregroundColor(showSettings ? colors.accent : colors.textMuted)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(
            theme.glassEnabled
                ? AnyShapeStyle(.ultraThinMaterial)
                : AnyShapeStyle(colors.bgSecondary)
        )
        .overlay(alignment: .top) {
            Rectangle()
                .fill(colors.border)
                .frame(height: 0.5)
        }
    }

    @ViewBuilder
    private func tabIcon(_ tab: TabID) -> some View {
        switch tab {
        case .workouts: Image(systemName: "dumbbell")
        case .calendar: Image(systemName: "calendar")
        case .weight: Image(systemName: "scalemass")
        }
    }
}
