import SwiftUI

struct WeekListView: View {
    let currentDate: Date
    let store: WorkoutStore
    let tagFilters: [String]
    let onLog: (String) -> Void
    @Environment(ThemeStore.self) private var theme

    var weekDays: [(date: Date, dateStr: String)] {
        let cal = Calendar.current
        let start = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: currentDate))!
        return (0..<7).map { i in
            let d = cal.date(byAdding: .day, value: i, to: start)!
            return (d, d.isoDate)
        }
    }

    var body: some View {
        let colors = theme.colors
        let exercises = tagFilters.isEmpty ? store.exercises : store.filteredExercises(tags: tagFilters)

        LazyVStack(spacing: 0) {
            ForEach(weekDays, id: \.dateStr) { day in
                let isToday = day.dateStr == Date.todayISO
                let dayExercises = exercisesForDay(day.dateStr, exercises: exercises)

                HStack(alignment: .center, spacing: 12) {
                    // Day column
                    VStack(spacing: 0) {
                        Text(dayName(day.date))
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(colors.textMuted)
                        Text("\(Calendar.current.component(.day, from: day.date))")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(isToday ? .white : colors.textPrimary)
                            .frame(width: 28, height: 28)
                            .background(isToday ? colors.accent : Color.clear)
                            .clipShape(Circle())
                    }
                    .frame(width: 36)

                    // Exercise tags
                    if dayExercises.isEmpty {
                        Text("Rest")
                            .font(.system(size: 13))
                            .foregroundColor(colors.textMuted)
                    } else {
                        FlowLayout(spacing: 5) {
                            ForEach(dayExercises, id: \.self) { name in
                                Text(name)
                                    .font(.system(size: 11, weight: .semibold))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .foregroundColor(colors.textSecondary)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10)
                                            .stroke(colors.borderStrong, lineWidth: 1)
                                    )
                            }
                        }
                    }

                    Spacer()

                    Button("+ Log") {
                        onLog(day.dateStr)
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(colors.accent)
                    .frame(minHeight: 44)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(minHeight: 48)
                .background(isToday ? colors.accentSubtle : Color.clear)

                Divider().background(colors.border)
            }
        }
    }

    private func dayName(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE"
        return formatter.string(from: date).uppercased()
    }

    private func exercisesForDay(_ dateStr: String, exercises: [Exercise]) -> [String] {
        var names: [String] = []
        for ex in exercises {
            if ex.sets.contains(where: { $0.date.isoDate == dateStr }) {
                names.append(ex.name)
            }
        }
        return names
    }
}
