import SwiftUI

struct RestTimerSheet: View {
    @Environment(RestTimerStore.self) private var timer
    @Environment(ThemeStore.self) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var showEditor = false

    var body: some View {
        let colors = theme.colors

        NavigationStack {
            VStack(spacing: 16) {
                // Circular ring
                ZStack {
                    Circle()
                        .stroke(colors.border, lineWidth: 6)
                        .frame(width: 200, height: 200)

                    Circle()
                        .trim(from: 0, to: timer.progress)
                        .stroke(colors.accent, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .frame(width: 200, height: 200)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 1), value: timer.progress)

                    VStack(spacing: 4) {
                        Text(timer.display)
                            .font(.system(size: 48, weight: .ultraLight))
                            .monospacedDigit()
                            .foregroundColor(timer.seconds == 0 ? colors.accent : colors.textPrimary)

                        Text(timer.seconds == 0 ? "Done" : "remaining")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(colors.textMuted)
                            .textCase(.uppercase)
                    }
                }
                .padding(.top, 8)

                // Play / Pause / Restart
                HStack {
                    if timer.seconds == 0 {
                        Button { timer.restart() } label: {
                            Image(systemName: "arrow.counterclockwise")
                                .font(.system(size: 28))
                        }
                    } else if timer.isPaused {
                        Button { timer.togglePause() } label: {
                            Image(systemName: "play.fill")
                                .font(.system(size: 28))
                        }
                    } else {
                        Button { timer.togglePause() } label: {
                            Image(systemName: "pause.fill")
                                .font(.system(size: 28))
                        }
                    }
                }
                .foregroundColor(colors.textPrimary)
                .frame(width: 56, height: 56)
                .background(colors.bgElevated)
                .clipShape(Circle())
                .shadow(radius: 4, y: 2)

                // Duration presets
                FlowLayout(spacing: 8) {
                    ForEach(timer.visiblePresets, id: \.self) { s in
                        Button {
                            timer.setDuration(s)
                        } label: {
                            Text(timer.formatDuration(s))
                                .font(.system(size: 14, weight: .semibold))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .frame(minHeight: 44)
                                .foregroundColor(timer.duration == s ? colors.accent : colors.textSecondary)
                                .background(timer.duration == s ? colors.accentSubtle : Color.clear)
                                .cornerRadius(22)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 22)
                                        .stroke(timer.duration == s ? colors.accent : colors.border, lineWidth: 1)
                                )
                        }
                    }
                }
                .padding(.horizontal, 16)

                // Actions
                HStack(spacing: 8) {
                    Button {
                        dismiss()
                    } label: {
                        Text("Done")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 44)
                            .foregroundColor(colors.textSecondary)
                            .background(colors.bgElevated)
                            .cornerRadius(10)
                    }
                }
                .padding(.horizontal, 22)

                // Footer
                HStack(spacing: 16) {
                    Button { showEditor = true } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 18))
                            .foregroundColor(colors.textMuted)
                            .frame(minHeight: 44)
                    }

                    Button {
                        timer.stop()
                        dismiss()
                    } label: {
                        Text("Stop")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(colors.danger)
                            .frame(minHeight: 44)
                    }
                }

                Spacer()
            }
            .background(colors.bgSecondary)
            .navigationTitle("Rest")
            .navigationBarTitleDisplayMode(.inline)
        }
        .sheet(isPresented: $showEditor) {
            TimerPresetsEditor()
        }
        .onAppear {
            if !timer.isActive {
                timer.start()
            }
        }
    }
}
