// Thilos Fork: Countdown der Satzpause auf dem Sperrbildschirm und in der Dynamic Island.
// Text(timerInterval:) und ProgressView(timerInterval:) zählen selbst herunter, die App muss
// dafür nicht laufen. Nach dem Ende (staleDate) steht „Nächster Satz“ da.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RestWidgetBundle: WidgetBundle {
    var body: some Widget { RestLiveActivity() }
}

private let accent = Color(red: 1.0, green: 0.62, blue: 0.04)

private func clock(_ sec: Int) -> String { String(format: "%d:%02d", sec / 60, sec % 60) }

struct RestTime: View {
    let state: RestActivityAttributes.ContentState
    var body: some View {
        if let left = state.pausedLeft {
            Text(clock(left))
        } else {
            Text(timerInterval: state.endsAt.addingTimeInterval(-Double(max(1, state.totalSec)))...state.endsAt, countsDown: true)
        }
    }
}

struct RestBar: View {
    let state: RestActivityAttributes.ContentState
    var body: some View {
        if let left = state.pausedLeft {
            ProgressView(value: Double(left), total: Double(max(1, state.totalSec)))
        } else {
            ProgressView(timerInterval: state.endsAt.addingTimeInterval(-Double(max(1, state.totalSec)))...state.endsAt, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
        }
    }
}

struct RestLockView: View {
    let state: RestActivityAttributes.ContentState
    let stale: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(stale ? state.doneTitle : state.title)
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text(state.pausedLeft != nil ? "Angehalten" : "openGym")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
                Spacer()
                if stale {
                    Image(systemName: "figure.strengthtraining.traditional")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(accent)
                } else {
                    RestTime(state: state)
                        .font(.system(size: 40, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 130, alignment: .trailing)
                }
            }
            if !stale { RestBar(state: state).tint(accent) }
        }
        .padding(16)
    }
}

struct RestLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestActivityAttributes.self) { context in
            RestLockView(state: context.state, stale: context.isStale)
                .activityBackgroundTint(Color.black.opacity(0.82))
                .activitySystemActionForegroundColor(accent)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.isStale ? context.state.doneTitle : context.state.title, systemImage: "timer")
                        .font(.headline)
                        .foregroundStyle(accent)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if !context.isStale {
                        RestTime(state: context.state)
                            .font(.title2.monospacedDigit())
                            .foregroundStyle(accent)
                            .frame(maxWidth: 80, alignment: .trailing)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !context.isStale { RestBar(state: context.state).tint(accent) }
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(accent)
            } compactTrailing: {
                if context.isStale {
                    Image(systemName: "checkmark").foregroundStyle(accent)
                } else {
                    RestTime(state: context.state)
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .frame(maxWidth: 46)
                }
            } minimal: {
                Image(systemName: "timer").foregroundStyle(accent)
            }
        }
    }
}
