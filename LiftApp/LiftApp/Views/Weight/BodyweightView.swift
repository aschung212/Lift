import SwiftUI
import Charts

struct BodyweightView: View {
    @Environment(BodyweightStore.self) private var store
    @Environment(ThemeStore.self) private var theme

    @State private var period = 30
    @State private var activeEntryId: String?
    @State private var editingEntry: BodyweightEntry?
    @State private var showLogSheet = false

    let periods = [(label: "7d", days: 7), (label: "30d", days: 30), (label: "90d", days: 90), (label: "1y", days: 365)]

    var filteredEntries: [BodyweightEntry] {
        store.filteredEntries(days: period)
    }

    var stats: BodyweightStore.PeriodStats? {
        store.periodStats(days: period)
    }

    var body: some View {
        let colors = theme.colors

        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    // Header
                    HStack {
                        Text("BODY WEIGHT")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.8)
                            .foregroundColor(colors.textSecondary)
                        Spacer()
                        Button("+ Log") { showLogSheet = true }
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .frame(minHeight: 44)
                            .background(colors.accent)
                            .cornerRadius(8)
                    }
                    .padding(16)

                    // Current weight
                    if let latest = store.latestWeight {
                        HStack {
                            Text("Current")
                                .font(.system(size: 13))
                                .foregroundColor(colors.textSecondary)
                            Text("\(theme.formatWeight(latest)) \(theme.weightUnit.rawValue)")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundColor(colors.textPrimary)
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                    }

                    // Period selector
                    if !store.entries.isEmpty {
                        HStack(spacing: 6) {
                            ForEach(periods, id: \.days) { p in
                                Button {
                                    period = p.days
                                } label: {
                                    Text(p.label)
                                        .font(.system(size: 13, weight: .semibold))
                                        .frame(maxWidth: .infinity)
                                        .frame(minHeight: 44)
                                        .foregroundColor(period == p.days ? .white : colors.textSecondary)
                                        .background(period == p.days ? colors.accent : Color.clear)
                                        .cornerRadius(8)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 8)
                                                .stroke(period == p.days ? colors.accent : colors.border, lineWidth: 1)
                                        )
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                    }

                    // Stats
                    if let stats {
                        HStack(spacing: 8) {
                            statCard("CHANGE", value: "\(stats.change > 0 ? "+" : "")\(theme.formatWeight(stats.change))", color: stats.change < 0 ? colors.success : stats.change > 0 ? colors.danger : colors.textPrimary)
                            statCard("LOW", value: theme.formatWeight(stats.min), color: colors.textPrimary)
                            statCard("HIGH", value: theme.formatWeight(stats.max), color: colors.textPrimary)
                            statCard("AVG", value: theme.formatWeight(stats.avg), color: colors.textPrimary)
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                    }

                    // Graph
                    if filteredEntries.count >= 2 {
                        bodyweightChart
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                    }

                    // Entry list
                    if !store.entries.isEmpty {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(store.sortedEntries.enumerated()), id: \.element.id) { index, entry in
                                let delta = entryDelta(entry, index: index)

                                Button {
                                    activeEntryId = activeEntryId == entry.id ? nil : entry.id
                                } label: {
                                    VStack(spacing: 0) {
                                        HStack(spacing: 10) {
                                            Text(entry.date.shortDate)
                                                .font(.system(size: 13))
                                                .foregroundColor(colors.textMuted)
                                                .frame(minWidth: 44, alignment: .leading)

                                            HStack(spacing: 4) {
                                                Text("\(theme.formatWeight(entry.weight)) \(theme.weightUnit.rawValue)")
                                                    .font(.system(size: 15, weight: .medium))
                                                    .foregroundColor(colors.textPrimary)

                                                if entry.weight == store.minWeight {
                                                    Text("\u{2193} Low")
                                                        .font(.system(size: 11, weight: .bold))
                                                        .padding(.horizontal, 5)
                                                        .padding(.vertical, 1)
                                                        .background(Color(hex: "#4ade80").opacity(0.15))
                                                        .foregroundColor(Color(hex: "#4ade80"))
                                                        .cornerRadius(5)
                                                } else if entry.weight == store.maxWeight {
                                                    Text("\u{2191} High")
                                                        .font(.system(size: 11, weight: .bold))
                                                        .padding(.horizontal, 5)
                                                        .padding(.vertical, 1)
                                                        .background(Color(hex: "#f87171").opacity(0.15))
                                                        .foregroundColor(Color(hex: "#f87171"))
                                                        .cornerRadius(5)
                                                }
                                            }

                                            Spacer()

                                            if let d = delta {
                                                Text("\(d > 0 ? "+" : "")\(theme.formatWeight(d))")
                                                    .font(.system(size: 13, weight: .medium))
                                                    .monospacedDigit()
                                                    .foregroundColor(d < 0 ? colors.success : d > 0 ? colors.danger : colors.textMuted)
                                            }
                                        }
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 14)
                                        .frame(minHeight: 44)
                                        .background(
                                            entry.weight == store.minWeight ? colors.successSubtle :
                                            entry.weight == store.maxWeight ? colors.dangerSubtle :
                                            Color.clear
                                        )

                                        if activeEntryId == entry.id {
                                            HStack(spacing: 8) {
                                                Button("Edit") { editingEntry = entry }
                                                    .font(.system(size: 14, weight: .semibold))
                                                    .foregroundColor(colors.textSecondary)
                                                    .padding(.horizontal, 14)
                                                    .padding(.vertical, 10)
                                                    .frame(minHeight: 44)
                                                    .background(colors.bgElevated)
                                                    .cornerRadius(8)

                                                Button("Delete") {
                                                    store.deleteEntry(id: entry.id)
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
                                            .padding(.horizontal, 16)
                                            .padding(.bottom, 10)
                                        }
                                    }
                                }
                                .buttonStyle(.plain)

                                Divider().background(colors.border)
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
        .sheet(isPresented: $showLogSheet) {
            LogWeightSheet()
        }
        .sheet(item: $editingEntry) { entry in
            LogWeightSheet(editingEntry: entry)
        }
    }

    // MARK: - Chart

    private var bodyweightChart: some View {
        let colors = theme.colors

        return Chart {
            ForEach(filteredEntries, id: \.id) { entry in
                AreaMark(
                    x: .value("Date", entry.date),
                    y: .value("Weight", theme.displayWeight(entry.weight))
                )
                .foregroundStyle(colors.accent.opacity(0.15))

                LineMark(
                    x: .value("Date", entry.date),
                    y: .value("Weight", theme.displayWeight(entry.weight))
                )
                .foregroundStyle(colors.accent)
                .lineStyle(StrokeStyle(lineWidth: 2))

                PointMark(
                    x: .value("Date", entry.date),
                    y: .value("Weight", theme.displayWeight(entry.weight))
                )
                .foregroundStyle(colors.accent)
                .symbolSize(20)
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

    // MARK: - Helpers

    private func statCard(_ label: String, value: String, color: Color) -> some View {
        let colors = theme.colors
        return VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(colors.textMuted)
            Text("\(value) \(theme.weightUnit.rawValue)")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(colors.bgPrimary)
        .cornerRadius(8)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.border, lineWidth: 1))
    }

    private func entryDelta(_ entry: BodyweightEntry, index: Int) -> Double? {
        let sorted = store.sortedEntries
        guard index < sorted.count - 1 else { return nil }
        return ((entry.weight - sorted[index + 1].weight) * 10).rounded() / 10
    }
}
