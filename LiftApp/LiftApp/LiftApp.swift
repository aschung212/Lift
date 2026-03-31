import SwiftUI

@main
struct LiftApp: App {
    @State private var themeStore = ThemeStore()
    @State private var workoutStore = WorkoutStore()
    @State private var bodyweightStore = BodyweightStore()
    @State private var preferencesStore = PreferencesStore()
    @State private var restTimerStore = RestTimerStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(themeStore)
                .environment(workoutStore)
                .environment(bodyweightStore)
                .environment(preferencesStore)
                .environment(restTimerStore)
        }
    }
}
