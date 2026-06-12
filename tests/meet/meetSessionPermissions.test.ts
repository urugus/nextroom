import { configureMeetSessionPermissions, isMeetOrigin } from "@main/meet/meetSessionPermissions";
import type { Session, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

type MeetPermissionSession = Pick<
  Session,
  "setPermissionCheckHandler" | "setPermissionRequestHandler"
>;
type PermissionCheckHandler = Exclude<Parameters<Session["setPermissionCheckHandler"]>[0], null>;
type PermissionRequestHandler = Exclude<
  Parameters<Session["setPermissionRequestHandler"]>[0],
  null
>;
type PermissionCheckDetails = Parameters<PermissionCheckHandler>[3];
type PermissionRequestDetails = Parameters<PermissionRequestHandler>[3];

const createSessionMock = () => {
  const setPermissionCheckHandler = vi.fn<MeetPermissionSession["setPermissionCheckHandler"]>();
  const setPermissionRequestHandler = vi.fn<MeetPermissionSession["setPermissionRequestHandler"]>();
  const session: MeetPermissionSession = {
    setPermissionCheckHandler,
    setPermissionRequestHandler,
  };

  return { session, setPermissionCheckHandler, setPermissionRequestHandler };
};

const configuredCheckHandler = (
  setPermissionCheckHandler: ReturnType<
    typeof vi.fn<MeetPermissionSession["setPermissionCheckHandler"]>
  >,
): PermissionCheckHandler => {
  const handler = setPermissionCheckHandler.mock.calls[0]?.[0];

  if (handler === undefined || handler === null) {
    throw new Error("Permission check handler was not configured.");
  }

  return handler;
};

const configuredRequestHandler = (
  setPermissionRequestHandler: ReturnType<
    typeof vi.fn<MeetPermissionSession["setPermissionRequestHandler"]>
  >,
): PermissionRequestHandler => {
  const handler = setPermissionRequestHandler.mock.calls[0]?.[0];

  if (handler === undefined || handler === null) {
    throw new Error("Permission request handler was not configured.");
  }

  return handler;
};

const checkDetails = (details: Partial<PermissionCheckDetails>): PermissionCheckDetails => ({
  isMainFrame: true,
  ...details,
});

const requestDetails = (details: PermissionRequestDetails): PermissionRequestDetails => details;

describe("isMeetOrigin", () => {
  it("returns false for empty origin values", () => {
    expect(isMeetOrigin(null)).toBe(false);
    expect(isMeetOrigin(undefined)).toBe(false);
    expect(isMeetOrigin("")).toBe(false);
  });

  it("returns false for invalid or spoofed Meet origins", () => {
    expect(isMeetOrigin("://not-a-url")).toBe(false);
    expect(isMeetOrigin("https://sub.meet.google.com")).toBe(false);
    expect(isMeetOrigin("https://meet.google.com.evil.com")).toBe(false);
  });
});

describe("configureMeetSessionPermissions", () => {
  it("allows permission checks when only the security origin is Meet", () => {
    const { session, setPermissionCheckHandler } = createSessionMock();
    configureMeetSessionPermissions(session);
    const handler = configuredCheckHandler(setPermissionCheckHandler);

    expect(
      handler(
        null,
        "media",
        "https://accounts.google.com",
        checkDetails({
          securityOrigin: "https://meet.google.com",
          requestingUrl: "https://accounts.google.com",
        }),
      ),
    ).toBe(true);
  });

  it("allows permission checks when only the requesting URL is Meet", () => {
    const { session, setPermissionCheckHandler } = createSessionMock();
    configureMeetSessionPermissions(session);
    const handler = configuredCheckHandler(setPermissionCheckHandler);

    expect(
      handler(
        null,
        "notifications",
        "https://accounts.google.com",
        checkDetails({
          securityOrigin: "https://accounts.google.com",
          requestingUrl: "https://meet.google.com/abc-defg-hij",
        }),
      ),
    ).toBe(true);
  });

  it("rejects permission checks when all origins are outside Meet", () => {
    const { session, setPermissionCheckHandler } = createSessionMock();
    configureMeetSessionPermissions(session);
    const handler = configuredCheckHandler(setPermissionCheckHandler);

    expect(
      handler(
        null,
        "media",
        "https://accounts.google.com",
        checkDetails({
          securityOrigin: "https://calendar.google.com",
          requestingUrl: "https://accounts.google.com",
        }),
      ),
    ).toBe(false);
  });

  it("rejects permission requests without a Meet security origin or requesting URL", () => {
    const { session, setPermissionRequestHandler } = createSessionMock();
    configureMeetSessionPermissions(session);
    const handler = configuredRequestHandler(setPermissionRequestHandler);
    let granted = true;

    handler(
      {} as WebContents,
      "media",
      (permissionGranted) => {
        granted = permissionGranted;
      },
      requestDetails({
        isMainFrame: true,
        requestingUrl: "https://accounts.google.com",
      }),
    );

    expect(granted).toBe(false);
  });
});
