import Foundation
import Observation

@Observable
final class RestTimerStore {
    var isActive = false
    var isPaused = false
    var seconds: Int = 0
    var duration: Int

    var presets: [Int] {
        didSet { savePresets() }
    }
    var disabledPresets: [Int] {
        didSet { UserDefaults.standard.set(try? JSONEncoder().encode(disabledPresets), forKey: "rest-presets-disabled") }
    }
    var warningTimes: [Int] {
        didSet { UserDefaults.standard.set(try? JSONEncoder().encode(warningTimes), forKey: "rest-warnings") }
    }
    var warningOptions: [Int] {
        didSet { UserDefaults.standard.set(try? JSONEncoder().encode(warningOptions), forKey: "rest-warning-options") }
    }

    var visiblePresets: [Int] {
        presets.filter { !disabledPresets.contains($0) }.sorted()
    }

    var progress: Double {
        guard duration > 0 else { return 0 }
        return Double(seconds) / Double(duration)
    }

    var display: String {
        let m = seconds / 60
        let s = seconds % 60
        return "\(m):\(String(format: "%02d", s))"
    }

    private var timer: Timer?

    static let defaultPresets = [30, 60, 90, 120, 180, 300]
    static let defaultWarningOptions = [3, 5, 10, 15, 30]

    init() {
        let savedDuration = UserDefaults.standard.integer(forKey: "rest-duration")
        self.duration = savedDuration > 0 ? savedDuration : 90

        if let data = UserDefaults.standard.data(forKey: "rest-presets"),
           let decoded = try? JSONDecoder().decode([Int].self, from: data) {
            self.presets = decoded
        } else {
            self.presets = Self.defaultPresets
        }

        if let data = UserDefaults.standard.data(forKey: "rest-presets-disabled"),
           let decoded = try? JSONDecoder().decode([Int].self, from: data) {
            self.disabledPresets = decoded
        } else {
            self.disabledPresets = []
        }

        if let data = UserDefaults.standard.data(forKey: "rest-warnings"),
           let decoded = try? JSONDecoder().decode([Int].self, from: data) {
            self.warningTimes = decoded
        } else {
            self.warningTimes = [5]
        }

        if let data = UserDefaults.standard.data(forKey: "rest-warning-options"),
           let decoded = try? JSONDecoder().decode([Int].self, from: data) {
            self.warningOptions = decoded
        } else {
            self.warningOptions = Self.defaultWarningOptions
        }
    }

    func start() {
        isActive = true
        isPaused = false
        seconds = duration
        startInterval()
    }

    func togglePause() {
        isPaused.toggle()
    }

    func restart() {
        seconds = duration
        isPaused = false
        startInterval()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        isActive = false
        isPaused = false
        seconds = 0
    }

    func setDuration(_ s: Int) {
        duration = s
        seconds = s
        isPaused = false
        UserDefaults.standard.set(s, forKey: "rest-duration")
        startInterval()
    }

    func addPreset(_ value: Int) {
        guard value >= 5, value <= 600, !presets.contains(value) else { return }
        presets.append(value)
        presets.sort()
    }

    func removePreset(_ value: Int) {
        guard presets.count > 1 else { return }
        presets.removeAll { $0 == value }
        disabledPresets.removeAll { $0 == value }
    }

    func togglePresetEnabled(_ value: Int) {
        if disabledPresets.contains(value) {
            disabledPresets.removeAll { $0 == value }
        } else {
            disabledPresets.append(value)
        }
    }

    func resetDefaults() {
        presets = Self.defaultPresets
        disabledPresets = []
        warningOptions = Self.defaultWarningOptions
        warningTimes = [5]
    }

    private func startInterval() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, self.isActive, !self.isPaused else { return }
            if self.seconds > 0 {
                self.seconds -= 1
            }
            if self.seconds == 0 {
                self.timer?.invalidate()
                self.timer = nil
            }
        }
    }

    private func savePresets() {
        if let data = try? JSONEncoder().encode(presets) {
            UserDefaults.standard.set(data, forKey: "rest-presets")
        }
    }

    func formatDuration(_ s: Int) -> String {
        if s < 60 { return "\(s)s" }
        let m = s / 60
        let sec = s % 60
        return sec == 0 ? "\(m)m" : "\(m):\(String(format: "%02d", sec))"
    }
}
