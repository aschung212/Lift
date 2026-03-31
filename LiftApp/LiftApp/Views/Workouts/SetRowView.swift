import SwiftUI

struct SetRowView: View {
    let set: WorkoutSet
    let exerciseId: String
    let isPR: Bool
    let isActive: Bool
    let onTap: () -> Void
    let onEdit: () -> Void
    @Environment(WorkoutStore.self) private var store
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        let colors = theme.colors

        Button(action: onTap) {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Text("\(theme.formatWeight(set.weight)) \(theme.weightUnit.rawValue) \u{00D7} \(set.reps)")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(colors.textPrimary)

                    Spacer()

                    HStack(spacing: 4) {
                        Text("~\(theme.formatWeight(set.estimated1RM)) \(theme.weightUnit.rawValue)")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(colors.success)
                        if isPR {
                            Text("\u{1F3C6}")
                                .font(.system(size: 13))
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(minHeight: 44)
                .background(isPR ? Color(hex: "#d4af37").opacity(0.08) : Color.clear)

                if isActive {
                    HStack(spacing: 8) {
                        Button("Edit") { onEdit() }
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(colors.textSecondary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .frame(minHeight: 44)
                            .background(colors.bgElevated)
                            .cornerRadius(8)

                        Button("Delete") {
                            store.deleteSet(exerciseId: exerciseId, setId: set.id)
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
    }
}
