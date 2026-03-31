import SwiftUI

struct EditExerciseSheet: View {
    let exercise: Exercise
    @Environment(WorkoutStore.self) private var store
    @Environment(ThemeStore.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var name: String = ""
    @State private var selectedTags: [String] = []
    @State private var newTagText = ""

    var allTags: [String] {
        Array(Set(store.allTags + selectedTags)).sorted()
    }

    var body: some View {
        let colors = theme.colors

        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("EXERCISE NAME")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.6)
                            .foregroundColor(colors.textSecondary)
                        TextField("Exercise name", text: $name)
                            .font(.system(size: 16))
                            .padding(12)
                            .frame(minHeight: 44)
                            .background(colors.bgPrimary)
                            .cornerRadius(8)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.borderStrong, lineWidth: 1))
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("TAGS")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.6)
                            .foregroundColor(colors.textSecondary)

                        if !allTags.isEmpty {
                            FlowLayout(spacing: 8) {
                                ForEach(allTags, id: \.self) { tag in
                                    let isSelected = selectedTags.contains(tag)
                                    Button {
                                        if isSelected {
                                            selectedTags.removeAll { $0 == tag }
                                        } else {
                                            selectedTags.append(tag)
                                        }
                                    } label: {
                                        Text(tag)
                                            .font(.system(size: 14, weight: .semibold))
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 8)
                                            .foregroundColor(isSelected ? colors.accent : colors.textSecondary)
                                            .background(isSelected ? colors.accentSubtle : Color.clear)
                                            .cornerRadius(12)
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 12)
                                                    .stroke(isSelected ? colors.accent : colors.borderStrong, lineWidth: 1)
                                            )
                                    }
                                }
                            }
                        }

                        HStack(spacing: 6) {
                            TextField("New tag...", text: $newTagText)
                                .font(.system(size: 16))
                                .padding(12)
                                .frame(minHeight: 44)
                                .background(colors.bgPrimary)
                                .cornerRadius(8)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.borderStrong, lineWidth: 1))
                                .onSubmit { addTag() }

                            Button("+") { addTag() }
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(colors.accent)
                                .frame(width: 44, height: 44)
                                .background(colors.bgPrimary)
                                .cornerRadius(8)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.border, lineWidth: 1))
                                .disabled(newTagText.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }

                    HStack(spacing: 8) {
                        Button {
                            store.renameExercise(id: exercise.id, newName: name)
                            store.updateExerciseTags(id: exercise.id, tags: selectedTags)
                            dismiss()
                        } label: {
                            Text("Save")
                                .font(.system(size: 15, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 44)
                                .foregroundColor(.white)
                                .background(colors.accent)
                                .cornerRadius(10)
                        }

                        Button { dismiss() } label: {
                            Text("Cancel")
                                .font(.system(size: 15, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 44)
                                .foregroundColor(colors.textSecondary)
                                .background(colors.bgElevated)
                                .cornerRadius(10)
                        }
                    }
                }
                .padding(22)
            }
            .background(colors.bgSecondary)
            .navigationTitle("Edit Exercise")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            name = exercise.name
            selectedTags = exercise.tags
        }
    }

    private func addTag() {
        let trimmed = newTagText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !selectedTags.contains(trimmed) else { return }
        selectedTags.append(trimmed)
        newTagText = ""
    }
}
