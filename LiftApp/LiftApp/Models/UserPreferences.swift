import Foundation

struct FeatureToggles: Codable, Equatable {
    var workouts: Bool = true
    var calendar: Bool = true
    var weight: Bool = true

    var enabledCount: Int {
        [workouts, calendar, weight].filter { $0 }.count
    }
}

struct UserPreferences: Codable, Equatable {
    var features: FeatureToggles = FeatureToggles()
}
