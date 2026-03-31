import SwiftUI
import Charts

struct ExerciseGraph: View {
    let exercise: Exercise
    var mode: String = "sets"
    @Environment(ThemeStore.self) private var theme

    private var dailyBest: [(date: Date, e1rm: Int)] {
        var byDate: [String: Int] = [:]
        for s in exercise.sets {
            let day = s.date.isoDate
            if byDate[day] == nil || s.estimated1RM > byDate[day]! {
                byDate[day] = s.estimated1RM
            }
        }
        return byDate.map { (Date.fromISO($0.key), $0.value) }.sorted { $0.date < $1.date }
    }

    private var prOnly: [(date: Date, e1rm: Int)] {
        var prs: [(date: Date, e1rm: Int)] = []
        var maxSoFar = 0
        for entry in dailyBest {
            if entry.e1rm > maxSoFar {
                maxSoFar = entry.e1rm
                prs.append(entry)
            }
        }
        return prs
    }

    private var graphData: [(date: Date, e1rm: Int)] {
        mode == "prs" ? prOnly : dailyBest
    }

    var body: some View {
        let colors = theme.colors

        if graphData.count >= 2 {
            VStack(alignment: .leading, spacing: 4) {
                Text(mode == "prs" ? "PR PROGRESSION" : "ESTIMATED 1RM PROGRESS")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(0.7)
                    .foregroundColor(colors.textMuted)

                Chart {
                    ForEach(graphData, id: \.date) { entry in
                        AreaMark(
                            x: .value("Date", entry.date),
                            y: .value("1RM", theme.displayWeight(entry.e1rm))
                        )
                        .foregroundStyle(colors.accent.opacity(0.15))

                        LineMark(
                            x: .value("Date", entry.date),
                            y: .value("1RM", theme.displayWeight(entry.e1rm))
                        )
                        .foregroundStyle(colors.accent)
                        .lineStyle(StrokeStyle(lineWidth: 2))

                        PointMark(
                            x: .value("Date", entry.date),
                            y: .value("1RM", theme.displayWeight(entry.e1rm))
                        )
                        .foregroundStyle(colors.accent)
                        .symbolSize(entry.e1rm == (exercise.pr ?? 0) ? 40 : 20)
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                            .foregroundStyle(colors.textMuted)
                    }
                }
                .chartYAxis {
                    AxisMarks { _ in
                        AxisValueLabel()
                            .foregroundStyle(colors.textMuted)
                        AxisGridLine()
                            .foregroundStyle(colors.border)
                    }
                }
                .frame(height: 120)
            }
            .padding(.vertical, 8)
        } else if !exercise.sets.isEmpty {
            Text("Log sets on at least 2 different days to see your progress graph.")
                .font(.system(size: 13))
                .foregroundColor(colors.textMuted)
                .multilineTextAlignment(.center)
                .padding(16)
        }
    }
}
