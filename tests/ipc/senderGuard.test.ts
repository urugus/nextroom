import { createIpcSenderGuard, isTrustedIpcSenderUrl } from "@main/ipc/senderGuard";
import { describe, expect, it, vi } from "vitest";

const meetShellUrl = "data:text/html;charset=utf-8,%3C!doctype%20html%3E";
const noop = (): void => undefined;

describe("isTrustedIpcSenderUrl", () => {
  it("accepts the exact Meet shell data URL", () => {
    expect(isTrustedIpcSenderUrl(meetShellUrl, { meetShellUrl })).toBe(true);
  });

  it("accepts the configured dev renderer origin", () => {
    expect(
      isTrustedIpcSenderUrl("http://localhost:5173/settings", {
        appRendererUrl: "http://localhost:5173",
        meetShellUrl,
      }),
    ).toBe(true);
  });

  it("accepts packaged renderer index files", () => {
    expect(
      isTrustedIpcSenderUrl(
        "file:///Applications/NextRoom.app/Contents/Resources/out/renderer/index.html",
        {
          meetShellUrl,
        },
      ),
    ).toBe(true);
  });

  it("rejects remote and arbitrary data URLs", () => {
    expect(isTrustedIpcSenderUrl("https://meet.google.com/abc-defg-hij", { meetShellUrl })).toBe(
      false,
    );
    expect(isTrustedIpcSenderUrl("data:text/html,evil", { meetShellUrl })).toBe(false);
  });
});

describe("createIpcSenderGuard", () => {
  it("requires both a trusted webContents id and a trusted frame URL", () => {
    let closedHandler = noop;
    const window = {
      on: vi.fn((_event: "closed", handler: () => void) => {
        closedHandler = handler;
        return window;
      }),
      webContents: { id: 42 },
    };
    const guard = createIpcSenderGuard({ meetShellUrl });

    guard.trustWindow(window as unknown as Parameters<typeof guard.trustWindow>[0], {
      dataShell: true,
    });

    expect(
      guard.isTrustedEvent({
        sender: { id: 42 },
        senderFrame: { url: meetShellUrl },
      } as unknown as Parameters<typeof guard.isTrustedEvent>[0]),
    ).toBe(true);
    expect(
      guard.isTrustedEvent({
        sender: { id: 42 },
        senderFrame: { url: "data:text/html,%3C!doctype%20html%3E" },
      } as unknown as Parameters<typeof guard.isTrustedEvent>[0]),
    ).toBe(true);
    expect(
      guard.isTrustedEvent({
        sender: { id: 42 },
        senderFrame: { url: "https://evil.example" },
      } as unknown as Parameters<typeof guard.isTrustedEvent>[0]),
    ).toBe(false);
    expect(
      guard.isTrustedEvent({
        sender: { id: 7 },
        senderFrame: { url: meetShellUrl },
      } as unknown as Parameters<typeof guard.isTrustedEvent>[0]),
    ).toBe(false);

    closedHandler();

    expect(
      guard.isTrustedEvent({
        sender: { id: 42 },
        senderFrame: { url: meetShellUrl },
      } as unknown as Parameters<typeof guard.isTrustedEvent>[0]),
    ).toBe(false);
  });
});
