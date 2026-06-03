import type { TokenStore } from "@main/adapters/keychainTokenStore";
import { createGoogleAuthService } from "@main/oauth/googleAuthService";
import type { OAuthCallbackReceiver } from "@main/oauth/loopbackServer";
import type { OAuthClient, TokenSet } from "@main/oauth/oauthClient";
import type { AppError } from "@shared/errors";
import { err, errAsync, ok, okAsync, type Result } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const refreshedTokenSet: TokenSet = {
  accessToken: "access-token",
  expiresAt: 120_000,
};

const tokenSetWithRefreshToken: TokenSet = {
  ...refreshedTokenSet,
  refreshToken: "refresh-token",
};

const createTokenStoreMock = (overrides: Partial<TokenStore> = {}) => ({
  getRefreshToken: vi.fn(() => okAsync<string | null, AppError>(null)),
  setRefreshToken: vi.fn(() => okAsync<void, AppError>(undefined)),
  clearRefreshToken: vi.fn(() => okAsync<boolean, AppError>(true)),
  ...overrides,
});

const createOAuthClientMock = (overrides: Partial<OAuthClient> = {}) => ({
  buildAuthorizationUrl: vi.fn(() => new URL("https://accounts.google.com/o/oauth2/v2/auth")),
  exchangeAuthorizationCode: vi.fn(() => okAsync<TokenSet, AppError>(tokenSetWithRefreshToken)),
  refreshAccessToken: vi.fn(() => okAsync<TokenSet, AppError>(refreshedTokenSet)),
  ...overrides,
});

const createReceiverMock = (
  waitForCode: () => Promise<Result<string, AppError>> = vi.fn(() =>
    Promise.resolve(ok<string, AppError>("authorization-code")),
  ),
) => {
  const receiver: OAuthCallbackReceiver = {
    close: vi.fn(),
    redirectUri: "http://127.0.0.1:1234/oauth/callback",
    waitForCode,
  };

  return {
    createCallbackReceiver: vi.fn(() => okAsync<OAuthCallbackReceiver, AppError>(receiver)),
    receiver,
  };
};

