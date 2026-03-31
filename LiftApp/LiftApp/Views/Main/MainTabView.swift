import SwiftUI

enum TabID: String, CaseIterable {
    case workouts, calendar, weight
}

struct MainTabView: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(PreferencesStore.self) private var prefs
    @Environment(RestTimerStore.self) private var restTimer

    @State private var activeTab: TabID
    @State private var showSettings = false
    @State private var showRestTimer = false
    @State private var hasSampleData = UserDefaults.standard.bool(forKey: "sample-data")

    init() {
        let saved = UserDefaults.standard.string(forKey: "active-tab") ?? "workouts"
        _activeTab = State(initialValue: TabID(rawValue: saved) ?? .workouts)
    }

    var visibleTabs: [TabID] {
        TabID.allCases.filter { tab in
            switch tab {
            case .workouts: return prefs.features.workouts
            case .calendar: return prefs.features.calendar
            case .weight: return prefs.features.weight
            }
        }
    }

    var body: some View {
        let colors = theme.colors

        VStack(spacing: 0) {
            // Content
            VStack(spacing: 0) {
                if hasSampleData {
                    SampleDataBanner {
                        clearSampleData()
                    }
                }

                Group {
                    switch activeTab {
                    case .workouts: WorkoutsView(showRestTimer: $showRestTimer)
                    case .calendar: CalendarTabView()
                    case .weight: BodyweightView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            // Rest timer bar
            if theme.restTimerEnabled && !showRestTimer {
                RestTimerBar(showRestTimer: $showRestTimer)
            }

            // Tab bar
            TabBarView(
                activeTab: $activeTab,
                showSettings: $showSettings,
                visibleTabs: visibleTabs
            )
        }
        .background(colors.bgPrimary)
        .sheet(isPresented: $showSettings) {
            SettingsSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.hidden)
        }
        .sheet(isPresented: $showRestTimer) {
            RestTimerSheet()
        }
        .onChange(of: activeTab) { _, newTab in
            UserDefaults.standard.set(newTab.rawValue, forKey: "active-tab")
            showSettings = false
        }
    }

    @Environment(WorkoutStore.self) private var workoutStore
    @Environment(BodyweightStore.self) private var bodyweightStore

    private func clearSampleData() {
        let ids = workoutStore.exercises.map(\.id)
        for id in ids { workoutStore.deleteExercise(id: id) }
        bodyweightStore.clearAll()
        UserDefaults.standard.removeObject(forKey: "sample-data")
        hasSampleData = false
    }
}
