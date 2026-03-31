import Foundation

extension Date {
    /// Create a date from "YYYY-MM-DD" string anchored at noon to avoid timezone issues
    static func fromISO(_ str: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = .current
        return formatter.date(from: str + "T12:00:00") ?? Date()
    }

    /// Format as "YYYY-MM-DD"
    var isoDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: self)
    }

    /// Format as "Mar 30"
    var shortDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter.string(from: self)
    }

    /// Format as "Monday, March 30"
    var longDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: self)
    }

    /// Format as "Mar 2026"
    var monthYear: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM yyyy"
        return formatter.string(from: self)
    }

    /// Days ago from today
    static func daysAgo(_ n: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: -n, to: Date()) ?? Date()
    }

    /// Start of day
    var startOfDay: Date {
        Calendar.current.startOfDay(for: self)
    }

    /// Same calendar day check
    func isSameDay(as other: Date) -> Bool {
        Calendar.current.isDate(self, inSameDayAs: other)
    }

    /// Today's date string
    static var todayISO: String {
        Date().isoDate
    }
}
