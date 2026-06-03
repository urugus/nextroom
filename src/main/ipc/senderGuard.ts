import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

type SenderGuardInput = {
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

const appRendererFilePathPattern = /\/renderer\/index\.html$/;

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
  { appRendererUrl, meetShellUrl }: SenderGuardInput,
): boolean => {
  if (value === meetShellUrl) return true;
  if (isTrustedDevRendererUrl(value, appRendererUrl)) return true;

  try {
    const url = new URL(value);
    return url.protocol === "file:" && appRendererFilePathPattern.test(url.pathname);
  } catch {
    return false;
  }
};

const isDataHtmlUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "data:" && url.pathname.toLowerCase().startsWith("text/html");
  } catch {
    return false;
  }
};

export const createIpcSenderGuard = (input: SenderGuardInput): IpcSenderGuard => {
  const trustedSenderIds = new Set<number>();
  const trustedDataShellSenderIds = new Set<number>();

  return {
    isTrustedEvent: (event) =>
      trustedSenderIds.has(event.sender.id) &&
      event.senderFrame !== null &&
      (isTrustedIpcSenderUrl(event.senderFrame.url, input) ||
        (trustedDataShellSenderIds.has(event.sender.id) && isDataHtmlUrl(event.senderFrame.url))),
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
