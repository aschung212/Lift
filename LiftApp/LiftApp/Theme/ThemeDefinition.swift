import SwiftUI

enum ThemeID: String, Codable, CaseIterable {
    case midnight, graphite, arctic, forge, aaron, tina

    var label: String {
        rawValue.capitalized
    }

    var dot: Color {
        switch self {
        case .midnight: Color(hex: "#ff6363")
        case .graphite: Color(hex: "#8b5cf6")
        case .arctic:   Color(hex: "#0066ff")
        case .forge:    Color(hex: "#f59e0b")
        case .aaron:    Color(hex: "#2a8a4a")
        case .tina:     Color(hex: "#ec4899")
        }
    }

    func preview(for mode: ColorMode) -> ThemePreview {
        let resolved = mode == .auto ? .dark : mode
        switch (self, resolved) {
        case (.midnight, .dark):   return ThemePreview(bg: "#0f0f0f", accent: "#ff6363")
        case (.midnight, .light):  return ThemePreview(bg: "#f2eded", accent: "#dc3545")
        case (.graphite, .dark):   return ThemePreview(bg: "#111118", accent: "#8b5cf6")
        case (.graphite, .light):  return ThemePreview(bg: "#ededf5", accent: "#7c3aed")
        case (.arctic, .dark):     return ThemePreview(bg: "#0e1420", accent: "#3388ff")
        case (.arctic, .light):    return ThemePreview(bg: "#dde4f5", accent: "#0066ff")
        case (.forge, .dark):      return ThemePreview(bg: "#100e0b", accent: "#f59e0b")
        case (.forge, .light):     return ThemePreview(bg: "#f5ede0", accent: "#d97706")
        case (.aaron, .dark):      return ThemePreview(bg: "#14261a", accent: "#c8a44e")
        case (.aaron, .light):     return ThemePreview(bg: "#c8e0cc", accent: "#a0842a")
        case (.tina, .dark):       return ThemePreview(bg: "#1a1020", accent: "#f472b6")
        case (.tina, .light):      return ThemePreview(bg: "#f0dff0", accent: "#ec4899")
        default:                   return ThemePreview(bg: "#0f0f0f", accent: "#ff6363")
        }
    }

    func colors(for mode: ColorMode) -> ThemeColors {
        let resolved = mode == .auto ? .dark : mode
        switch (self, resolved) {
        case (.midnight, .dark): return .midnightDark
        case (.midnight, .light): return .midnightLight
        case (.graphite, .dark): return .graphiteDark
        case (.graphite, .light): return .graphiteLight
        case (.arctic, .dark): return .arcticDark
        case (.arctic, .light): return .arcticLight
        case (.forge, .dark): return .forgeDark
        case (.forge, .light): return .forgeLight
        case (.aaron, .dark): return .aaronDark
        case (.aaron, .light): return .aaronLight
        case (.tina, .dark): return .tinaDark
        case (.tina, .light): return .tinaLight
        default: return .midnightDark
        }
    }
}

enum ColorMode: String, Codable, CaseIterable {
    case light, auto, dark
}

struct ThemePreview {
    let bg: String
    let accent: String

    var bgColor: Color { Color(hex: bg) }
    var accentColor: Color { Color(hex: accent) }
}

struct ThemeColors {
    let bgPrimary: Color
    let bgSecondary: Color
    let bgElevated: Color
    let bgHover: Color
    let border: Color
    let borderStrong: Color
    let textPrimary: Color
    let textSecondary: Color
    let textMuted: Color
    let accent: Color
    let accentHover: Color
    let accentSubtle: Color
    let danger: Color
    let dangerSubtle: Color
    let success: Color
    let successSubtle: Color
}

// MARK: - All Theme Definitions

