import SwiftUI

struct CalendarLogSheet: View {
    let dateStr: String
    @Environment(WorkoutStore.self) private var store
    @Environment(ThemeStore.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var selectedExerciseId = ""
    @State private var weight = ""
    @State private var reps = ""

    var weightValue: Double? { Double(weight) }
    var repsValue: Int? { Int(reps) }

    var liveEstimate: Int? {
        guard let w = weightValue, w > 0, let r = repsValue, r >= 1 else { return nil }
        return epley(theme.toLbs(w), r)
    }

    var canSave: Bool {
        !selectedExerciseId.isEmpty && weightValue != nil && weightValue! > 0 && repsValue != nil && repsValue! >= 1
    }

    var body: some View {
        let colors = theme.colors

        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Text(Date.fromISO(dateStr).longDate)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(colors.accent)

                    // Exercise picker
                    VStack(alignment: .leading, spacing: 6) {
                        Text("EXERCISE")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.6)
                            .foregroundColor(colors.textSecondary)
                        Picker("Exercise", selection: $selectedExerciseId) {
                            Text("Select...").tag("")
                            ForEach(store.exercises) { ex in
                                Text(ex.name).tag(ex.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 44)
                    }

                    // Weight + Reps
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("WEIGHT (\(theme.weightUnit.rawValue))")
                                .font(.system(size: 11, weight: .bold))
                                .tracking(0.6)
                                .foregroundColor(colors.textSecondary)
                            TextField("135", text: $weight)
                                .keyboardType(.decimalPad)
                                .font(.system(size: 16))
                                .padding(12)
                                .frame(minHeight: 44)
                                .background(colors.bgPrimary)
                                .cornerRadius(8)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.borderStrong, lineWidth: 1))
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text("REPS")
                                .font(.system(size: 11, weight: .bold))
                                .tracking(0.6)
                                .foregroundColor(colors.textSecondary)
                            TextField("8", text: $reps)
                                .keyboardType(.numberPad)
                                .font(.system(size: 16))
                                .padding(12)
                                .frame(minHeight: 44)
                                .background(colors.bgPrimary)
                                .cornerRadius(8)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.borderStrong, lineWidth: 1))
                        }
                    }

                    if let est = liveEstimate {
                        VStack(spacing: 4) {
                            Text("ESTIMATED 1RM")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(colors.accent.opacity(0.7))
                            Text("\(theme.formatWeight(est)) \(theme.weightUnit.rawValue)")
                                .font(.system(size: 36, weight: .bold))
                                .foregroundColor(colors.accent)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity)
                        .background(colors.accentSubtle)
                        .cornerRadius(10)
                    }

                    HStack(spacing: 8) {
                        Button {
                            guard let w = weightValue, let r = repsValue else { return }
                            store.logSet(exerciseId: selectedExerciseId, weight: theme.toLbs(w), reps: r, dateStr: dateStr)
                            dismiss()
                        } label: {
                            Text("Save")
                                .font(.system(size: 15, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 44)
                                .foregroundColor(.white)
                                .background(canSave ? colors.accent : colors.accent.opacity(0.5))
                                .cornerRadius(10)
                        }
                        .disabled(!canSave)

                        Button { dismiss() } label: {
                            Text("Cancel")
                                .font(.system(size: 15, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 44)
                                .foregroundColor(colors.textSecondary)
                                .background(colors.bgElevated)
                                .cornerRadius(10)
                        }
                    }
                }
                .padding(22)
            }
            .background(colors.bgSecondary)
            .navigationTitle("Log a Set")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
