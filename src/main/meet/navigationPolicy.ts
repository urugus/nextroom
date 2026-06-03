import type { WebContents } from "electron";

type NavigationEvent = {
  preventDefault: () => void;
};

type NavigationWebContents = Pick<WebContents, "on" | "setWindowOpenHandler">;

type NavigationPolicyInput = {
  openAllowedPopup: (url: string) => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  webContents: NavigationWebContents;
};

type NavigationDecision =
  | { action: "allow" }
  | { action: "block" }
  | { action: "openExternal"; url: string };

const allowedNavigationHosts = new Set([
  "accounts.google.com",
  "apis.google.com",
  "clients6.google.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "meet.google.com",
  "ogs.google.com",
  "ssl.gstatic.com",
  "www.gstatic.com",
]);

const externalProtocolAllowlist = new Set(["mailto:", "tel:"]);

export const decideMeetNavigation = (value: string): NavigationDecision => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { action: "block" };
  }

  if (url.protocol === "https:") {
    return allowedNavigationHosts.has(url.hostname)
      ? { action: "allow" }
      : { action: "openExternal", url: url.toString() };
  }

  if (externalProtocolAllowlist.has(url.protocol)) {
    return { action: "openExternal", url: url.toString() };
  }

  return { action: "block" };
};

const applyNavigationDecision = (
  event: NavigationEvent,
  url: string,
  openExternal: (url: string) => Promise<unknown>,
): void => {
  const decision = decideMeetNavigation(url);
  if (decision.action === "allow") return;

  event.preventDefault();
  if (decision.action === "openExternal") {
    void openExternal(decision.url);
  }
};

export const configureMeetNavigationPolicy = ({
  openAllowedPopup,
  openExternal,
  webContents,
}: NavigationPolicyInput): void => {
  webContents.on("will-navigate", (event, url) => {
    applyNavigationDecision(event, url, openExternal);
  });

  webContents.on("will-redirect", (event, url) => {
    applyNavigationDecision(event, url, openExternal);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideMeetNavigation(url);
    if (decision.action === "allow") {
      void openAllowedPopup(url);
    } else if (decision.action === "openExternal") {
      void openExternal(decision.url);
    }

    return { action: "deny" };
  });
};
