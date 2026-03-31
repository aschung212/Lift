import SwiftUI

struct DayDetailView: View {
    let dateStr: String
    let store: WorkoutStore
    let tagFilters: [String]
    let onLog: () -> Void
    @Environment(ThemeStore.self) private var theme

    var exercises: [Exercise] {
        let all = tagFilters.isEmpty ? store.exercises : store.filteredExercises(tags: tagFilters)
        return all.filter { ex in
            ex.sets.contains { $0.date.isoDate == dateStr }
        }
    }

    var body: some View {
        let colors = theme.colors

        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(Date.fromISO(dateStr).longDate)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(colors.textSecondary)
                    .textCase(.uppercase)
                Spacer()
                Button("+ Log", action: onLog)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(colors.accent)
                    .frame(minHeight: 44)
            }

            if exercises.isEmpty {
                Text("No sets logged.")
                    .font(.system(size: 13))
                    .foregroundColor(colors.textMuted)
            } else {
                FlowLayout(spacing: 6) {
                    ForEach(exercises) { ex in
                        let setCount = ex.sets.filter { $0.date.isoDate == dateStr }.count
                        Text("\(ex.name) \(setCount)")
                            .font(.system(size: 12, weight: .semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 3)
                            .foregroundColor(colors.textSecondary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(colors.borderStrong, lineWidth: 1)
                            )
                    }
                }
            }
        }
        .padding(16)
        .overlay(alignment: .top) {
            Rectangle().fill(colors.border).frame(height: 0.5)
        }
    }
}
