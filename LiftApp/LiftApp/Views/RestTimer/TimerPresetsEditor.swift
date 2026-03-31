import SwiftUI

struct TimerPresetsEditor: View {
    @Environment(RestTimerStore.self) private var timer
    @Environment(ThemeStore.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var editTab = "rest"
    @State private var newPresetValue = ""
    @State private var newWarningValue = ""

    var body: some View {
        let colors = theme.colors

        NavigationStack {
            VStack(spacing: 0) {
                // Countdown display
                Button { timer.togglePause() } label: {
                    Text(timer.display)
                        .font(.system(size: 20, weight: .light))
                        .monospacedDigit()
                        .foregroundColor(colors.textMuted)
                }
                .padding(.vertical, 8)

                // Tabs
                HStack(spacing: 0) {
                    tabButton("Rest Times", id: "rest")
                    tabButton("Alerts", id: "alerts")
                }
                .overlay(alignment: .bottom) {
                    Rectangle().fill(colors.border).frame(height: 0.5)
                }

                ScrollView {
                    if editTab == "rest" {
                        restTimesEditor
                    } else {
                        alertsEditor
                    }
                }

                // Reset
                Button("Reset to defaults") {
                    timer.resetDefaults()
                }
                .font(.system(size: 13))
                .foregroundColor(colors.textMuted)
                .frame(minHeight: 44)
                .padding(.bottom, 8)

                Button {
                    dismiss()
                } label: {
                    Text("Done")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                        .foregroundColor(.white)
                        .background(colors.accent)
                        .cornerRadius(10)
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 16)
            }
            .background(colors.bgSecondary)
            .navigationTitle("Edit Times")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var restTimesEditor: some View {
        let colors = theme.colors

        return VStack(spacing: 0) {
            ForEach(timer.presets, id: \.self) { s in
                HStack {
                    Text(timer.formatDuration(s))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(colors.textPrimary)

                    Spacer()

                    Toggle("", isOn: Binding(
                        get: { !timer.disabledPresets.contains(s) },
                        set: { _ in timer.togglePresetEnabled(s) }
                    ))
                    .tint(colors.accent)

                    Button {
                        timer.removePreset(s)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(colors.textMuted)
                            .frame(width: 44, height: 44)
                    }
                    .disabled(timer.presets.count <= 1)
                    .opacity(timer.presets.count <= 1 ? 0.15 : 1)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)

                Divider().background(colors.border)
            }

            HStack(spacing: 8) {
                TextField("Add seconds", text: $newPresetValue)
                    .keyboardType(.numberPad)
                    .font(.system(size: 16))
                    .padding(10)
                    .frame(minHeight: 44)
                    .background(colors.bgPrimary)
                    .cornerRadius(8)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.border, lineWidth: 1))

                Button("Add") {
                    if let val = Int(newPresetValue) {
                        timer.addPreset(val)
                        newPresetValue = ""
                    }
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(newPresetValue.isEmpty ? colors.accent.opacity(0.5) : colors.accent)
                .cornerRadius(8)
                .disabled(newPresetValue.isEmpty)
            }
            .padding(16)
        }
    }

    private var alertsEditor: some View {
        let colors = theme.colors

        return VStack(spacing: 0) {
            ForEach(timer.warningOptions, id: \.self) { s in
                HStack {
                    Text("\(s)s before")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(colors.textPrimary)

                    Spacer()

                    Toggle("", isOn: Binding(
                        get: { timer.warningTimes.contains(s) },
                        set: { _ in
                            if timer.warningTimes.contains(s) {
                                timer.warningTimes.removeAll { $0 == s }
                            } else {
                                timer.warningTimes.append(s)
                            }
                        }
                    ))
                    .tint(colors.accent)

                    Button {
                        timer.warningOptions.removeAll { $0 == s }
                        timer.warningTimes.removeAll { $0 == s }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(colors.textMuted)
                            .frame(width: 44, height: 44)
                    }
                    .disabled(timer.warningOptions.count <= 1)
                    .opacity(timer.warningOptions.count <= 1 ? 0.15 : 1)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)

                Divider().background(colors.border)
            }

            HStack(spacing: 8) {
                TextField("Add seconds", text: $newWarningValue)
                    .keyboardType(.numberPad)
                    .font(.system(size: 16))
                    .padding(10)
                    .frame(minHeight: 44)
                    .background(colors.bgPrimary)
                    .cornerRadius(8)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.border, lineWidth: 1))

                Button("Add") {
                    if let val = Int(newWarningValue), val >= 1, val <= 120 {
                        if !timer.warningOptions.contains(val) {
                            timer.warningOptions.append(val)
                            timer.warningOptions.sort()
                        }
                        newWarningValue = ""
                    }
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(newWarningValue.isEmpty ? colors.accent.opacity(0.5) : colors.accent)
                .cornerRadius(8)
                .disabled(newWarningValue.isEmpty)
            }
            .padding(16)
        }
    }

    private func tabButton(_ label: String, id: String) -> some View {
        let colors = theme.colors
        let isActive = editTab == id
        return Button { editTab = id } label: {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(isActive ? colors.accent : colors.textMuted)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
                .overlay(alignment: .bottom) {
                    if isActive {
                        Rectangle().fill(colors.accent).frame(height: 2)
                    }
                }
        }
    }
}
