import Foundation

enum WeightUnit: String, Codable, CaseIterable {
    case lbs
    case kg

    /// Convert from stored lbs to display unit
    func display(_ lbs: Double) -> Double {
        switch self {
        case .lbs: return lbs
        case .kg: return (lbs * 0.453592 * 10).rounded() / 10
        }
    }

    /// Convert from stored lbs (Int e1RM) to display unit
    func display(_ lbs: Int) -> Double {
        display(Double(lbs))
    }

    /// Convert from user input (current unit) to lbs for storage
    func toLbs(_ value: Double) -> Double {
        switch self {
        case .lbs: return value
        case .kg: return ((value / 0.453592) * 10).rounded() / 10
        }
    }

    /// Format a weight for display (removes trailing .0 for lbs)
    func format(_ lbs: Double) -> String {
        let displayed = display(lbs)
        if displayed == displayed.rounded() && self == .lbs {
            return String(Int(displayed))
        }
        return String(format: "%.1f", displayed)
    }

    func format(_ lbs: Int) -> String {
        format(Double(lbs))
    }
}
