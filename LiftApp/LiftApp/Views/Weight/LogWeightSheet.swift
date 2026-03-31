import SwiftUI

struct LogWeightSheet: View {
    var editingEntry: BodyweightEntry? = nil
    @Environment(BodyweightStore.self) private var store
    @Environment(ThemeStore.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var weight = ""
    @State private var date = Date()

    var isEditing: Bool { editingEntry != nil }
    var weightValue: Double? { Double(weight) }
    var canSave: Bool { weightValue != nil && weightValue! > 0 }

    var body: some View {
        let colors = theme.colors

        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("DATE")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.6)
                            .foregroundColor(colors.textSecondary)
                        DatePicker("", selection: $date, in: ...Date(), displayedComponents: .date)
                            .datePickerStyle(.compact)
                            .labelsHidden()
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("WEIGHT (\(theme.weightUnit.rawValue))")
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.6)
                            .foregroundColor(colors.textSecondary)
                        TextField("170", text: $weight)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 16))
                            .padding(12)
                            .frame(minHeight: 44)
                            .background(colors.bgPrimary)
                            .cornerRadius(8)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.borderStrong, lineWidth: 1))
                    }

                    HStack(spacing: 8) {
                        Button {
                            guard let w = weightValue else { return }
                            let lbsWeight = theme.toLbs(w)
                            if let entry = editingEntry {
                                store.updateEntry(id: entry.id, weight: lbsWeight, dateStr: date.isoDate)
                            } else {
                                _ = store.addEntry(weight: lbsWeight, dateStr: date.isoDate)
                            }
                            dismiss()
                        } label: {
                            Text(isEditing ? "Save Changes" : "Save")
                                .font(.system(size: 15, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 44)
                                .foregroundColor(.white)
                                .background(canSave ? colors.accent : colors.accent.opacity(0.5))
                                .cornerRadius(10)
                        }
                        .disabled(!canSave)

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
            .navigationTitle(isEditing ? "Edit Weight" : "Log Weight")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            if let entry = editingEntry {
                weight = String(theme.displayWeight(entry.weight))
                date = entry.date
            }
        }
    }
}
