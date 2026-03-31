import SwiftUI

struct SampleDataBanner: View {
    let onClear: () -> Void
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        Button(action: onClear) {
            Text("Viewing sample data -- Tap to clear and start fresh")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(theme.colors.accent)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
                .background(theme.colors.accentSubtle)
        }
    }
}
