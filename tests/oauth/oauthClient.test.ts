import { createOAuthClient, GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from "@main/oauth/oauthClient";
import { describe, expect, it, vi } from "vitest";

describe("createOAuthClient", () => {
  it("builds a Google authorization URL with PKCE and offline access", () => {
    const client = createOAuthClient();
    const url = client.buildAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "http://127.0.0.1:1234/oauth/callback",
      state: "state",
      codeChallenge: "challenge",
    });

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1234/oauth/callback");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state");
  });

  it("exchanges an authorization code for tokens", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
            refresh_token: "refresh-token",
          }),
        ),
      ),
    );
    const client = createOAuthClient(fetchImpl);

    const result = await client.exchangeAuthorizationCode({
      clientId: "client-id",
      code: "code",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:1234/oauth/callback",
    });

    expect(result._unsafeUnwrap().accessToken).toBe("access-token");
    expect(result._unsafeUnwrap().refreshToken).toBe("refresh-token");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
