import { createOAuthClient, GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from "@main/oauth/oauthClient";
import { appErrorMessage } from "@shared/errors";
import { describe, expect, it, vi } from "vitest";

const requestBody = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): URLSearchParams => {
  const init = fetchImpl.mock.calls[0]?.[1];
  expect(init).toBeDefined();
  expect(init?.body).toBeInstanceOf(URLSearchParams);
  return init?.body as URLSearchParams;
};

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
    expect(requestBody(fetchImpl).get("client_secret")).toBeNull();
  });

  it("includes an optional client secret when exchanging tokens", async () => {
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
      clientSecret: "client-secret",
      code: "code",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:1234/oauth/callback",
    });

    expect(result.isOk()).toBe(true);
    expect(requestBody(fetchImpl).get("client_secret")).toBe("client-secret");
  });

  it("includes an optional client secret when refreshing tokens", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
          }),
        ),
      ),
    );
    const client = createOAuthClient(fetchImpl);

    const result = await client.refreshAccessToken({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
    });

    expect(result.isOk()).toBe(true);
    expect(requestBody(fetchImpl).get("client_secret")).toBe("client-secret");
  });

  it("keeps refresh token failure messages user-visible", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
          { status: 400 },
        ),
      ),
    );
    const client = createOAuthClient(fetchImpl);

    const result = await client.refreshAccessToken({
      clientId: "client-id",
      refreshToken: "refresh-token",
    });

    expect(appErrorMessage(result._unsafeUnwrapErr())).toBe(
      "Google token refresh failed: Token has been expired or revoked.",
    );
  });
});
