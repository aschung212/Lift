import Foundation

struct StarterExercise {
    let name: String
    let tags: [String]
}

let starterExercises: [StarterExercise] = [
    StarterExercise(name: "Bench Press", tags: ["Push", "Chest"]),
    StarterExercise(name: "Squat", tags: ["Legs"]),
    StarterExercise(name: "Deadlift", tags: ["Pull", "Legs"]),
    StarterExercise(name: "Overhead Press", tags: ["Push", "Shoulders"]),
    StarterExercise(name: "Barbell Row", tags: ["Pull", "Back"]),
    StarterExercise(name: "Pull-ups", tags: ["Pull", "Back"]),
]

struct SampleSet {
    let weight: Double
    let reps: Int
    let daysAgo: Int
}

struct SampleExerciseData {
    let name: String
    let sets: [SampleSet]
}

let sampleExerciseSets: [SampleExerciseData] = [
    SampleExerciseData(name: "Bench Press", sets: [
        SampleSet(weight: 115, reps: 10, daysAgo: 118), SampleSet(weight: 115, reps: 8, daysAgo: 115),
        SampleSet(weight: 125, reps: 8, daysAgo: 111), SampleSet(weight: 125, reps: 8, daysAgo: 108),
        SampleSet(weight: 135, reps: 6, daysAgo: 104), SampleSet(weight: 125, reps: 10, daysAgo: 101),
        SampleSet(weight: 135, reps: 8, daysAgo: 97), SampleSet(weight: 135, reps: 7, daysAgo: 94),
        SampleSet(weight: 145, reps: 5, daysAgo: 90), SampleSet(weight: 135, reps: 8, daysAgo: 87),
        SampleSet(weight: 145, reps: 6, daysAgo: 83), SampleSet(weight: 145, reps: 6, daysAgo: 80),
        SampleSet(weight: 155, reps: 5, daysAgo: 76), SampleSet(weight: 145, reps: 8, daysAgo: 73),
        SampleSet(weight: 155, reps: 5, daysAgo: 69), SampleSet(weight: 155, reps: 6, daysAgo: 62),
        SampleSet(weight: 165, reps: 4, daysAgo: 55), SampleSet(weight: 155, reps: 7, daysAgo: 52),
        SampleSet(weight: 155, reps: 8, daysAgo: 48), SampleSet(weight: 165, reps: 5, daysAgo: 41),
        SampleSet(weight: 165, reps: 5, daysAgo: 38), SampleSet(weight: 170, reps: 4, daysAgo: 34),
        SampleSet(weight: 155, reps: 10, daysAgo: 31), SampleSet(weight: 175, reps: 3, daysAgo: 27),
        SampleSet(weight: 165, reps: 6, daysAgo: 24), SampleSet(weight: 175, reps: 4, daysAgo: 20),
        SampleSet(weight: 165, reps: 8, daysAgo: 17), SampleSet(weight: 175, reps: 5, daysAgo: 13),
        SampleSet(weight: 180, reps: 3, daysAgo: 10), SampleSet(weight: 165, reps: 8, daysAgo: 6),
        SampleSet(weight: 185, reps: 3, daysAgo: 3),
    ]),
    SampleExerciseData(name: "Squat", sets: [
        SampleSet(weight: 155, reps: 8, daysAgo: 117), SampleSet(weight: 155, reps: 8, daysAgo: 114),
        SampleSet(weight: 175, reps: 6, daysAgo: 110), SampleSet(weight: 165, reps: 8, daysAgo: 107),
        SampleSet(weight: 185, reps: 5, daysAgo: 103), SampleSet(weight: 175, reps: 8, daysAgo: 100),
        SampleSet(weight: 185, reps: 6, daysAgo: 96), SampleSet(weight: 185, reps: 6, daysAgo: 93),
        SampleSet(weight: 195, reps: 5, daysAgo: 89), SampleSet(weight: 185, reps: 8, daysAgo: 83),
        SampleSet(weight: 205, reps: 4, daysAgo: 76), SampleSet(weight: 195, reps: 6, daysAgo: 69),
        SampleSet(weight: 205, reps: 5, daysAgo: 62), SampleSet(weight: 195, reps: 8, daysAgo: 55),
        SampleSet(weight: 215, reps: 4, daysAgo: 48), SampleSet(weight: 205, reps: 6, daysAgo: 41),
        SampleSet(weight: 225, reps: 3, daysAgo: 34), SampleSet(weight: 205, reps: 7, daysAgo: 27),
        SampleSet(weight: 225, reps: 4, daysAgo: 20), SampleSet(weight: 215, reps: 6, daysAgo: 13),
        SampleSet(weight: 235, reps: 3, daysAgo: 6), SampleSet(weight: 225, reps: 5, daysAgo: 2),
    ]),
    SampleExerciseData(name: "Deadlift", sets: [
        SampleSet(weight: 185, reps: 8, daysAgo: 105), SampleSet(weight: 205, reps: 5, daysAgo: 98),
        SampleSet(weight: 205, reps: 6, daysAgo: 91), SampleSet(weight: 225, reps: 5, daysAgo: 84),
        SampleSet(weight: 215, reps: 6, daysAgo: 77), SampleSet(weight: 245, reps: 3, daysAgo: 70),
        SampleSet(weight: 225, reps: 6, daysAgo: 63), SampleSet(weight: 245, reps: 4, daysAgo: 56),
        SampleSet(weight: 235, reps: 5, daysAgo: 49), SampleSet(weight: 255, reps: 3, daysAgo: 42),
        SampleSet(weight: 245, reps: 5, daysAgo: 35), SampleSet(weight: 265, reps: 3, daysAgo: 28),
        SampleSet(weight: 245, reps: 6, daysAgo: 21), SampleSet(weight: 275, reps: 2, daysAgo: 14),
        SampleSet(weight: 255, reps: 5, daysAgo: 7), SampleSet(weight: 285, reps: 2, daysAgo: 2),
    ]),
    SampleExerciseData(name: "Overhead Press", sets: [
        SampleSet(weight: 65, reps: 10, daysAgo: 100), SampleSet(weight: 75, reps: 8, daysAgo: 93),
        SampleSet(weight: 75, reps: 8, daysAgo: 86), SampleSet(weight: 85, reps: 6, daysAgo: 79),
        SampleSet(weight: 80, reps: 8, daysAgo: 72), SampleSet(weight: 85, reps: 7, daysAgo: 65),
        SampleSet(weight: 90, reps: 5, daysAgo: 58), SampleSet(weight: 85, reps: 8, daysAgo: 51),
        SampleSet(weight: 95, reps: 4, daysAgo: 44), SampleSet(weight: 85, reps: 10, daysAgo: 37),
        SampleSet(weight: 95, reps: 5, daysAgo: 30), SampleSet(weight: 95, reps: 6, daysAgo: 23),
        SampleSet(weight: 100, reps: 4, daysAgo: 16), SampleSet(weight: 95, reps: 7, daysAgo: 9),
        SampleSet(weight: 105, reps: 3, daysAgo: 3),
    ]),
    SampleExerciseData(name: "Barbell Row", sets: [
        SampleSet(weight: 95, reps: 10, daysAgo: 95), SampleSet(weight: 115, reps: 8, daysAgo: 88),
        SampleSet(weight: 115, reps: 8, daysAgo: 81), SampleSet(weight: 125, reps: 6, daysAgo: 74),
        SampleSet(weight: 125, reps: 8, daysAgo: 67), SampleSet(weight: 135, reps: 5, daysAgo: 60),
        SampleSet(weight: 125, reps: 10, daysAgo: 53), SampleSet(weight: 135, reps: 6, daysAgo: 46),
        SampleSet(weight: 135, reps: 7, daysAgo: 39), SampleSet(weight: 145, reps: 5, daysAgo: 32),
        SampleSet(weight: 135, reps: 8, daysAgo: 25), SampleSet(weight: 145, reps: 6, daysAgo: 18),
        SampleSet(weight: 155, reps: 4, daysAgo: 11), SampleSet(weight: 145, reps: 8, daysAgo: 4),
    ]),
]

