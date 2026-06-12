import { createOAuthCallbackReceiver } from "@main/oauth/loopbackServer";
import { appErrorMessage } from "@shared/errors";
import { describe, expect, it, vi } from "vitest";

const unwrapReceiver = async () => {
  const receiver = await createOAuthCallbackReceiver("state", 1_000);
  if (receiver.isErr()) {
    throw new Error(`Callback receiver failed: ${appErrorMessage(receiver.error)}`);
  }

  return receiver.value;
};

describe("createOAuthCallbackReceiver", () => {
  it("receives an authorization code when state matches", async () => {
    const created = await unwrapReceiver();

    await fetch(`${created.redirectUri}?state=state&code=code`);
    const code = await created.waitForCode();

    expect(code._unsafeUnwrap()).toBe("code");
  });

  it("returns 404 for unrelated callback paths", async () => {
    const created = await unwrapReceiver();

    const response = await fetch(created.redirectUri.replace("/oauth/callback", "/other"));
    created.close();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("rejects callbacks with missing codes and matching OAuth errors", async () => {
    const missingCode = await unwrapReceiver();
    await fetch(`${missingCode.redirectUri}?state=state`);
    expect((await missingCode.waitForCode())._unsafeUnwrapErr().type).toBe("OAuthFailed");

    const oauthError = await unwrapReceiver();
    await fetch(`${oauthError.redirectUri}?state=state&error=access_denied`);
    expect((await oauthError.waitForCode())._unsafeUnwrapErr().type).toBe("OAuthDenied");
  });

  it("rejects callbacks with mismatched state", async () => {
    const created = await unwrapReceiver();

    await fetch(`${created.redirectUri}?state=other&code=code`);
    const code = await created.waitForCode();

    expect(code._unsafeUnwrapErr().type).toBe("OAuthFailed");
  });

  it("times out while waiting for the callback", async () => {
    const receiver = await createOAuthCallbackReceiver("state", 5);
    if (receiver.isErr()) {
      throw new Error(`Callback receiver failed: ${appErrorMessage(receiver.error)}`);
    }

    const code = await receiver.value.waitForCode();

    expect(code._unsafeUnwrapErr()).toEqual({
      cause: "Timed out waiting for Google authorization.",
      type: "OAuthFailed",
    });
  });

  it("rejects error callbacks with mismatched state", async () => {
    const created = await unwrapReceiver();

    await fetch(`${created.redirectUri}?state=other&error=access_denied`);
    const code = await created.waitForCode();

    expect(code._unsafeUnwrapErr().type).toBe("OAuthFailed");
  });

  it("maps server listen errors to OAuth failures", async () => {
    vi.resetModules();
    const handlers = new Map<string, (cause: Error) => void>();
    vi.doMock("node:http", () => ({
      createServer: vi.fn(() => ({
        address: vi.fn(() => ({ port: 0 })),
        close: vi.fn(),
        listen: vi.fn(),
        listening: false,
        on: vi.fn((event: string, handler: (cause: Error) => void) => {
          handlers.set(event, handler);
        }),
      })),
      default: {
        createServer: vi.fn(() => ({
          address: vi.fn(() => ({ port: 0 })),
          close: vi.fn(),
          listen: vi.fn(),
          listening: false,
          on: vi.fn((event: string, handler: (cause: Error) => void) => {
            handlers.set(event, handler);
          }),
        })),
      },
    }));
    const { createOAuthCallbackReceiver: createReceiverWithMockedServer } = await import(
      "@main/oauth/loopbackServer"
    );

    const receiver = createReceiverWithMockedServer("state", 1_000);
    handlers.get("error")?.(new Error("listen failed"));
    const result = await receiver;
    const error = result._unsafeUnwrapErr();

    expect(error.type).toBe("OAuthFailed");
    if (error.type !== "OAuthFailed") throw new Error("expected OAuthFailed");
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toBe("listen failed");

    vi.doUnmock("node:http");
    vi.resetModules();
  });
});
