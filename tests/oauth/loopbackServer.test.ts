import { createOAuthCallbackReceiver } from "@main/oauth/loopbackServer";
import { describe, expect, it } from "vitest";

describe("createOAuthCallbackReceiver", () => {
  it("receives an authorization code when state matches", async () => {
    const receiver = await createOAuthCallbackReceiver("state", 1_000);
    expect(receiver.isOk()).toBe(true);
    const created = receiver._unsafeUnwrap();

    await fetch(`${created.redirectUri}?state=state&code=code`);
    const code = await created.waitForCode();

    expect(code._unsafeUnwrap()).toBe("code");
  });

  it("rejects callbacks with mismatched state", async () => {
    const receiver = await createOAuthCallbackReceiver("state", 1_000);
    expect(receiver.isOk()).toBe(true);
    const created = receiver._unsafeUnwrap();

    await fetch(`${created.redirectUri}?state=other&code=code`);
    const code = await created.waitForCode();

    expect(code._unsafeUnwrapErr().type).toBe("OAuthFailed");
  });
});
