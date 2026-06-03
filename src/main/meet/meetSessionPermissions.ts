import type { Session } from "electron";

export const meetSessionPartition = "persist:meet";

type MeetPermissionSession = Pick<
  Session,
  "setPermissionCheckHandler" | "setPermissionRequestHandler"
>;
type PermissionCheckHandler = NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>;
type PermissionRequestHandler = NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>;
type PermissionCheckDetails = Parameters<PermissionCheckHandler>[3];
type PermissionRequestDetails = Parameters<PermissionRequestHandler>[3];

const allowedMeetPermissions = new Set<string>(["display-capture", "media", "notifications"]);

export const isMeetOrigin = (value: string | null | undefined): boolean => {
  if (value === null || value === undefined || value.length === 0) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "meet.google.com";
  } catch {
    return false;
  }
};

export const isAllowedMeetPermission = (permission: string): boolean =>
  allowedMeetPermissions.has(permission);

const isAllowedMeetPermissionRequest = (
  _webContents: Parameters<PermissionRequestHandler>[0],
  permission: string,
  details: PermissionRequestDetails,
): boolean =>
  isAllowedMeetPermission(permission) &&
  ["securityOrigin" in details ? details.securityOrigin : undefined, details.requestingUrl].some(
    isMeetOrigin,
  );

const isAllowedMeetPermissionCheck = (
  _webContents: Parameters<PermissionCheckHandler>[0],
  permission: string,
  requestingOrigin: string,
  details: PermissionCheckDetails,
): boolean =>
  isAllowedMeetPermission(permission) &&
  [requestingOrigin, details.securityOrigin, details.requestingUrl].some(isMeetOrigin);

export const configureMeetSessionPermissions = (meetSession: MeetPermissionSession): void => {
  meetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    isAllowedMeetPermissionCheck(webContents, permission, requestingOrigin, details),
  );

  meetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isAllowedMeetPermissionRequest(webContents, permission, details));
  });
};
