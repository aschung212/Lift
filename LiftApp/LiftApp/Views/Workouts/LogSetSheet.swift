import SwiftUI

struct LogSetSheet: View {
    let exerciseId: String
    var editingSet: WorkoutSet? = nil
    @Binding var showRestTimer: Bool

    @Environment(WorkoutStore.self) private var store
    @Environment(ThemeStore.self) private var theme
    @Environment(RestTimerStore.self) private var restTimer
    @Environment(\.dismiss) private var dismiss

    @State private var weight: String = ""
    @State private var reps: String = ""
    @State private var date: Date = Date()

    var isEditing: Bool { editingSet != nil }

    var exerciseName: String {
        store.exercises.first(where: { $0.id == exerciseId })?.name ?? ""
    }

    var weightValue: Double? { Double(weight) }
    var repsValue: Int? { Int(reps) }

    var liveEstimate: Int? {
        guard let w = weightValue, w > 0, let r = repsValue, r >= 1 else { return nil }
        return epley(theme.toLbs(w), r)
    }

    var isNewPR: Bool {
        guard let est = liveEstimate, !isEditing else { return false }
        guard let pr = store.getExercisePR(exerciseId), pr > 0 else { return false }
        return est > pr
    }

    var canSave: Bool {
        weightValue != nil && weightValue! > 0 && repsValue != nil && repsValue! >= 1
    }

    var body: some View {
        let colors = theme.colors

        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Text(exerciseName)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(colors.accent)

                    // Date
                    VStack(alignment: .leading, spacing: 6) {
                        Text("DATE")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.6)
                            .foregroundColor(colors.textSecondary)
                        DatePicker("", selection: $date, in: ...Date(), displayedComponents: .date)
                            .datePickerStyle(.compact)
                            .labelsHidden()
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

                    // Live estimate
                    if let est = liveEstimate {
                        VStack(spacing: 4) {
                            Text("ESTIMATED 1RM")
                                .font(.system(size: 11, weight: .bold))
                                .tracking(0.8)
                                .foregroundColor(colors.accent.opacity(0.7))
                            Text("\(theme.formatWeight(est)) \(theme.weightUnit.rawValue)")
                                .font(.system(size: 36, weight: .bold))
                                .foregroundColor(colors.accent)

                            if isNewPR {
                                Text("New PR! \u{1F3C6}")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(Color(hex: "#d4af37"))
                            }
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity)
                        .background(colors.accentSubtle)
                        .cornerRadius(10)
                    }

                    // Buttons
                    HStack(spacing: 8) {
                        Button {
                            save()
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

                        Button {
                            dismiss()
                        } label: {
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
            .navigationTitle(isEditing ? "Edit Set" : "Log a Set")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            if let set = editingSet {
                weight = String(theme.displayWeight(set.weight))
                reps = String(set.reps)
                date = set.date
            }
        }
    }

    private func save() {
        guard let w = weightValue, let r = repsValue else { return }
        let lbsWeight = theme.toLbs(w)

        if let set = editingSet {
            store.updateSet(exerciseId: exerciseId, setId: set.id, weight: lbsWeight, reps: r, dateStr: date.isoDate)
            dismiss()
        } else {
            store.logSet(exerciseId: exerciseId, weight: lbsWeight, reps: r, dateStr: date.isoDate)
            if theme.restTimerEnabled {
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    restTimer.start()
                    showRestTimer = true
                }
            } else {
                dismiss()
            }
        }
    }
}
