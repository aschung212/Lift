import SwiftUI

struct SettingsSheet: View {
    @Environment(ThemeStore.self) private var theme
    @Environment(PreferencesStore.self) private var prefs
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let colors = theme.colors

        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Appearance
                    VStack(spacing: 0) {
                        sectionHeader("Appearance")

                        // Theme picker
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 12) {
                            ForEach(ThemeID.allCases, id: \.self) { themeId in
                                let isActive = theme.currentTheme == themeId
                                let preview = themeId.preview(for: theme.resolvedMode)

                                Button {
                                    theme.currentTheme = themeId
                                } label: {
                                    VStack(spacing: 6) {
                                        Circle()
                                            .fill(
                                                LinearGradient(
                                                    colors: [preview.accentColor, preview.bgColor],
                                                    startPoint: .topLeading,
                                                    endPoint: .bottomTrailing
                                                )
                                            )
                                            .frame(width: 44, height: 44)
                                            .overlay(
                                                Circle()
                                                    .stroke(isActive ? colors.accent : Color.clear, lineWidth: 2)
                                            )
                                            .scaleEffect(isActive ? 1.1 : 1)
                                            .animation(.spring(response: 0.3), value: isActive)

                                        Text(themeId.label)
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundColor(colors.textSecondary)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)

                        // Mode
                        settingsRow("Mode") {
                            HStack(spacing: 0) {
                                ForEach(ColorMode.allCases, id: \.self) { mode in
                                    Button {
                                        theme.colorMode = mode
                                    } label: {
                                        Text(mode.rawValue.capitalized)
                                            .font(.system(size: 13, weight: .medium))
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 6)
                                            .foregroundColor(theme.colorMode == mode ? colors.textPrimary : colors.textSecondary)
                                            .background(theme.colorMode == mode ? colors.bgElevated : Color.clear)
                                            .cornerRadius(7)
                                    }
                                }
                            }
                            .padding(2)
                            .background(colors.bgPrimary)
                            .cornerRadius(9)
                        }

                        // Liquid Glass
                        settingsRow("Liquid Glass") {
                            Toggle("", isOn: Binding(
                                get: { theme.glassEnabled },
                                set: { theme.glassEnabled = $0 }
                            ))
                            .tint(colors.accent)
                        }

                        // Units
                        settingsRow("Units") {
                            HStack(spacing: 0) {
                                ForEach(WeightUnit.allCases, id: \.self) { unit in
                                    Button {
                                        theme.weightUnit = unit
                                    } label: {
                                        Text(unit.rawValue)
                                            .font(.system(size: 13, weight: .medium))
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 6)
                                            .foregroundColor(theme.weightUnit == unit ? colors.textPrimary : colors.textSecondary)
                                            .background(theme.weightUnit == unit ? colors.bgElevated : Color.clear)
                                            .cornerRadius(7)
                                    }
                                }
                            }
                            .padding(2)
                            .background(colors.bgPrimary)
                            .cornerRadius(9)
                        }
                    }
                    .background(colors.bgSecondary)
                    .cornerRadius(12)

                    // Features
                    VStack(spacing: 0) {
                        sectionHeader("Features")

                        featureToggle("Workouts", id: "workouts", isOn: prefs.features.workouts)
                        featureToggle("Calendar", id: "calendar", isOn: prefs.features.calendar)
                        featureToggle("Weight", id: "weight", isOn: prefs.features.weight)

                        settingsRow("Rest Timer") {
                            Toggle("", isOn: Binding(
                                get: { theme.restTimerEnabled },
                                set: { theme.restTimerEnabled = $0 }
                            ))
                            .tint(colors.accent)
                        }
                    }
                    .background(colors.bgSecondary)
                    .cornerRadius(12)

                    // Sign out
                    VStack(spacing: 0) {
                        Button("Sign Out") {
                            // TODO: Wire to auth
                        }
                        .font(.system(size: 15))
                        .foregroundColor(colors.danger)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                        .padding(.vertical, 4)
                    }
                    .background(colors.bgSecondary)
                    .cornerRadius(12)
                }
                .padding(16)
            }
            .background(colors.bgPrimary)
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .textCase(.uppercase)
            .tracking(0.5)
            .foregroundColor(theme.colors.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)
    }

    private func settingsRow<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 15))
                .foregroundColor(theme.colors.textPrimary)
            Spacer()
            content()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(minHeight: 44)
    }

    private func featureToggle(_ label: String, id: String, isOn: Bool) -> some View {
        let colors = theme.colors
        return settingsRow(label) {
            Toggle("", isOn: Binding(
                get: { isOn },
                set: { _ in prefs.toggleFeature(id) }
            ))
            .tint(colors.accent)
            .disabled(isOn && prefs.enabledCount <= 1)
        }
    }
}
