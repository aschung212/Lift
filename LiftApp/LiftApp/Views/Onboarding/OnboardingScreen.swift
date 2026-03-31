import SwiftUI

struct OnboardingScreen: View {
    let onComplete: () -> Void
    @Environment(WorkoutStore.self) private var workoutStore
    @Environment(BodyweightStore.self) private var bodyweightStore
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        let colors = theme.colors

        VStack(spacing: 0) {
            Spacer()

            Text("Lift")
                .font(.system(size: 48, weight: .heavy))
                .foregroundColor(colors.accent)
                .padding(.bottom, 8)

            Text("How would you like to get started?")
                .font(.system(size: 16))
                .foregroundColor(colors.textSecondary)
                .padding(.bottom, 32)

            VStack(spacing: 12) {
                onboardingOption(icon: "plus.circle", title: "Start Empty", subtitle: "Add your own exercises from scratch") {
                    UserDefaults.standard.set(true, forKey: "onboarding-complete")
                    onComplete()
                }

                onboardingOption(icon: "figure.strengthtraining.traditional", title: "Popular Exercises", subtitle: "Pre-load 6 common lifts with tags") {
                    populateStarterExercises(workoutStore: workoutStore)
                    UserDefaults.standard.set(true, forKey: "onboarding-complete")
                    onComplete()
                }

                onboardingOption(icon: "eye.fill", title: "Explore First", subtitle: "See the app with sample data, clear it when ready") {
                    populateSampleData(workoutStore: workoutStore, bodyweightStore: bodyweightStore)
                    UserDefaults.standard.set(true, forKey: "onboarding-complete")
                    onComplete()
                }
            }
            .padding(.horizontal, 20)

            Spacer()
        }
        .background(colors.bgPrimary)
    }

    private func onboardingOption(icon: String, title: String, subtitle: String, action: @escaping () -> Void) -> some View {
        let colors = theme.colors
        return Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 28))
                    .frame(width: 44)
                    .foregroundColor(colors.accent)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(colors.textPrimary)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(colors.textSecondary)
                }

                Spacer()
            }
            .padding(16)
            .frame(minHeight: 44)
            .background(colors.bgSecondary)
            .cornerRadius(14)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(colors.borderStrong, lineWidth: 1)
            )
        }
    }
}
