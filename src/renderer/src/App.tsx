import type { MeetEvent } from "@shared/types";
import { Dashboard } from "./screens/Dashboard";
import "./styles.css";

const sampleMeetings: MeetEvent[] = [
  {
    eventId: "event-1",
    occurrenceKey: "primary:event-1:2026-05-28T10:00:00+09:00",
    calendarId: "primary",
    summary: "Product sync",
    startAt: "2026-05-28T10:00:00+09:00",
    endAt: "2026-05-28T10:30:00+09:00",
    updatedAt: "2026-05-28T09:00:00+09:00",
    meetUrl: "https://meet.google.com/abc-defg-hij",
    meetCode: "abc-defg-hij",
    responseStatus: "accepted",
    status: "confirmed",
  },
];

export const App = () => (
  <Dashboard accountConnected={false} errorMessage={undefined} meetings={sampleMeetings} />
);
