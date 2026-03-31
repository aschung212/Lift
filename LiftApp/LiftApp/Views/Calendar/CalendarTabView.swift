import SwiftUI

struct CalendarTabView: View {
    @Environment(WorkoutStore.self) private var store
    @Environment(ThemeStore.self) private var theme

    @State private var viewMode = "month" // "month" or "week"
    @State private var currentDate = Date()
    @State private var selectedDay: String?
    @State private var activeTagFilters: [String] = []
    @State private var logModal: (open: Bool, date: String) = (false, "")

    var body: some View {
        let colors = theme.colors

        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    // Header
                    HStack {
                        Text("CALENDAR")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.8)
                            .foregroundColor(colors.textSecondary)

                        Spacer()

                        // View toggle
                        HStack(spacing: 2) {
                            viewToggle("Month", id: "month")
                            viewToggle("Week", id: "week")
                        }
                        .padding(2)
                        .background(colors.bgPrimary)
                        .cornerRadius(8)
                    }
                    .padding(14)

                    // Tag filter
                    if !store.allTags.isEmpty {
                        TagFilterBar(
                            tags: store.allTags,
                            activeFilters: $activeTagFilters,
                            accentColor: colors.accent
                        )
                    }

                    // Navigation
                    HStack {
                        Button { navigate(-1) } label: {
                            Image(systemName: "chevron.left")
                                .frame(width: 44, height: 44)
                        }
                        Spacer()
                        Text(navLabel)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(colors.textPrimary)
                        Spacer()
                        Button { navigate(1) } label: {
                            Image(systemName: "chevron.right")
                                .frame(width: 44, height: 44)
                        }
                    }
                    .foregroundColor(colors.textSecondary)
                    .padding(.horizontal, 8)

                    if viewMode == "month" {
                        MonthGridView(
                            currentDate: currentDate,
                            selectedDay: $selectedDay,
                            store: store,
                            tagFilters: activeTagFilters
                        )
                    } else {
                        WeekListView(
                            currentDate: currentDate,
                            store: store,
                            tagFilters: activeTagFilters,
                            onLog: { dateStr in
                                logModal = (true, dateStr)
                            }
                        )
                    }

                    // Selected day detail (month view)
                    if viewMode == "month", let day = selectedDay {
                        DayDetailView(
                            dateStr: day,
                            store: store,
                            tagFilters: activeTagFilters,
                            onLog: {
                                logModal = (true, day)
                            }
                        )
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
        .sheet(isPresented: $logModal.open) {
            CalendarLogSheet(dateStr: logModal.date)
        }
    }

    private var navLabel: String {
        if viewMode == "month" {
            return currentDate.monthYear
        } else {
            let cal = Calendar.current
            let start = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: currentDate))!
            let end = cal.date(byAdding: .day, value: 6, to: start)!
            return "\(start.shortDate) - \(end.shortDate)"
        }
    }

    private func navigate(_ direction: Int) {
        let cal = Calendar.current
        if viewMode == "month" {
            currentDate = cal.date(byAdding: .month, value: direction, to: currentDate)!
        } else {
            currentDate = cal.date(byAdding: .weekOfYear, value: direction, to: currentDate)!
        }
    }

    private func viewToggle(_ label: String, id: String) -> some View {
        let colors = theme.colors
        let isActive = viewMode == id
        return Button { viewMode = id } label: {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .foregroundColor(isActive ? colors.textPrimary : colors.textSecondary)
                .background(isActive ? colors.bgElevated : Color.clear)
                .cornerRadius(6)
        }
    }
}
