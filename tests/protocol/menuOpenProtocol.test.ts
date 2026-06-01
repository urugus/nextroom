import {
  createMenuOpenRequestQueue,
  findMenuOpenProtocolUrl,
  isMenuOpenProtocolUrl,
  nextRoomMenuUrl,
  protocolClientRegistrationOptions,
} from "@main/protocol/menuOpenProtocol";
import { describe, expect, it, vi } from "vitest";

describe("isMenuOpenProtocolUrl", () => {
  it("accepts the NextRoom menu URL", () => {
    expect(isMenuOpenProtocolUrl(nextRoomMenuUrl)).toBe(true);
    expect(isMenuOpenProtocolUrl("nextroom://menu/")).toBe(true);
  });

  it("rejects unrelated URLs", () => {
    expect(isMenuOpenProtocolUrl("nextroom://settings")).toBe(false);
    expect(isMenuOpenProtocolUrl("https://nextroom.local/menu")).toBe(false);
    expect(isMenuOpenProtocolUrl("not a url")).toBe(false);
  });
});

describe("protocolClientRegistrationOptions", () => {
  it("uses the default packaged app registration", () => {
    expect(
      protocolClientRegistrationOptions({
        argv: ["/Applications/NextRoom.app/Contents/MacOS/NextRoom"],
        execPath: "/Applications/NextRoom.app/Contents/MacOS/NextRoom",
      }),
    ).toEqual({ args: [] });
  });

  it("uses the Electron executable and app entrypoint in default-app development mode", () => {
    expect(
      protocolClientRegistrationOptions({
        argv: ["/path/to/electron", "/path/to/out/main/index.js"],
        defaultApp: true,
        execPath: "/path/to/electron",
      }),
    ).toEqual({
      args: ["/path/to/out/main/index.js"],
      executable: "/path/to/electron",
    });
  });
});

describe("findMenuOpenProtocolUrl", () => {
  it("finds a menu URL in process arguments", () => {
    expect(findMenuOpenProtocolUrl(["NextRoom", "--", nextRoomMenuUrl])).toBe(nextRoomMenuUrl);
  });

  it("returns undefined when process arguments do not request the menu", () => {
    expect(findMenuOpenProtocolUrl(["NextRoom", "nextroom://settings"])).toBeUndefined();
  });
});

describe("createMenuOpenRequestQueue", () => {
  it("opens immediately when the menu is ready", () => {
    const tryOpenMenu = vi.fn(() => true);
    const queue = createMenuOpenRequestQueue({ tryOpenMenu });

    queue.requestOpen();

    expect(tryOpenMenu).toHaveBeenCalledTimes(1);
    expect(queue.hasPendingRequest()).toBe(false);
  });

  it("keeps one pending request until the menu can open", () => {
    let ready = false;
    const tryOpenMenu = vi.fn(() => ready);
    const queue = createMenuOpenRequestQueue({ tryOpenMenu });

    queue.requestOpen();
    queue.requestOpen();

    expect(queue.hasPendingRequest()).toBe(true);
    expect(tryOpenMenu).toHaveBeenCalledTimes(2);

    ready = true;
    queue.drain();

    expect(queue.hasPendingRequest()).toBe(false);
    expect(tryOpenMenu).toHaveBeenCalledTimes(3);
  });
});
