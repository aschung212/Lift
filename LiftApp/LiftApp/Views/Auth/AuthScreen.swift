import SwiftUI

struct AuthScreen: View {
    @Environment(ThemeStore.self) private var theme
    @State private var email = ""
    @State private var password = ""
    @State private var isSignUp = false
    @State private var submitting = false
    @State private var message = ""
    @State private var isError = false

    let onSignIn: () -> Void

    var body: some View {
        let colors = theme.colors

        VStack(spacing: 0) {
            Spacer()

            Text("Lift")
                .font(.system(size: 42, weight: .heavy))
                .foregroundColor(colors.accent)
                .padding(.bottom, 6)

            Text("Track your sets, monitor progress, hit PRs.")
                .font(.system(size: 14))
                .foregroundColor(colors.textSecondary)
                .padding(.bottom, 32)

            VStack(spacing: 10) {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                    .font(.system(size: 16))
                    .padding(12)
                    .frame(minHeight: 44)
                    .background(colors.bgPrimary)
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(colors.borderStrong, lineWidth: 1))

                SecureField("Password", text: $password)
                    .textContentType(isSignUp ? .newPassword : .password)
                    .font(.system(size: 16))
                    .padding(12)
                    .frame(minHeight: 44)
                    .background(colors.bgPrimary)
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(colors.borderStrong, lineWidth: 1))

                Button {
                    // TODO: Wire to Supabase auth
                    // For now, just proceed
                    onSignIn()
                } label: {
                    Text(submitting ? "..." : (isSignUp ? "Create Account" : "Sign In"))
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                        .foregroundColor(.white)
                        .background(colors.accent)
                        .cornerRadius(10)
                }
                .disabled(submitting)
            }
            .padding(.bottom, 12)

            Button {
                isSignUp.toggle()
                message = ""
            } label: {
                Text(isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up")
                    .font(.system(size: 14))
                    .foregroundColor(colors.textSecondary)
                    .frame(minHeight: 44)
            }

            if !message.isEmpty {
                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(isError ? colors.danger : colors.success)
                    .padding(.top, 16)
            }

            Spacer()
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity)
        .background(colors.bgPrimary)
    }
}
