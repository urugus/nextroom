export type NavigationAction =
  | { type: "allow" }
  | { type: "block" }
  | { type: "openExternal"; url: string };

export type WindowOpenAction = { type: "block" } | { type: "openExternal"; url: string };

const internalNavigationHosts = new Set([
  "accounts.google.com",
  "accounts.gstatic.com",
  "meet.google.com",
  "ssl.gstatic.com",
  "www.gstatic.com",
]);

const externalProtocols = new Set(["mailto:", "tel:"]);

const parseUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

export const meetNavigationActionFor = (value: string): NavigationAction => {
  const url = parseUrl(value);
  if (url === undefined) return { type: "block" };

  if (url.protocol === "https:" && internalNavigationHosts.has(url.hostname)) {
    return { type: "allow" };
  }

  if (url.protocol === "https:" || externalProtocols.has(url.protocol)) {
    return { type: "openExternal", url: url.toString() };
  }

  return { type: "block" };
};

export const meetWindowOpenActionFor = (value: string): WindowOpenAction => {
  const url = parseUrl(value);
  if (url === undefined) return { type: "block" };

  if (url.protocol === "https:" || externalProtocols.has(url.protocol)) {
    return { type: "openExternal", url: url.toString() };
  }

  return { type: "block" };
};
