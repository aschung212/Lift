import Foundation
import Observation

@Observable
final class PreferencesStore {
    var features: FeatureToggles {
        didSet { persist() }
    }

    var enabledCount: Int { features.enabledCount }

    init() {
        if let data = UserDefaults.standard.data(forKey: "user-preferences"),
           let prefs = try? JSONDecoder().decode(UserPreferences.self, from: data) {
            self.features = prefs.features
        } else {
            self.features = FeatureToggles()
        }
    }

    func toggleFeature(_ id: String) {
        switch id {
        case "workouts": features.workouts.toggle()
        case "calendar": features.calendar.toggle()
        case "weight": features.weight.toggle()
        default: break
        }
    }

    private func persist() {
        let prefs = UserPreferences(features: features)
        if let data = try? JSONEncoder().encode(prefs) {
            UserDefaults.standard.set(data, forKey: "user-preferences")
        }
    }
}