describe("createGoogleAuthService", () => {
  it("returns a cached access token without reading the token store again", async () => {
    let now = 0;
    const tokenStore = createTokenStoreMock({
      getRefreshToken: vi.fn(() => okAsync<string | null, AppError>("refresh-token")),
    });
    const oauthClient = createOAuthClientMock();
    const service = createGoogleAuthService({
      clientId: "client-id",
      oauthClient,
      openExternal: vi.fn(),
      tokenStore,
      now: () => now,
    });

    const first = await service.getAccessToken();
    now = 10_000;
    const second = await service.getAccessToken();

    expect(first._unsafeUnwrap()).toBe("access-token");
    expect(second._unsafeUnwrap()).toBe("access-token");
    expect(tokenStore.getRefreshToken).toHaveBeenCalledTimes(1);
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("returns null when no refresh token is stored", async () => {
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock();
    const service = createGoogleAuthService({
      clientId: "client-id",
      oauthClient,
      openExternal: vi.fn(),
      tokenStore,
    });

    const result = await service.getAccessToken();

    expect(result._unsafeUnwrap()).toBeNull();
    expect(oauthClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("clears the stored refresh token when Google reports invalid_grant", async () => {
    const refreshError: AppError = {
      type: "TokenRefreshFailed",
      cause: { oauthError: "invalid_grant" },
    };
    const tokenStore = createTokenStoreMock({
      getRefreshToken: vi.fn(() => okAsync<string | null, AppError>("refresh-token")),
    });
    const oauthClient = createOAuthClientMock({
      refreshAccessToken: vi.fn(() => errAsync<TokenSet, AppError>(refreshError)),
    });
    const service = createGoogleAuthService({
      clientId: "client-id",
      oauthClient,
      openExternal: vi.fn(),
      tokenStore,
    });

    const result = await service.getAccessToken();

    expect(result._unsafeUnwrapErr()).toBe(refreshError);
    expect(tokenStore.clearRefreshToken).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh error when invalid_grant cleanup fails", async () => {
    const refreshError: AppError = {
      type: "TokenRefreshFailed",
      cause: { oauthError: "invalid_grant" },
    };
    const tokenStore = createTokenStoreMock({
      clearRefreshToken: vi.fn(() =>
        errAsync<boolean, AppError>({ type: "KeychainUnavailable", cause: "delete failed" }),
      ),
      getRefreshToken: vi.fn(() => okAsync<string | null, AppError>("refresh-token")),
    });
    const oauthClient = createOAuthClientMock({
      refreshAccessToken: vi.fn(() => errAsync<TokenSet, AppError>(refreshError)),
    });
    const service = createGoogleAuthService({
      clientId: "client-id",
      oauthClient,
      openExternal: vi.fn(),
      tokenStore,
    });

    const result = await service.getAccessToken();

    expect(result._unsafeUnwrapErr()).toBe(refreshError);
    expect(tokenStore.clearRefreshToken).toHaveBeenCalledTimes(1);
  });

  it("stores the refresh token and closes the receiver after a successful connection", async () => {
    const { createCallbackReceiver, receiver } = createReceiverMock();
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock();
    const service = createGoogleAuthService({
      clientId: "client-id",
      createCallbackReceiver,
      oauthClient,
      openExternal: vi.fn(() => Promise.resolve(true)),
      tokenStore,
    });

    const result = await service.connect();

    expect(result.isOk()).toBe(true);
    expect(tokenStore.setRefreshToken).toHaveBeenCalledWith("refresh-token");
    expect(receiver.close).toHaveBeenCalledTimes(1);
  });

  it("converts browser open failures to OAuth errors and closes the receiver", async () => {
    const { createCallbackReceiver, receiver } = createReceiverMock();
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock();
    const service = createGoogleAuthService({
      clientId: "client-id",
      createCallbackReceiver,
      oauthClient,
      openExternal: vi.fn(() => Promise.reject(new Error("browser failed"))),
      tokenStore,
    });

    const result = await service.connect();

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "OAuthFailed" });
    expect(oauthClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(receiver.close).toHaveBeenCalledTimes(1);
  });

  it("converts synchronous browser open failures to OAuth errors", async () => {
    const { createCallbackReceiver, receiver } = createReceiverMock();
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock();
    const service = createGoogleAuthService({
      clientId: "client-id",
      createCallbackReceiver,
      oauthClient,
      openExternal: vi.fn(() => {
        throw new Error("browser failed");
      }),
      tokenStore,
    });

    const result = await service.connect();

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "OAuthFailed" });
    expect(oauthClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(receiver.close).toHaveBeenCalledTimes(1);
  });

  it("closes the receiver when Google does not return a refresh token", async () => {
    const { createCallbackReceiver, receiver } = createReceiverMock();
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock({
      exchangeAuthorizationCode: vi.fn(() => okAsync<TokenSet, AppError>(refreshedTokenSet)),
    });
    const service = createGoogleAuthService({
      clientId: "client-id",
      createCallbackReceiver,
      oauthClient,
      openExternal: vi.fn(() => Promise.resolve(true)),
      tokenStore,
    });

    const result = await service.connect();

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "OAuthFailed" });
    expect(tokenStore.setRefreshToken).not.toHaveBeenCalled();
    expect(receiver.close).toHaveBeenCalledTimes(1);
  });

  it("closes the receiver when the callback returns an error", async () => {
    const { createCallbackReceiver, receiver } = createReceiverMock(
      vi.fn(() =>
        Promise.resolve(err<string, AppError>({ type: "OAuthDenied", cause: "access_denied" })),
      ),
    );
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock();
    const service = createGoogleAuthService({
      clientId: "client-id",
      createCallbackReceiver,
      oauthClient,
      openExternal: vi.fn(() => Promise.resolve(true)),
      tokenStore,
    });

    const result = await service.connect();

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "OAuthDenied" });
    expect(oauthClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(receiver.close).toHaveBeenCalledTimes(1);
  });
});