struct SampleWeight {
    let weight: Double
    let daysAgo: Int
}

let sampleWeights: [SampleWeight] = [
    SampleWeight(weight: 185.0, daysAgo: 120), SampleWeight(weight: 184.5, daysAgo: 116),
    SampleWeight(weight: 185.5, daysAgo: 112), SampleWeight(weight: 184.0, daysAgo: 109),
    SampleWeight(weight: 183.5, daysAgo: 105), SampleWeight(weight: 184.0, daysAgo: 101),
    SampleWeight(weight: 183.0, daysAgo: 98), SampleWeight(weight: 182.5, daysAgo: 94),
    SampleWeight(weight: 183.0, daysAgo: 91), SampleWeight(weight: 182.0, daysAgo: 87),
    SampleWeight(weight: 181.5, daysAgo: 84), SampleWeight(weight: 182.0, daysAgo: 80),
    SampleWeight(weight: 181.0, daysAgo: 77), SampleWeight(weight: 180.5, daysAgo: 73),
    SampleWeight(weight: 180.0, daysAgo: 70), SampleWeight(weight: 179.5, daysAgo: 66),
    SampleWeight(weight: 180.0, daysAgo: 63), SampleWeight(weight: 179.0, daysAgo: 59),
    SampleWeight(weight: 178.5, daysAgo: 56), SampleWeight(weight: 178.0, daysAgo: 52),
    SampleWeight(weight: 178.5, daysAgo: 49), SampleWeight(weight: 177.5, daysAgo: 45),
    SampleWeight(weight: 177.0, daysAgo: 42), SampleWeight(weight: 176.5, daysAgo: 38),
    SampleWeight(weight: 177.0, daysAgo: 35), SampleWeight(weight: 176.0, daysAgo: 31),
    SampleWeight(weight: 175.5, daysAgo: 28), SampleWeight(weight: 175.0, daysAgo: 24),
    SampleWeight(weight: 175.5, daysAgo: 21), SampleWeight(weight: 174.5, daysAgo: 17),
    SampleWeight(weight: 174.0, daysAgo: 14), SampleWeight(weight: 173.5, daysAgo: 10),
    SampleWeight(weight: 174.0, daysAgo: 7), SampleWeight(weight: 173.0, daysAgo: 4),
    SampleWeight(weight: 172.5, daysAgo: 1),
]

func populateSampleData(workoutStore: WorkoutStore, bodyweightStore: BodyweightStore) {
    for group in sampleExerciseSets {
        let starter = starterExercises.first(where: { $0.name == group.name })
        if let id = workoutStore.addExercise(name: group.name, tags: starter?.tags ?? []) {
            for s in group.sets {
                workoutStore.logSet(exerciseId: id, weight: s.weight, reps: s.reps, dateStr: Date.daysAgo(s.daysAgo).isoDate)
            }
        }
    }
    // Add remaining starter exercises without sets
    for ex in starterExercises {
        if !sampleExerciseSets.contains(where: { $0.name == ex.name }) {
            _ = workoutStore.addExercise(name: ex.name, tags: ex.tags)
        }
    }
    for w in sampleWeights {
        _ = bodyweightStore.addEntry(weight: w.weight, dateStr: Date.daysAgo(w.daysAgo).isoDate)
    }
    UserDefaults.standard.set(true, forKey: "sample-data")
}

func populateStarterExercises(workoutStore: WorkoutStore) {
    for ex in starterExercises {
        _ = workoutStore.addExercise(name: ex.name, tags: ex.tags)
    }
}
