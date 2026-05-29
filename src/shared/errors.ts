export type AppError =
  | { type: "OAuthDenied"; cause?: unknown }
  | { type: "OAuthFailed"; cause: unknown }
  | { type: "TokenRefreshFailed"; cause: unknown }
  | { type: "CalendarApiFailed"; status?: number; cause: unknown }
  | { type: "MeetUrlNotFound"; eventId: string }
  | { type: "KeychainUnavailable"; cause: unknown }
  | { type: "DatabaseFailed"; cause: unknown }
  | { type: "PermissionDenied"; permission: "camera" | "microphone" | "screen"; cause?: unknown }
  | { type: "MainWindowFailed"; cause: unknown }
  | { type: "MeetWindowFailed"; cause: unknown }
  | { type: "UpdateFailed"; cause: unknown };

export type SerializedAppError = {
  type: AppError["type"];
  message: string;
  recoverable: boolean;
};

const recoverableByType = {
  OAuthDenied: true,
  OAuthFailed: true,
  TokenRefreshFailed: true,
  CalendarApiFailed: true,
  MeetUrlNotFound: false,
  KeychainUnavailable: true,
  DatabaseFailed: true,
  PermissionDenied: true,
  MainWindowFailed: true,
  MeetWindowFailed: true,
  UpdateFailed: true,
} satisfies Record<AppError["type"], boolean>;

export const unknownToMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return "Unknown error";
};

export const appErrorMessage = (error: AppError): string => {
  switch (error.type) {
    case "OAuthDenied":
      return "Google authorization was denied.";
    case "OAuthFailed":
      return `Google authorization failed: ${unknownToMessage(error.cause)}`;
    case "TokenRefreshFailed":
      return `Google token refresh failed: ${unknownToMessage(error.cause)}`;
    case "CalendarApiFailed":
      return `Google Calendar API failed: ${unknownToMessage(error.cause)}`;
    case "MeetUrlNotFound":
      return `No Google Meet URL was found for event ${error.eventId}.`;
    case "KeychainUnavailable":
      return `macOS Keychain is unavailable: ${unknownToMessage(error.cause)}`;
    case "DatabaseFailed":
      return `Local database operation failed: ${unknownToMessage(error.cause)}`;
    case "PermissionDenied":
      return `Permission denied for ${error.permission}.`;
    case "MainWindowFailed":
      return `NextRoom window failed: ${unknownToMessage(error.cause)}`;
    case "MeetWindowFailed":
      return `Google Meet window failed: ${unknownToMessage(error.cause)}`;
    case "UpdateFailed":
      return `App update failed: ${unknownToMessage(error.cause)}`;
  }
};

export const serializeAppError = (error: AppError): SerializedAppError => ({
  type: error.type,
  message: appErrorMessage(error),
  recoverable: recoverableByType[error.type],
});
