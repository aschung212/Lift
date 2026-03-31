import Foundation
import Observation

@Observable
final class BodyweightStore {
    var entries: [BodyweightEntry] = []

    var sortedEntries: [BodyweightEntry] {
        entries.sorted { $0.date > $1.date }
    }

    var latestWeight: Double? {
        sortedEntries.first?.weight
    }

    var minWeight: Double? {
        entries.map(\.weight).min()
    }

    var maxWeight: Double? {
        entries.map(\.weight).max()
    }

    init() {
        load()
    }

    // MARK: - Persistence

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: "bodyweight-entries"),
              let decoded = try? JSONDecoder().decode([BodyweightEntry].self, from: data) else { return }
        entries = decoded
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(entries) {
            UserDefaults.standard.set(data, forKey: "bodyweight-entries")
        }
    }

    // MARK: - CRUD

    func addEntry(weight: Double, dateStr: String? = nil) -> String {
        let date = dateStr.map { Date.fromISO($0) } ?? Date()
        let id = UUID().uuidString
        entries.append(BodyweightEntry(id: id, date: date, weight: weight))
        persist()
        return id
    }

    func updateEntry(id: String, weight: Double, dateStr: String? = nil) {
        guard let idx = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[idx].weight = weight
        if let dateStr { entries[idx].date = Date.fromISO(dateStr) }
        persist()
    }

    func deleteEntry(id: String) {
        entries.removeAll { $0.id == id }
        persist()
    }

    func clearAll() {
        entries.removeAll()
        persist()
    }

    // MARK: - Period Stats

    struct PeriodStats {
        let change: Double
        let min: Double
        let max: Double
        let avg: Double
        let count: Int
    }

    func filteredEntries(days: Int) -> [BodyweightEntry] {
        let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        return entries
            .filter { $0.date >= cutoff }
            .sorted { $0.date < $1.date }
    }

    func periodStats(days: Int) -> PeriodStats? {
        let filtered = filteredEntries(days: days)
        guard filtered.count >= 2 else { return nil }
        let weights = filtered.map(\.weight)
        let change = weights.last! - weights.first!
        return PeriodStats(
            change: (change * 10).rounded() / 10,
            min: weights.min()!,
            max: weights.max()!,
            avg: (weights.reduce(0, +) / Double(weights.count) * 10).rounded() / 10,
            count: filtered.count
        )
    }
}
