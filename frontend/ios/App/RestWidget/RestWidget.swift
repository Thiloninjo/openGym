// Thilos Fork: das laufende Training auf dem Sperrbildschirm und in der Dynamic Island.
// Training: Übung, Satz x von y und die Trainingszeit. Pause: Countdown mit Fortschrittsbalken.
// Danach (Ablauf, auch per staleDate, wenn die App nicht mehr läuft): „Nächster Satz“.
// Text(timerInterval:) und ProgressView(timerInterval:) zählen selbst, die App muss dafür nicht laufen.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RestWidgetBundle: WidgetBundle {
    var body: some Widget { RestLiveActivity() }
}

private let accent = Color(red: 1.0, green: 0.62, blue: 0.04)

private func clock(_ sec: Int) -> String { String(format: "%d:%02d", sec / 60, sec % 60) }

typealias LiveState = RestActivityAttributes.ContentState

enum LivePhase { case training, rest, held, ready }

func livePhase(_ s: LiveState, stale: Bool) -> LivePhase {
    if s.restLeft != nil { return .held }
    if let end = s.restEndsAt { return (stale || end <= Date()) ? .ready : .rest }
    return s.ready ? .ready : .training
}

private func setLine(_ s: LiveState) -> String {
    s.setCount > 0 ? "Satz \(s.setNo) von \(s.setCount)" : ""
}

private func joined(_ parts: [String]) -> String {
    parts.filter { !$0.isEmpty }.joined(separator: " · ")
}

private func headline(_ s: LiveState, _ p: LivePhase) -> String {
    switch p {
    case .training: return s.exercise.isEmpty ? (s.name.isEmpty ? "Training" : s.name) : s.exercise
    case .rest, .held: return s.restTitle
    case .ready: return s.doneTitle
    }
}

private func detail(_ s: LiveState, _ p: LivePhase) -> String {
    switch p {
    case .training: return setLine(s)
    case .held: return joined(["Angehalten", s.exercise])
    case .rest, .ready: return joined([s.exercise, setLine(s)])
    }
}

private func symbol(_ p: LivePhase) -> String {
    switch p {
    case .training: return "figure.strengthtraining.traditional"
    case .rest, .held: return "timer"
    case .ready: return "checkmark"
    }
}

/// Trainingszeit, zählt selbst hoch.
struct Elapsed: View {
    let since: Date
    var body: some View {
        Text(timerInterval: since...since.addingTimeInterval(24 * 3600), countsDown: false)
    }
}

struct RestTime: View {
    let state: LiveState
    var body: some View {
        if let left = state.restLeft {
            Text(clock(left))
        } else if let end = state.restEndsAt {
            Text(timerInterval: end.addingTimeInterval(-Double(max(1, state.restTotal)))...end, countsDown: true)
        }
    }
}

struct RestBar: View {
    let state: LiveState
    var body: some View {
        if let left = state.restLeft {
            ProgressView(value: Double(left), total: Double(max(1, state.restTotal)))
        } else if let end = state.restEndsAt {
            ProgressView(timerInterval: end.addingTimeInterval(-Double(max(1, state.restTotal)))...end, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
        }
    }
}

struct LiveLockView: View {
    let state: LiveState
    let startedAt: Date
    let stale: Bool
    var body: some View {
        let p = livePhase(state, stale: stale)
        let more = detail(state, p)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(state.name.isEmpty ? "openGym" : state.name)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.6))
                    .lineLimit(1)
                Spacer()
                if p != .training {
                    Elapsed(since: startedAt)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.6))
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 70, alignment: .trailing)
                }
            }
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline(state, p))
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    if !more.isEmpty {
                        Text(more)
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.75))
                            .lineLimit(1)
                    }
                }
                Spacer()
                switch p {
                case .rest, .held:
                    RestTime(state: state)
                        .font(.system(size: 40, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 130, alignment: .trailing)
                case .training:
                    Elapsed(since: startedAt)
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 140, alignment: .trailing)
                case .ready:
                    Image(systemName: "figure.strengthtraining.traditional")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(accent)
                }
            }
            if p == .rest || p == .held { RestBar(state: state).tint(accent) }
        }
        .padding(16)
    }
}

struct RestLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestActivityAttributes.self) { context in
            LiveLockView(state: context.state, startedAt: context.attributes.startedAt, stale: context.isStale)
                .activityBackgroundTint(Color.black.opacity(0.82))
                .activitySystemActionForegroundColor(accent)
        } dynamicIsland: { context in
            let p = livePhase(context.state, stale: context.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(headline(context.state, p), systemImage: symbol(p))
                        .font(.headline)
                        .foregroundStyle(accent)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    switch p {
                    case .rest, .held:
                        RestTime(state: context.state)
                            .font(.title2.monospacedDigit())
                            .foregroundStyle(accent)
                            .frame(maxWidth: 80, alignment: .trailing)
                    case .training, .ready:
                        Elapsed(since: context.attributes.startedAt)
                            .font(.title3.monospacedDigit())
                            .foregroundStyle(accent)
                            .frame(maxWidth: 90, alignment: .trailing)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(detail(context.state, p))
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.75))
                            .lineLimit(1)
                        if p == .rest || p == .held { RestBar(state: context.state).tint(accent) }
                    }
                }
            } compactLeading: {
                Image(systemName: symbol(p)).foregroundStyle(accent)
            } compactTrailing: {
                switch p {
                case .rest, .held:
                    RestTime(state: context.state)
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .frame(maxWidth: 46)
                case .training:
                    Elapsed(since: context.attributes.startedAt)
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .frame(maxWidth: 52)
                case .ready:
                    Image(systemName: "checkmark").foregroundStyle(accent)
                }
            } minimal: {
                Image(systemName: symbol(p)).foregroundStyle(accent)
            }
        }
    }
}
