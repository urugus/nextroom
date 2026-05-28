import type { MeetEvent } from "@shared/types";

type DashboardProps = {
  accountConnected: boolean;
  errorMessage?: string;
  meetings: MeetEvent[];
};

const formatMeetingTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const Dashboard = ({ accountConnected, errorMessage, meetings }: DashboardProps) => (
  <main className="app-shell">
    <section className="toolbar" aria-label="Account status">
      <div>
        <h1>NextRoom</h1>
        <p>{accountConnected ? "Google Calendar connected" : "Google Calendar not connected"}</p>
      </div>
      <button type="button">{accountConnected ? "Sync" : "Connect"}</button>
    </section>

    {errorMessage !== undefined ? <p className="error-banner">{errorMessage}</p> : null}

    <section className="meeting-panel" aria-labelledby="upcoming-title">
      <h2 id="upcoming-title">Upcoming Meet meetings</h2>
      {meetings.length === 0 ? (
        <p className="empty-state">No upcoming Google Meet meetings.</p>
      ) : (
        <ul className="meeting-list">
          {meetings.map((meeting) => (
            <li key={meeting.occurrenceKey} className="meeting-row">
              <div>
                <strong>{meeting.summary}</strong>
                <span>
                  {formatMeetingTime(meeting.startAt)} - {formatMeetingTime(meeting.endAt)}
                </span>
              </div>
              <a href={meeting.meetUrl}>Join</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  </main>
);
