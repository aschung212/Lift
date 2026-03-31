import SwiftUI

struct MonthGridView: View {
    let currentDate: Date
    @Binding var selectedDay: String?
    let store: WorkoutStore
    let tagFilters: [String]
    @Environment(ThemeStore.self) private var theme

    private let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)

    var cells: [DayCell] {
        buildMonthCells()
    }

    var body: some View {
        let colors = theme.colors

        VStack(spacing: 0) {
            // Day headers
            HStack(spacing: 0) {
                ForEach(dayNames, id: \.self) { name in
                    Text(name.uppercased())
                        .font(.system(size: 11, weight: .bold))
                        .tracking(0.5)
                        .foregroundColor(colors.textMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
            }
            .background(colors.bgSecondary)

            // Grid
            LazyVGrid(columns: columns, spacing: 0) {
                ForEach(cells) { cell in
                    dayCell(cell)
                        .onTapGesture {
                            if cell.inMonth {
                                selectedDay = selectedDay == cell.dateStr ? nil : cell.dateStr
                            }
                        }
                }
            }
        }
    }

    private func dayCell(_ cell: DayCell) -> some View {
        let colors = theme.colors
        let isSelected = selectedDay == cell.dateStr
        let isToday = cell.dateStr == Date.todayISO

        return VStack(spacing: 2) {
            Text("\(cell.day)")
                .font(.system(size: 14, weight: isToday ? .bold : .regular))
                .foregroundColor(
                    !cell.inMonth ? colors.textMuted.opacity(0.3) :
                    isToday ? .white :
                    isSelected ? colors.accent :
                    colors.textPrimary
                )
                .frame(width: 28, height: 28)
                .background(isToday ? colors.accent : Color.clear)
                .clipShape(Circle())

            // Exercise dots
            if cell.inMonth && !cell.exerciseNames.isEmpty {
                HStack(spacing: 2) {
                    ForEach(cell.exerciseNames.prefix(3), id: \.self) { _ in
                        Circle()
                            .fill(colors.accent)
                            .frame(width: 5, height: 5)
                    }
                    if cell.exerciseNames.count > 3 {
                        Text("+\(cell.exerciseNames.count - 3)")
                            .font(.system(size: 11))
                            .foregroundColor(colors.textMuted)
                    }
                }
            }

            if cell.hasPR {
                Text("\u{1F3C6}")
                    .font(.system(size: 9))
            }
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 48)
        .background(isSelected ? colors.accentSubtle : Color.clear)
    }

    private func buildMonthCells() -> [DayCell] {
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month], from: currentDate)
        guard let firstOfMonth = cal.date(from: comps),
              let range = cal.range(of: .day, in: .month, for: firstOfMonth) else { return [] }

        let firstWeekday = cal.component(.weekday, from: firstOfMonth) // 1=Sun
        let exercises = tagFilters.isEmpty ? store.exercises : store.filteredExercises(tags: tagFilters)

        // Build training map
        var trainingMap: [String: [String]] = [:]
        var prMap: [String: Bool] = [:]
        for ex in exercises {
            let pr = ex.pr
            for s in ex.sets {
                let day = s.date.isoDate
                if trainingMap[day] == nil { trainingMap[day] = [] }
                if !trainingMap[day]!.contains(ex.name) {
                    trainingMap[day]!.append(ex.name)
                }
                if s.estimated1RM == pr {
                    prMap[day] = true
                }
            }
        }

        var cells: [DayCell] = []

        // Leading empty cells
        for i in 1..<firstWeekday {
            let prevDate = cal.date(byAdding: .day, value: -(firstWeekday - i), to: firstOfMonth)!
            let day = cal.component(.day, from: prevDate)
            cells.append(DayCell(day: day, dateStr: prevDate.isoDate, inMonth: false))
        }

        // Month days
        for day in range {
            let date = cal.date(byAdding: .day, value: day - 1, to: firstOfMonth)!
            let dateStr = date.isoDate
            cells.append(DayCell(
                day: day,
                dateStr: dateStr,
                inMonth: true,
                exerciseNames: trainingMap[dateStr] ?? [],
                hasPR: prMap[dateStr] ?? false
            ))
        }

        // Trailing to fill grid
        while cells.count % 7 != 0 {
            let nextDate = cal.date(byAdding: .day, value: cells.count - (firstWeekday - 1), to: firstOfMonth)!
            let day = cal.component(.day, from: nextDate)
            cells.append(DayCell(day: day, dateStr: nextDate.isoDate, inMonth: false))
        }

        return cells
    }
}

struct DayCell: Identifiable {
    let id = UUID()
    let day: Int
    let dateStr: String
    let inMonth: Bool
    var exerciseNames: [String] = []
    var hasPR: Bool = false
}
