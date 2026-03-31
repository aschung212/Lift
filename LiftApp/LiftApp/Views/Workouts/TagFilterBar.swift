import SwiftUI

struct TagFilterBar: View {
    let tags: [String]
    @Binding var activeFilters: [String]
    let accentColor: Color
    @Environment(ThemeStore.self) private var theme

    var body: some View {
        let colors = theme.colors

        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    let isActive = activeFilters.contains(tag)
                    Button {
                        if isActive {
                            activeFilters.removeAll { $0 == tag }
                        } else {
                            activeFilters.append(tag)
                        }
                    } label: {
                        Text(tag)
                            .font(.system(size: 14, weight: .semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .frame(minHeight: 44)
                            .foregroundColor(isActive ? .white : colors.textSecondary)
                            .background(isActive ? accentColor : Color.clear)
                            .cornerRadius(14)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(isActive ? accentColor : colors.borderStrong, lineWidth: 1)
                            )
                    }
                }

                if !activeFilters.isEmpty {
                    Button {
                        activeFilters.removeAll()
                    } label: {
                        Text("\u{00D7} Clear")
                            .font(.system(size: 14, weight: .semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .frame(minHeight: 44)
                            .foregroundColor(colors.danger)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(colors.danger, lineWidth: 1)
                            )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }
}
