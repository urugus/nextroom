import {
  type AppError,
  appErrorMessage,
  serializeAppError,
  unknownToMessage,
} from "@shared/errors";
import { describe, expect, it } from "vitest";

describe("unknownToMessage", () => {
  it("uses messages from supported cause shapes", () => {
    expect(unknownToMessage(new Error("boom"))).toBe("boom");
    expect(unknownToMessage("plain failure")).toBe("plain failure");
    expect(unknownToMessage({ message: "object failure" })).toBe("object failure");
  });

  it("falls back when no message can be extracted", () => {
    expect(unknownToMessage({ message: 123 })).toBe("Unknown error");
    expect(unknownToMessage(null)).toBe("Unknown error");
  });
});

describe("appErrorMessage", () => {
  const cases: Array<{
    error: AppError;
    message: string;
    recoverable: boolean;
  }> = [
    {
      error: { type: "OAuthDenied" },
      message: "Google authorization was denied.",
      recoverable: true,
    },
    {
      error: { type: "OAuthFailed", cause: "popup closed" },
      message: "Google authorization failed: popup closed",
      recoverable: true,
    },
    {
      error: { type: "TokenRefreshFailed", cause: new Error("invalid grant") },
      message: "Google token refresh failed: invalid grant",
      recoverable: true,
    },
    {
      error: { type: "CalendarApiFailed", status: 503, cause: { message: "unavailable" } },
      message: "Google Calendar API failed: unavailable",
      recoverable: true,
    },
    {
      error: { type: "MeetUrlNotFound", eventId: "event-1" },
      message: "No Google Meet URL was found for event event-1.",
      recoverable: false,
    },
    {
      error: { type: "KeychainUnavailable", cause: "locked" },
      message: "macOS Keychain is unavailable: locked",
      recoverable: true,
    },
    {
      error: { type: "DatabaseFailed", cause: "disk full" },
      message: "Local database operation failed: disk full",
      recoverable: true,
    },
    {
      error: { type: "PermissionDenied", permission: "camera" },
      message: "Permission denied for camera.",
      recoverable: true,
    },
    {
      error: { type: "IpcSenderRejected" },
      message: "Security check rejected an IPC request.",
      recoverable: false,
    },
    {
      error: { type: "MainWindowFailed", cause: "destroyed" },
      message: "NextRoom window failed: destroyed",
      recoverable: true,
    },
    {
      error: { type: "MeetWindowFailed", cause: "blocked" },
      message: "Google Meet window failed: blocked",
      recoverable: true,
    },
    {
      error: {
        type: "ShortcutRegistrationFailed",
        accelerator: "Command+Alt+N",
        cause: "already taken",
      },
      message: "Menu shortcut Command+Alt+N could not be registered: already taken",
      recoverable: true,
    },
    {
      error: { type: "UpdateFailed", cause: "network" },
      message: "App update failed: network",
      recoverable: true,
    },
  ];

  it.each(cases)("formats and serializes $error.type", ({ error, message, recoverable }) => {
    expect(appErrorMessage(error)).toBe(message);
    expect(serializeAppError(error)).toEqual({
      type: error.type,
      message,
      recoverable,
    });
  });
});
