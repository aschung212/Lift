import SwiftUI
import Observation

@Observable
final class ThemeStore {
    var currentTheme: ThemeID {
        didSet { UserDefaults.standard.set(currentTheme.rawValue, forKey: "app-theme") }
    }
    var colorMode: ColorMode {
        didSet { UserDefaults.standard.set(colorMode.rawValue, forKey: "app-mode") }
    }
    var glassEnabled: Bool {
        didSet { UserDefaults.standard.set(glassEnabled ? "on" : "off", forKey: "app-glass") }
    }
    var weightUnit: WeightUnit {
        didSet { UserDefaults.standard.set(weightUnit.rawValue, forKey: "weight-unit") }
    }
    var restTimerEnabled: Bool {
        didSet { UserDefaults.standard.set(restTimerEnabled ? "on" : "off", forKey: "rest-timer") }
    }

    var systemIsDark: Bool = false

    var resolvedMode: ColorMode {
        if colorMode == .auto {
            return systemIsDark ? .dark : .light
        }
        return colorMode
    }

    var colors: ThemeColors {
        currentTheme.colors(for: resolvedMode)
    }

    // Weight helpers
    func displayWeight(_ lbs: Double) -> Double {
        weightUnit.display(lbs)
    }

    func displayWeight(_ lbs: Int) -> Double {
        weightUnit.display(lbs)
    }

    func formatWeight(_ lbs: Double) -> String {
        weightUnit.format(lbs)
    }

    func formatWeight(_ lbs: Int) -> String {
        weightUnit.format(lbs)
    }

    func toLbs(_ value: Double) -> Double {
        weightUnit.toLbs(value)
    }

    init() {
        let themeRaw = UserDefaults.standard.string(forKey: "app-theme") ?? "midnight"
        self.currentTheme = ThemeID(rawValue: themeRaw) ?? .midnight

        let modeRaw = UserDefaults.standard.string(forKey: "app-mode") ?? "auto"
        self.colorMode = ColorMode(rawValue: modeRaw) ?? .auto

        self.glassEnabled = UserDefaults.standard.string(forKey: "app-glass") != "off"
        self.restTimerEnabled = UserDefaults.standard.string(forKey: "rest-timer") != "off"

        let unitRaw = UserDefaults.standard.string(forKey: "weight-unit") ?? "lbs"
        self.weightUnit = WeightUnit(rawValue: unitRaw) ?? .lbs
    }
}