extension ThemeColors {
    static let midnightDark = ThemeColors(
        bgPrimary: Color(hex: "#0f0f0f"), bgSecondary: Color(hex: "#1a1a1a"),
        bgElevated: Color(hex: "#242424"), bgHover: Color(hex: "#2e2e2e"),
        border: Color(hex: "#2a2a2a"), borderStrong: Color(hex: "#3c3c3c"),
        textPrimary: Color(hex: "#f2f2f2"), textSecondary: Color(hex: "#888888"),
        textMuted: Color(hex: "#777777"), accent: Color(hex: "#ff6363"),
        accentHover: Color(hex: "#ff4444"), accentSubtle: Color(hex: "#ff6363").opacity(0.10),
        danger: Color(hex: "#ff5a5a"), dangerSubtle: Color(hex: "#ff5a5a").opacity(0.12),
        success: Color(hex: "#30d158"), successSubtle: Color(hex: "#30d158").opacity(0.12)
    )
    static let midnightLight = ThemeColors(
        bgPrimary: Color(hex: "#f2eded"), bgSecondary: Color(hex: "#ffffff"),
        bgElevated: Color(hex: "#ffffff"), bgHover: Color(hex: "#faf5f5"),
        border: Color(hex: "#e0d4d4"), borderStrong: Color(hex: "#c8b8b8"),
        textPrimary: Color(hex: "#1a1212"), textSecondary: Color(hex: "#6e5858"),
        textMuted: Color(hex: "#b0a0a0"), accent: Color(hex: "#dc3545"),
        accentHover: Color(hex: "#c82333"), accentSubtle: Color(hex: "#dc3545").opacity(0.08),
        danger: Color(hex: "#dc2626"), dangerSubtle: Color(hex: "#dc2626").opacity(0.08),
        success: Color(hex: "#16a34a"), successSubtle: Color(hex: "#16a34a").opacity(0.08)
    )
    static let graphiteDark = ThemeColors(
        bgPrimary: Color(hex: "#111118"), bgSecondary: Color(hex: "#1c1c28"),
        bgElevated: Color(hex: "#26263a"), bgHover: Color(hex: "#30304a"),
        border: Color(hex: "#2c2c42"), borderStrong: Color(hex: "#42425e"),
        textPrimary: Color(hex: "#e4e4f4"), textSecondary: Color(hex: "#7070a0"),
        textMuted: Color(hex: "#6868a0"), accent: Color(hex: "#8b5cf6"),
        accentHover: Color(hex: "#7c3aed"), accentSubtle: Color(hex: "#8b5cf6").opacity(0.13),
        danger: Color(hex: "#f87171"), dangerSubtle: Color(hex: "#f87171").opacity(0.12),
        success: Color(hex: "#34d399"), successSubtle: Color(hex: "#34d399").opacity(0.12)
    )
    static let graphiteLight = ThemeColors(
        bgPrimary: Color(hex: "#ededf5"), bgSecondary: Color(hex: "#ffffff"),
        bgElevated: Color(hex: "#ffffff"), bgHover: Color(hex: "#f2f0fa"),
        border: Color(hex: "#d4d0e8"), borderStrong: Color(hex: "#b8b0d4"),
        textPrimary: Color(hex: "#18182a"), textSecondary: Color(hex: "#5c5890"),
        textMuted: Color(hex: "#908cb0"), accent: Color(hex: "#7c3aed"),
        accentHover: Color(hex: "#6d28d9"), accentSubtle: Color(hex: "#7c3aed").opacity(0.08),
        danger: Color(hex: "#dc2626"), dangerSubtle: Color(hex: "#dc2626").opacity(0.08),
        success: Color(hex: "#16a34a"), successSubtle: Color(hex: "#16a34a").opacity(0.08)
    )
    static let arcticDark = ThemeColors(
        bgPrimary: Color(hex: "#0e1420"), bgSecondary: Color(hex: "#182030"),
        bgElevated: Color(hex: "#202c40"), bgHover: Color(hex: "#28364e"),
        border: Color(hex: "#243048"), borderStrong: Color(hex: "#384a68"),
        textPrimary: Color(hex: "#e0e8f8"), textSecondary: Color(hex: "#7888b0"),
        textMuted: Color(hex: "#687898"), accent: Color(hex: "#3388ff"),
        accentHover: Color(hex: "#1a75ff"), accentSubtle: Color(hex: "#3388ff").opacity(0.12),
        danger: Color(hex: "#f87171"), dangerSubtle: Color(hex: "#f87171").opacity(0.12),
        success: Color(hex: "#34d399"), successSubtle: Color(hex: "#34d399").opacity(0.12)
    )
    static let arcticLight = ThemeColors(
        bgPrimary: Color(hex: "#dde4f5"), bgSecondary: Color(hex: "#ffffff"),
        bgElevated: Color(hex: "#ffffff"), bgHover: Color(hex: "#f0f4ff"),
        border: Color(hex: "#c8d4ee"), borderStrong: Color(hex: "#a8b8e0"),
        textPrimary: Color(hex: "#1a1a2e"), textSecondary: Color(hex: "#60609a"),
        textMuted: Color(hex: "#9090b8"), accent: Color(hex: "#0066ff"),
        accentHover: Color(hex: "#0052cc"), accentSubtle: Color(hex: "#0066ff").opacity(0.08),
        danger: Color(hex: "#dc2626"), dangerSubtle: Color(hex: "#dc2626").opacity(0.08),
        success: Color(hex: "#16a34a"), successSubtle: Color(hex: "#16a34a").opacity(0.08)
    )
    static let forgeDark = ThemeColors(
        bgPrimary: Color(hex: "#100e0b"), bgSecondary: Color(hex: "#1c1814"),
        bgElevated: Color(hex: "#262118"), bgHover: Color(hex: "#302b22"),
        border: Color(hex: "#2c2620"), borderStrong: Color(hex: "#3e3630"),
        textPrimary: Color(hex: "#f0e8d8"), textSecondary: Color(hex: "#9a8870"),
        textMuted: Color(hex: "#7c7060"), accent: Color(hex: "#f59e0b"),
        accentHover: Color(hex: "#d97706"), accentSubtle: Color(hex: "#f59e0b").opacity(0.12),
        danger: Color(hex: "#ef4444"), dangerSubtle: Color(hex: "#ef4444").opacity(0.12),
        success: Color(hex: "#84cc16"), successSubtle: Color(hex: "#84cc16").opacity(0.12)
    )
    static let forgeLight = ThemeColors(
        bgPrimary: Color(hex: "#f5ede0"), bgSecondary: Color(hex: "#ffffff"),
        bgElevated: Color(hex: "#ffffff"), bgHover: Color(hex: "#faf5ec"),
        border: Color(hex: "#e2d4c0"), borderStrong: Color(hex: "#c8b498"),
        textPrimary: Color(hex: "#201a10"), textSecondary: Color(hex: "#7a6848"),
        textMuted: Color(hex: "#a89878"), accent: Color(hex: "#d97706"),
        accentHover: Color(hex: "#b45309"), accentSubtle: Color(hex: "#d97706").opacity(0.08),
        danger: Color(hex: "#dc2626"), dangerSubtle: Color(hex: "#dc2626").opacity(0.08),
        success: Color(hex: "#4d7c0f"), successSubtle: Color(hex: "#4d7c0f").opacity(0.08)
    )
    static let aaronDark = ThemeColors(
        bgPrimary: Color(hex: "#060e08"), bgSecondary: Color(hex: "#0c1a10"),
        bgElevated: Color(hex: "#14261a"), bgHover: Color(hex: "#1c3224"),
        border: Color(hex: "#163020"), borderStrong: Color(hex: "#24442e"),
        textPrimary: Color(hex: "#e8f0ea"), textSecondary: Color(hex: "#6aaa7a"),
        textMuted: Color(hex: "#4d8860"), accent: Color(hex: "#c8a44e"),
        accentHover: Color(hex: "#b8923e"), accentSubtle: Color(hex: "#c8a44e").opacity(0.12),
        danger: Color(hex: "#ef4444"), dangerSubtle: Color(hex: "#ef4444").opacity(0.12),
        success: Color(hex: "#4ade80"), successSubtle: Color(hex: "#4ade80").opacity(0.12)
    )
    static let aaronLight = ThemeColors(
        bgPrimary: Color(hex: "#e8f2ea"), bgSecondary: Color(hex: "#f4faf5"),
        bgElevated: Color(hex: "#ffffff"), bgHover: Color(hex: "#e0f0e4"),
        border: Color(hex: "#b8d8c0"), borderStrong: Color(hex: "#90c0a0"),
        textPrimary: Color(hex: "#0c1a10"), textSecondary: Color(hex: "#3a7050"),
        textMuted: Color(hex: "#70a880"), accent: Color(hex: "#a0842a"),
        accentHover: Color(hex: "#886e1e"), accentSubtle: Color(hex: "#a0842a").opacity(0.08),
        danger: Color(hex: "#dc2626"), dangerSubtle: Color(hex: "#dc2626").opacity(0.08),
        success: Color(hex: "#16a34a"), successSubtle: Color(hex: "#16a34a").opacity(0.08)
    )
    static let tinaDark = ThemeColors(
        bgPrimary: Color(hex: "#1a1020"), bgSecondary: Color(hex: "#261830"),
        bgElevated: Color(hex: "#322040"), bgHover: Color(hex: "#3e2850"),
        border: Color(hex: "#362048"), borderStrong: Color(hex: "#503868"),
        textPrimary: Color(hex: "#f0e4f4"), textSecondary: Color(hex: "#a080c0"),
        textMuted: Color(hex: "#806898"), accent: Color(hex: "#f472b6"),
        accentHover: Color(hex: "#ec4899"), accentSubtle: Color(hex: "#f472b6").opacity(0.12),
        danger: Color(hex: "#f87171"), dangerSubtle: Color(hex: "#f87171").opacity(0.12),
        success: Color(hex: "#34d399"), successSubtle: Color(hex: "#34d399").opacity(0.12)
    )
    static let tinaLight = ThemeColors(
        bgPrimary: Color(hex: "#f0dff0"), bgSecondary: Color(hex: "#ffffff"),
        bgElevated: Color(hex: "#ffffff"), bgHover: Color(hex: "#f8eef8"),
        border: Color(hex: "#e0c8e0"), borderStrong: Color(hex: "#c8a0c8"),
        textPrimary: Color(hex: "#1e1028"), textSecondary: Color(hex: "#7060a0"),
        textMuted: Color(hex: "#a890b8"), accent: Color(hex: "#ec4899"),
        accentHover: Color(hex: "#db2777"), accentSubtle: Color(hex: "#ec4899").opacity(0.08),
        danger: Color(hex: "#dc2626"), dangerSubtle: Color(hex: "#dc2626").opacity(0.08),
        success: Color(hex: "#16a34a"), successSubtle: Color(hex: "#16a34a").opacity(0.08)
    )
}

// MARK: - Color hex initializer

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let scanner = Scanner(string: hex)
        var rgb: UInt64 = 0
        scanner.scanHexInt64(&rgb)
        let r = Double((rgb >> 16) & 0xFF) / 255.0
        let g = Double((rgb >> 8) & 0xFF) / 255.0
        let b = Double(rgb & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}
