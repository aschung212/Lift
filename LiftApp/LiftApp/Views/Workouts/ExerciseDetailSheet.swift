import SwiftUI

struct ExerciseDetailSheet: View {
    let exercise: Exercise
    @Binding var showRestTimer: Bool
    @Environment(WorkoutStore.self) private var store
    @Environment(ThemeStore.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var detailTab = "sets"
    @State private var activeSetId: String?
    @State private var showAllSets = false
    @State private var editingSet: WorkoutSet?
    @State private var showEditExercise = false
    @State private var showConfirmDelete = false
    @State private var showConfirmClear = false
    @State private var logExerciseId: String?

    private let setLimit = 10

    // Get the live exercise from the store
    var liveExercise: Exercise {
        store.exercises.first(where: { $0.id == exercise.id }) ?? exercise
    }

    var visibleSets: [WorkoutSet] {
        let sorted = liveExercise.sets.sorted { $0.date > $1.date }
        return showAllSets ? sorted : Array(sorted.prefix(setLimit))
    }

    var prHistory: [PREntry] {
        computePRHistory(for: liveExercise)
    }

    // Group sets by date
    var groupedSets: [(date: String, sets: [WorkoutSet])] {
        let sorted = visibleSets
        var groups: [(date: String, sets: [WorkoutSet])] = []
        for set in sorted {
            let dateKey = set.date.isoDate
            if groups.last?.date == dateKey {
                groups[groups.count - 1].sets.append(set)
            } else {
                groups.append((date: dateKey, sets: [set]))
            }
        }
        return groups
    }

    var body: some View {
        let colors = theme.colors

        NavigationStack {
            VStack(spacing: 0) {
                // Graph
                ExerciseGraph(exercise: liveExercise, mode: detailTab)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                // Tabs
                HStack(spacing: 0) {
                    tabButton("All Sets", count: liveExercise.sets.count, id: "sets")
                    if prHistory.count > 1 {
                        tabButton("PRs", count: prHistory.count, id: "prs")
                    }
                }
                .overlay(alignment: .bottom) {
                    Rectangle().fill(colors.border).frame(height: 0.5)
                }

                // Content
                ScrollView {
                    if detailTab == "sets" {
                        setsView
                    } else {
                        prsView
                    }

                    // Clear + Edit/Delete
                    if !liveExercise.sets.isEmpty {
                        HStack {
                            Spacer()
                            Button("Clear all sets") {
                                showConfirmClear = true
                            }
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(colors.danger)
                            .frame(minHeight: 44)
                            .padding(.horizontal, 16)
                        }
                    }

                    HStack(spacing: 8) {
                        Button("Edit Exercise") {
                            showEditExercise = true
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(colors.textSecondary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .frame(minHeight: 44)
                        .background(colors.bgElevated)
                        .cornerRadius(8)

                        Button("Delete Exercise") {
                            showConfirmDelete = true
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(colors.danger)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .frame(minHeight: 44)
                        .background(colors.dangerSubtle)
                        .cornerRadius(8)

                        Spacer()
                    }
                    .padding(16)
                }
                .frame(minHeight: UIScreen.main.bounds.height * 0.4)
            }
            .background(colors.bgSecondary)
            .navigationTitle(liveExercise.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back") { dismiss() }
                        .foregroundColor(colors.accent)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("+ Log") { logExerciseId = liveExercise.id }
                        .foregroundColor(colors.accent)
                }
            }
        }
        .sheet(item: $editingSet) { set in
            LogSetSheet(exerciseId: liveExercise.id, editingSet: set, showRestTimer: $showRestTimer)
        }
        .sheet(isPresented: $showEditExercise) {
            EditExerciseSheet(exercise: liveExercise)
        }
        .sheet(item: Binding(
            get: { logExerciseId.map { LogTarget(id: $0) } },
            set: { logExerciseId = $0?.id }
        )) { target in
            LogSetSheet(exerciseId: target.id, showRestTimer: $showRestTimer)
        }
        .alert("Delete Exercise?", isPresented: $showConfirmDelete) {
            Button("Delete", role: .destructive) {
                store.deleteExercise(id: liveExercise.id)
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will delete \(liveExercise.name) and all \(liveExercise.sets.count) sets.")
        }
        .alert("Clear All Sets?", isPresented: $showConfirmClear) {
            Button("Clear All", role: .destructive) {
                store.clearSets(exerciseId: liveExercise.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will delete all \(liveExercise.sets.count) sets for \(liveExercise.name).")
        }
    }

    // MARK: - Sets View

    private var setsView: some View {
        let colors = theme.colors

        return LazyVStack(spacing: 0) {
            if liveExercise.sets.isEmpty {
                Text("No sets logged yet.")
                    .font(.system(size: 13))
                    .foregroundColor(colors.textMuted)
                    .padding(32)
            }

            ForEach(groupedSets, id: \.date) { group in
                // Date header
                Text(Date.fromISO(group.date).shortDate.uppercased())
                    .font(.system(size: 12, weight: .bold))
                    .tracking(0.3)
                    .foregroundColor(colors.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(colors.bgPrimary)

                ForEach(group.sets) { set in
                    SetRowView(
                        set: set,
                        exerciseId: liveExercise.id,
                        isPR: set.estimated1RM == liveExercise.pr,
                        isActive: activeSetId == set.id,
                        onTap: { activeSetId = activeSetId == set.id ? nil : set.id },
                        onEdit: { editingSet = set }
                    )
                    Divider().background(colors.border)
                }
            }

            if liveExercise.sets.count > setLimit {
                Button(showAllSets ? "Show less" : "Show all \(liveExercise.sets.count) sets") {
                    showAllSets.toggle()
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(colors.accent)
                .frame(minHeight: 44)
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - PRs View

    private var prsView: some View {
        let colors = theme.colors

        return VStack(spacing: 0) {
            ForEach(Array(prHistory.enumerated()), id: \.element.id) { index, pr in
                // PR Card
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(theme.formatWeight(pr.weight))
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(colors.textPrimary) +
                        Text(" \(theme.weightUnit.rawValue)")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(colors.textSecondary) +
                        Text(" \u{00D7} \(pr.reps)")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(colors.textSecondary)

                        Spacer()

                        VStack(alignment: .trailing, spacing: 2) {
                            if index == 0 {
                                Text("CURRENT")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundColor(colors.accent)
                            }
                            if let e1rmDelta = pr.e1rmDelta {
                                Text("+\(theme.formatWeight(e1rmDelta)) \(theme.weightUnit.rawValue)")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(colors.success)
                            }
                            if let days = pr.daysSince {
                                Text("\(days)d")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundColor(colors.textMuted)
                            }
                        }
                    }

                    HStack(spacing: 6) {
                        Text(pr.date.shortDate)
                            .font(.system(size: 13))
                            .foregroundColor(colors.textSecondary)
                        Text("\u{00B7}")
                            .foregroundColor(colors.textMuted.opacity(0.4))
                        Text("e1RM ~\(theme.formatWeight(pr.estimated1RM)) \(theme.weightUnit.rawValue)")
                            .font(.system(size: 13))
                            .foregroundColor(colors.textSecondary)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(index == 0 ? colors.accentSubtle : colors.bgPrimary)
                .cornerRadius(10)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(index == 0 ? colors.accent : Color.clear, lineWidth: 1)
                )
                .padding(.horizontal, 16)

                // Connector
                if let e1rmDelta = pr.e1rmDelta, index < prHistory.count - 1 {
                    HStack(spacing: 6) {
                        Text("\u{2191}")
                            .font(.system(size: 14))
                        Text("+\(theme.formatWeight(e1rmDelta)) \(theme.weightUnit.rawValue)")
                        Text("\u{00B7}")
                            .foregroundColor(colors.textMuted.opacity(0.4))
                        Text("\(pr.daysSince ?? 0)d")
                            .foregroundColor(colors.textMuted)
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(colors.success)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
                }
            }
        }
        .padding(.vertical, 12)
    }

    // MARK: - Tab Button

    private func tabButton(_ label: String, count: Int, id: String) -> some View {
        let colors = theme.colors
        let isActive = detailTab == id

        return Button {
            detailTab = id
        } label: {
            HStack(spacing: 6) {
                Text(label)
                Text("\(count)")
                    .font(.system(size: 12, weight: .medium))
                    .opacity(0.6)
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(isActive ? colors.accent : colors.textMuted)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
            .overlay(alignment: .bottom) {
                if isActive {
                    Rectangle()
                        .fill(colors.accent)
                        .frame(height: 2)
                }
            }
        }
    }
}

// MARK: - PR Computation

struct PREntry: Identifiable {
    let id: String
    let date: Date
    let weight: Double
    let reps: Int
    let estimated1RM: Int
    let daysSince: Int?
    let e1rmDelta: Double?
}

func computePRHistory(for exercise: Exercise) -> [PREntry] {
    let sorted = exercise.sets.sorted { $0.date < $1.date }
    var raw: [WorkoutSet] = []
    var maxSoFar = 0

    for set in sorted {
        if set.estimated1RM > maxSoFar {
            maxSoFar = set.estimated1RM
            raw.append(set)
        }
    }

    // Keep only best PR per day
    var byDay: [String: WorkoutSet] = [:]
    for pr in raw {
        let day = pr.date.isoDate
        if byDay[day] == nil || pr.estimated1RM > byDay[day]!.estimated1RM {
            byDay[day] = pr
        }
    }

    let prs = byDay.values.sorted { $0.date < $1.date }

    var result: [PREntry] = []
    for (i, pr) in prs.enumerated() {
        let daysSince: Int? = i > 0 ? Calendar.current.dateComponents([.day], from: prs[i-1].date, to: pr.date).day : nil
        let e1rmDelta: Double? = i > 0 ? Double(pr.estimated1RM - prs[i-1].estimated1RM) : nil
        result.append(PREntry(
            id: pr.id,
            date: pr.date,
            weight: pr.weight,
            reps: pr.reps,
            estimated1RM: pr.estimated1RM,
            daysSince: daysSince,
            e1rmDelta: e1rmDelta
        ))
    }

    return result.reversed()
}
