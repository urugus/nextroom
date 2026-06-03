import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

type SenderGuardInput = {
  appRendererFileUrl?: string;
  appRendererUrl?: string;
  meetShellUrl: string;
};

export type IpcSenderGuard = {
  isTrustedEvent: (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) => boolean;
  trustWindow: (
    window: Pick<BrowserWindow, "on" | "webContents">,
    options?: { dataShell?: boolean },
  ) => void;
};

const isTrustedDevRendererUrl = (value: string, appRendererUrl: string | undefined): boolean => {
  if (appRendererUrl === undefined) return false;

  try {
    return new URL(value).origin === new URL(appRendererUrl).origin;
  } catch {
    return false;
  }
};

export const isTrustedIpcSenderUrl = (
  value: string,
  { appRendererFileUrl, appRendererUrl, meetShellUrl }: SenderGuardInput,
): boolean => {
  if (value === meetShellUrl) return true;
  if (isTrustedDevRendererUrl(value, appRendererUrl)) return true;

  return appRendererFileUrl !== undefined && value === appRendererFileUrl;
};

const dataUrlPayload = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol !== "data:") return undefined;

    const commaIndex = url.pathname.indexOf(",");
    if (commaIndex === -1) return undefined;

    return decodeURIComponent(url.pathname.slice(commaIndex + 1));
  } catch {
    return undefined;
  }
};

const isTrustedMeetShellDataUrl = (value: string, meetShellUrl: string): boolean =>
  dataUrlPayload(value) === dataUrlPayload(meetShellUrl);

export const createIpcSenderGuard = (input: SenderGuardInput): IpcSenderGuard => {
  const trustedSenderIds = new Set<number>();
  const trustedDataShellSenderIds = new Set<number>();

  return {
    isTrustedEvent: (event) =>
      trustedSenderIds.has(event.sender.id) &&
      event.senderFrame !== null &&
      (isTrustedIpcSenderUrl(event.senderFrame.url, input) ||
        (trustedDataShellSenderIds.has(event.sender.id) &&
          isTrustedMeetShellDataUrl(event.senderFrame.url, input.meetShellUrl))),
    trustWindow: (window, options) => {
      const senderId = window.webContents.id;
      trustedSenderIds.add(senderId);
      if (options?.dataShell === true) {
        trustedDataShellSenderIds.add(senderId);
      }
      window.on("closed", () => {
        trustedSenderIds.delete(senderId);
        trustedDataShellSenderIds.delete(senderId);
      });
    },
  };
};
