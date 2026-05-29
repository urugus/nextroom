import type { AppUpdateStatus, MeetEvent } from "@shared/types";
import { useEffect, useRef, useState } from "react";
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
  const [updateErrorMessage, setUpdateErrorMessage] = useState<string | undefined>(undefined);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | undefined>(undefined);
  const openingMeetingRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const loadUpdateStatus = async () => {
      try {
        const result = await window.meetLauncher.getUpdateStatus();
        if (!mounted) return;

        if (result.ok) {
          setUpdateStatus(result.value);
        } else {
          setUpdateErrorMessage(result.error.message);
        }
      } catch (cause) {
        if (!mounted) return;
        const message = cause instanceof Error ? cause.message : "Update status is unavailable.";
        setUpdateErrorMessage(message);
      }
    };

    void loadUpdateStatus();

    const unsubscribe = window.meetLauncher.onUpdateStatusChanged((status) => {
      setUpdateStatus(status);
      if (status.status !== "error") {
        setUpdateErrorMessage(undefined);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const openMeeting = async (meetUrl: string) => {
    if (openingMeetingRef.current) return;

    openingMeetingRef.current = true;
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
      openingMeetingRef.current = false;
      setOpeningMeetUrl(undefined);
    }
  };

  const runUpdateAction = async (
    action: () => Promise<
      { ok: true; value: AppUpdateStatus } | { ok: false; error: { message: string } }
    >,
  ) => {
    setUpdateErrorMessage(undefined);

    try {
      const result = await action();
      if (result.ok) {
        setUpdateStatus(result.value);
      } else {
        setUpdateErrorMessage(result.error.message);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "App update failed.";
      setUpdateErrorMessage(message);
    }
  };

  const checkForUpdates = () => runUpdateAction(window.meetLauncher.checkForUpdates);
  const downloadUpdate = () => runUpdateAction(window.meetLauncher.downloadUpdate);

  const installUpdate = async () => {
    setUpdateErrorMessage(undefined);

    try {
      const result = await window.meetLauncher.installUpdate();
      if (!result.ok) {
        setUpdateErrorMessage(result.error.message);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "App update failed.";
      setUpdateErrorMessage(message);
    }
  };

  return (
    <Dashboard
      accountConnected={false}
      errorMessage={errorMessage}
      meetings={sampleMeetings}
      openingMeetUrl={openingMeetUrl}
      onOpenMeeting={openMeeting}
      onCheckForUpdates={checkForUpdates}
      onDownloadUpdate={downloadUpdate}
      onInstallUpdate={installUpdate}
      updateErrorMessage={updateErrorMessage}
      updateStatus={updateStatus}
    />
  );
};
