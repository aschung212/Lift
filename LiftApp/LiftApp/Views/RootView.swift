import SwiftUI

struct RootView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(\.colorScheme) private var systemScheme
    @State private var onboardingComplete = UserDefaults.standard.bool(forKey: "onboarding-complete")

    var body: some View {
        Group {
            if !onboardingComplete {
                OnboardingScreen(onComplete: {
                    onboardingComplete = true
                })
            } else {
                MainTabView()
            }
        }
        .preferredColorScheme(theme.colorMode == .dark ? .dark : theme.colorMode == .light ? .light : nil)
        .onChange(of: systemScheme, initial: true) { _, newScheme in
            theme.systemIsDark = newScheme == .dark
        }
    }
}
