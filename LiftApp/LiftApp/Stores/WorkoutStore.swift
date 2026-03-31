import Foundation
import Observation

@Observable
final class WorkoutStore {
    var exercises: [Exercise] = []

    var allTags: [String] {
        Array(Set(exercises.flatMap(\.tags))).sorted()
    }

    init() {
        load()
    }

    // MARK: - Persistence

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: "workout-exercises"),
              let decoded = try? JSONDecoder().decode([Exercise].self, from: data) else { return }
        exercises = decoded
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(exercises) {
            UserDefaults.standard.set(data, forKey: "workout-exercises")
        }
    }

    // MARK: - Exercise CRUD

    func addExercise(name: String, tags: [String] = []) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        if let existing = exercises.first(where: { $0.name.lowercased() == trimmed.lowercased() }) {
            return existing.id
        }
        let id = UUID().uuidString
        exercises.append(Exercise(id: id, name: trimmed, tags: tags, sets: []))
        persist()
        return id
    }

    func renameExercise(id: String, newName: String) {
        guard let idx = exercises.firstIndex(where: { $0.id == id }) else { return }
        exercises[idx].name = newName.trimmingCharacters(in: .whitespaces)
        persist()
    }

    func updateExerciseTags(id: String, tags: [String]) {
        guard let idx = exercises.firstIndex(where: { $0.id == id }) else { return }
        exercises[idx].tags = tags
        persist()
    }

    func deleteExercise(id: String) {
        exercises.removeAll { $0.id == id }
        persist()
    }

    func reorderExercise(from: Int, to: Int) {
        exercises.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        persist()
    }

    // MARK: - Set CRUD

    func logSet(exerciseId: String, weight: Double, reps: Int, dateStr: String? = nil) {
        guard let idx = exercises.firstIndex(where: { $0.id == exerciseId }) else { return }
        let date = dateStr.map { Date.fromISO($0) } ?? Date()
        let e1rm = epley(weight, reps)
        let set = WorkoutSet(id: UUID().uuidString, date: date, weight: weight, reps: reps, estimated1RM: e1rm)
        exercises[idx].sets.append(set)
        persist()
    }

    func updateSet(exerciseId: String, setId: String, weight: Double, reps: Int, dateStr: String? = nil) {
        guard let exIdx = exercises.firstIndex(where: { $0.id == exerciseId }),
              let setIdx = exercises[exIdx].sets.firstIndex(where: { $0.id == setId }) else { return }
        exercises[exIdx].sets[setIdx].weight = weight
        exercises[exIdx].sets[setIdx].reps = reps
        exercises[exIdx].sets[setIdx].estimated1RM = epley(weight, reps)
        if let dateStr {
            exercises[exIdx].sets[setIdx].date = Date.fromISO(dateStr)
        }
        persist()
    }

    func deleteSet(exerciseId: String, setId: String) {
        guard let exIdx = exercises.firstIndex(where: { $0.id == exerciseId }) else { return }
        exercises[exIdx].sets.removeAll { $0.id == setId }
        persist()
    }

    func clearSets(exerciseId: String) {
        guard let idx = exercises.firstIndex(where: { $0.id == exerciseId }) else { return }
        exercises[idx].sets.removeAll()
        persist()
    }

    // MARK: - Getters

    func getExercisePR(_ exerciseId: String) -> Int? {
        exercises.first(where: { $0.id == exerciseId })?.pr
    }

    func filteredExercises(tags: [String]) -> [Exercise] {
        guard !tags.isEmpty else { return exercises }
        return exercises.filter { ex in
            tags.contains(where: { ex.tags.contains($0) })
        }
    }
}
