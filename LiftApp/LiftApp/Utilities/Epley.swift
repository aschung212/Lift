import Foundation

/// Epley 1RM formula: weight * (1 + reps / 30)
/// If reps == 1, returns weight as-is (it's already a 1RM)
func epley(_ weight: Double, _ reps: Int) -> Int {
    if reps <= 1 { return Int(weight.rounded()) }
    return Int((weight * (1.0 + Double(reps) / 30.0)).rounded())
}
