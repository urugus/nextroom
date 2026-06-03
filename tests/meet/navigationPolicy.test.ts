import { configureMeetNavigationPolicy, decideMeetNavigation } from "@main/meet/navigationPolicy";
import { describe, expect, it, vi } from "vitest";

type NavigationHandler = (event: { preventDefault: () => void }, url: string) => void;
type WindowOpenHandler = (details: { url: string }) => { action: "allow" | "deny" };

const createFakeWebContents = () => {
  const handlers = new Map<string, NavigationHandler>();
  let windowOpenHandler: WindowOpenHandler | undefined;

  const webContents = {
    loadURL: vi.fn(() => Promise.resolve()),
    on: vi.fn((event: string, handler: NavigationHandler) => {
      handlers.set(event, handler);
      return webContents;
    }),
    setWindowOpenHandler: vi.fn((handler: WindowOpenHandler) => {
      windowOpenHandler = handler;
    }),
  };

  return {
    fireNavigation: (eventName: string, url: string) => {
      const event = { preventDefault: vi.fn() };
      handlers.get(eventName)?.(event, url);
      return event;
    },
    openWindow: (url: string) => {
      if (windowOpenHandler === undefined) {
        throw new Error("Window open handler was not configured.");
      }

      return windowOpenHandler({ url });
    },
    webContents,
  };
};

describe("decideMeetNavigation", () => {
  it("allows Meet and Google auth origins", () => {
    expect(decideMeetNavigation("https://meet.google.com/abc-defg-hij")).toEqual({
      action: "allow",
    });
    expect(decideMeetNavigation("https://accounts.google.com/signin")).toEqual({
      action: "allow",
    });
  });

  it("opens other https URLs and external protocols outside the app", () => {
    expect(decideMeetNavigation("https://example.com/login")).toEqual({
      action: "openExternal",
      url: "https://example.com/login",
    });
    expect(decideMeetNavigation("mailto:support@example.com")).toEqual({
      action: "openExternal",
      url: "mailto:support@example.com",
    });
  });

  it("blocks file, http, and invalid URLs", () => {
    expect(decideMeetNavigation("file:///Users/tester/.ssh/id_rsa")).toEqual({ action: "block" });
    expect(decideMeetNavigation("http://meet.google.com/abc-defg-hij")).toEqual({
      action: "block",
    });
    expect(decideMeetNavigation("not a url")).toEqual({ action: "block" });
  });
});

describe("configureMeetNavigationPolicy", () => {
  it("routes allowed popup URLs to the managed popup opener", () => {
    const fake = createFakeWebContents();
    const openAllowedPopup = vi.fn(() => Promise.resolve());
    const openExternal = vi.fn(() => Promise.resolve());

    configureMeetNavigationPolicy({
      openAllowedPopup,
      openExternal,
      webContents: fake.webContents as unknown as Parameters<
        typeof configureMeetNavigationPolicy
      >[0]["webContents"],
    });

    const result = fake.openWindow("https://accounts.google.com/signin");

    expect(result).toEqual({ action: "deny" });
    expect(fake.webContents.loadURL).not.toHaveBeenCalled();
    expect(openAllowedPopup).toHaveBeenCalledWith("https://accounts.google.com/signin");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("routes disallowed https navigation to the external browser", () => {
    const fake = createFakeWebContents();
    const openExternal = vi.fn(() => Promise.resolve());

    configureMeetNavigationPolicy({
      openAllowedPopup: vi.fn(() => Promise.resolve()),
      openExternal,
      webContents: fake.webContents as unknown as Parameters<
        typeof configureMeetNavigationPolicy
      >[0]["webContents"],
    });

    const event = fake.fireNavigation("will-navigate", "https://example.com/login");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/login");
  });

  it("blocks unsafe navigation without opening an external handler", () => {
    const fake = createFakeWebContents();
    const openExternal = vi.fn(() => Promise.resolve());

    configureMeetNavigationPolicy({
      openAllowedPopup: vi.fn(() => Promise.resolve()),
      openExternal,
      webContents: fake.webContents as unknown as Parameters<
        typeof configureMeetNavigationPolicy
      >[0]["webContents"],
    });

    const event = fake.fireNavigation("will-redirect", "file:///Users/tester/.ssh/id_rsa");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
