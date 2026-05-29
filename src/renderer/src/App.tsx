import type { MeetEvent } from "@shared/types";
import { useState } from "react";
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

export const App = () => {
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [openingMeetUrl, setOpeningMeetUrl] = useState<string | undefined>(undefined);

  const openMeeting = async (meetUrl: string) => {
    setErrorMessage(undefined);
    setOpeningMeetUrl(meetUrl);

    try {
      const result = await window.meetLauncher.openMeetUrl(meetUrl);
      if (!result.ok) {
        setErrorMessage(result.error.message);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Google Meet window failed.";
      setErrorMessage(message);
    } finally {
      setOpeningMeetUrl(undefined);
    }
  };

  return (
    <Dashboard
      accountConnected={false}
      errorMessage={errorMessage}
      meetings={sampleMeetings}
      openingMeetUrl={openingMeetUrl}
      onOpenMeeting={openMeeting}
    />
  );
};
