import SwiftUI

struct ExerciseRow: View {
    let exercise: Exercise
    let canDrag: Bool
    let onTap: () -> Void
    let onLog: () -> Void
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        let colors = theme.colors

        HStack(spacing: 0) {
            // Drag handle
            Text("\u{2807}")
                .font(.system(size: 16))
                .foregroundColor(colors.textMuted)
                .opacity(canDrag ? 1 : 0.25)
                .frame(width: 44)
                .frame(maxHeight: .infinity)

            // Main content
            Button(action: onTap) {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(exercise.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(colors.textPrimary)

                        HStack(spacing: 4) {
                            Text("PR: \(exercise.pr.map { theme.formatWeight($0) } ?? "---") \(theme.weightUnit.rawValue)")
                                .font(.system(size: 12))
                                .foregroundColor(colors.textSecondary)
                            Text("  \(exercise.sets.count) set\(exercise.sets.count == 1 ? "" : "s")")
                                .font(.system(size: 12))
                                .foregroundColor(colors.textMuted)
                        }
                    }

                    Spacer()

                    Text("\u{203A}")
                        .font(.system(size: 16))
                        .foregroundColor(colors.textMuted)
                }
                .padding(.vertical, 16)
                .padding(.trailing, 16)
            }

            // Log button
            Button("+ Log", action: onLog)
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(colors.accent)
                .frame(minWidth: 44)
                .frame(maxHeight: .infinity)
                .padding(.horizontal, 16)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(colors.border)
                        .frame(width: 0.5)
                }
        }
        .frame(minHeight: 44)
    }
}
