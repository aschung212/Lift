import SwiftUI

struct WorkoutsView: View {
    @Environment(WorkoutStore.self) private var store
    @Environment(ThemeStore.self) private var theme
    @Binding var showRestTimer: Bool

    @State private var activeTagFilters: [String] = []
    @State private var showNewExercise = false
    @State private var selectedExercise: Exercise?
    @State private var logExerciseId: String?

    var filteredExercises: [Exercise] {
        store.filteredExercises(tags: activeTagFilters)
    }

    var body: some View {
        let colors = theme.colors

        ScrollView {
            VStack(spacing: 0) {
                // Card
                VStack(spacing: 0) {
                    // Header
                    HStack {
                        Text("EXERCISE TRACKER")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.8)
                            .foregroundColor(colors.textSecondary)

                        Spacer()

                        Button("+ New Exercise") {
                            showNewExercise = true
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .frame(minHeight: 44)
                        .background(colors.accent)
                        .cornerRadius(8)
                    }
                    .padding(16)

                    // Tag filter
                    if !store.allTags.isEmpty {
                        TagFilterBar(
                            tags: store.allTags,
                            activeFilters: $activeTagFilters,
                            accentColor: colors.accent
                        )
                    }

                    // Exercise list
                    if store.exercises.isEmpty {
                        Text("No exercises yet. Hit \"+ New Exercise\" to add your first one.")
                            .font(.system(size: 13))
                            .foregroundColor(colors.textMuted)
                            .multilineTextAlignment(.center)
                            .padding(32)
                    } else {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(filteredExercises.enumerated()), id: \.element.id) { index, exercise in
                                ExerciseRow(
                                    exercise: exercise,
                                    canDrag: activeTagFilters.isEmpty,
                                    onTap: { selectedExercise = exercise },
                                    onLog: { logExerciseId = exercise.id }
                                )

                                if index < filteredExercises.count - 1 {
                                    Divider()
                                        .background(colors.borderStrong)
                                }
                            }
                        }
                    }
                }
                .background(
                    theme.glassEnabled
                        ? AnyShapeStyle(.ultraThinMaterial)
                        : AnyShapeStyle(colors.bgSecondary)
                )
                .cornerRadius(14)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(colors.border, lineWidth: 1)
                )
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
        }
        .sheet(item: $selectedExercise) { exercise in
            ExerciseDetailSheet(exercise: exercise, showRestTimer: $showRestTimer)
        }
        .sheet(isPresented: $showNewExercise) {
            NewExerciseSheet()
        }
        .sheet(item: Binding(
            get: { logExerciseId.map { LogTarget(id: $0) } },
            set: { logExerciseId = $0?.id }
        )) { target in
            LogSetSheet(exerciseId: target.id, showRestTimer: $showRestTimer)
        }
    }
}

// Helper for sheet binding
struct LogTarget: Identifiable {
    let id: String
}
