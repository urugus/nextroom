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
  it("rejects connect and refresh when the client id is missing", async () => {
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock();
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    const service = createGoogleAuthService({
      clientId: "",
      logger,
      oauthClient,
      openExternal: vi.fn(),
      tokenStore,
    });

    expect((await service.connect())._unsafeUnwrapErr()).toEqual({
      cause: "NEXTROOM_GOOGLE_CLIENT_ID is not configured.",
      type: "OAuthFailed",
    });
    expect((await service.getAccessToken())._unsafeUnwrapErr()).toEqual({
      cause: "NEXTROOM_GOOGLE_CLIENT_ID is not configured.",
      type: "OAuthFailed",
    });
    expect(logger.error).toHaveBeenCalledWith("connect failed", {
      error: {
        cause: "NEXTROOM_GOOGLE_CLIENT_ID is not configured.",
        type: "OAuthFailed",
      },
    });
  });

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

  it("uses Date.now by default when checking the cached access token", async () => {
    const tokenStore = createTokenStoreMock({
      getRefreshToken: vi.fn(() => okAsync<string | null, AppError>("refresh-token")),
    });
    const oauthClient = createOAuthClientMock({
      refreshAccessToken: vi.fn(() =>
        okAsync<TokenSet, AppError>({
          accessToken: "default-clock-token",
          expiresAt: Date.now() + 120_000,
        }),
      ),
    });
    const service = createGoogleAuthService({
      clientId: "client-id",
      oauthClient,
      openExternal: vi.fn(),
      tokenStore,
    });

    expect((await service.getAccessToken())._unsafeUnwrap()).toBe("default-clock-token");
    expect((await service.getAccessToken())._unsafeUnwrap()).toBe("default-clock-token");
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

  it("refreshes again when a cached access token is near expiry", async () => {
    let now = 0;
    const tokenStore = createTokenStoreMock({
      getRefreshToken: vi.fn(() => okAsync<string | null, AppError>("refresh-token")),
    });
    const oauthClient = createOAuthClientMock({
      refreshAccessToken: vi
        .fn()
        .mockReturnValueOnce(
          okAsync<TokenSet, AppError>({ accessToken: "first", expiresAt: 61_001 }),
        )
        .mockReturnValueOnce(
          okAsync<TokenSet, AppError>({ accessToken: "second", expiresAt: 180_000 }),
        ),
    });
    const service = createGoogleAuthService({
      clientId: "client-id",
      oauthClient,
      openExternal: vi.fn(),
      tokenStore,
      now: () => now,
    });

    expect((await service.getAccessToken())._unsafeUnwrap()).toBe("first");
    now = 2_000;
    expect((await service.getAccessToken())._unsafeUnwrap()).toBe("second");
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledTimes(2);
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

  it("does not clear stored tokens for refresh failures other than invalid_grant", async () => {
    const refreshError: AppError = {
      type: "TokenRefreshFailed",
      cause: { oauthError: "temporarily_unavailable" },
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
    expect(tokenStore.clearRefreshToken).not.toHaveBeenCalled();
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

  it("returns a receiver creation error before opening the browser", async () => {
    const receiverError: AppError = { type: "OAuthFailed", cause: "listen failed" };
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock();
    const openExternal = vi.fn();
    const service = createGoogleAuthService({
      clientId: "client-id",
      createCallbackReceiver: vi.fn(() => errAsync<OAuthCallbackReceiver, AppError>(receiverError)),
      oauthClient,
      openExternal,
      tokenStore,
    });

    const result = await service.connect();

    expect(result._unsafeUnwrapErr()).toBe(receiverError);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("converts browser cancellation to an OAuth error and closes the receiver", async () => {
    const { createCallbackReceiver, receiver } = createReceiverMock();
    const tokenStore = createTokenStoreMock();
    const oauthClient = createOAuthClientMock();
    const service = createGoogleAuthService({
      clientId: "client-id",
      createCallbackReceiver,
      oauthClient,
      openExternal: vi.fn(() => Promise.resolve(false)),
      tokenStore,
    });

    const result = await service.connect();

    expect(result._unsafeUnwrapErr()).toEqual({
      cause: "Could not open system browser.",
      type: "OAuthFailed",
    });
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

  it("closes the receiver when storing the refresh token fails", async () => {
    const { createCallbackReceiver, receiver } = createReceiverMock();
    const tokenStore = createTokenStoreMock({
      setRefreshToken: vi.fn(() =>
        errAsync<void, AppError>({ type: "KeychainUnavailable", cause: "write failed" }),
      ),
    });
    const oauthClient = createOAuthClientMock();
    const service = createGoogleAuthService({
      clientId: "client-id",
      createCallbackReceiver,
      oauthClient,
      openExternal: vi.fn(() => Promise.resolve(true)),
      tokenStore,
    });

    const result = await service.connect();

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "KeychainUnavailable" });
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

  it("disconnects and reports connection status through the token store", async () => {
    const tokenStore = createTokenStoreMock({
      getRefreshToken: vi
        .fn()
        .mockReturnValueOnce(okAsync<string | null, AppError>("refresh-token"))
        .mockReturnValueOnce(
          errAsync<string | null, AppError>({ type: "KeychainUnavailable", cause: "read failed" }),
        ),
    });
    const service = createGoogleAuthService({
      clientId: "client-id",
      oauthClient: createOAuthClientMock(),
      openExternal: vi.fn(),
      tokenStore,
    });

    expect((await service.isConnected())._unsafeUnwrap()).toBe(true);
    expect((await service.isConnected())._unsafeUnwrapErr()).toMatchObject({
      type: "KeychainUnavailable",
    });
    expect((await service.disconnect()).isOk()).toBe(true);
    expect(tokenStore.clearRefreshToken).toHaveBeenCalledTimes(1);
  });
});
