import Foundation

struct WorkoutSet: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var date: Date
    var weight: Double
    var reps: Int
    var estimated1RM: Int

    enum CodingKeys: String, CodingKey {
        case id, date, weight, reps
        case estimated1RM = "estimated1RM"
    }
}

struct Exercise: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var name: String
    var tags: [String]
    var sets: [WorkoutSet]

    var pr: Int? {
        sets.map(\.estimated1RM).max()
    }
}
