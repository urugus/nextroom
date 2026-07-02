import type { MeetEvent } from "@shared/types";

export const isMeetingActive = (meeting: MeetEvent, now: Date): boolean => {
  const startAt = new Date(meeting.startAt).getTime();
  const endAt = new Date(meeting.endAt).getTime();
  const nowTime = now.getTime();

  return (
    Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= nowTime && nowTime <= endAt
  );
};
