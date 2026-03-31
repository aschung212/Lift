import Foundation

struct BodyweightEntry: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var date: Date
    var weight: Double
}
