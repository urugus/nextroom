import type { TokenStore } from "@main/adapters/keychainTokenStore";
import type { AppError } from "@shared/errors";
import { err, ok, type Result } from "neverthrow";
import { createOAuthCallbackReceiver } from "./loopbackServer";
import type { OAuthClient, TokenSet } from "./oauthClient";
import { createOauthState, createPkcePair } from "./pkce";

export type GoogleAuthService = {
  connect: () => Promise<Result<void, AppError>>;
  disconnect: () => Promise<Result<void, AppError>>;
  getAccessToken: () => Promise<Result<string | null, AppError>>;
  isConnected: () => Promise<Result<boolean, AppError>>;
};

type AccessTokenCache = {
  accessToken: string;
  expiresAt: number;
};

type GoogleAuthServiceInput = {
  clientId: string | undefined;
  clientSecret?: string;
  tokenStore: TokenStore;
  oauthClient: OAuthClient;
  openExternal: (url: string) => Promise<boolean | undefined>;
  now?: () => number;
};

const isUsableAccessToken = (
  cachedAccessToken: AccessTokenCache | undefined,
  now: () => number,
): cachedAccessToken is AccessTokenCache =>
  cachedAccessToken !== undefined && cachedAccessToken.expiresAt - now() > 60_000;

const tokenRefreshShouldClearStoredToken = (error: AppError): boolean => {
  if (error.type !== "TokenRefreshFailed") return false;
  const cause = error.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "oauthError" in cause &&
    cause.oauthError === "invalid_grant"
  );
};

const cacheAccessToken = (tokenSet: TokenSet): AccessTokenCache => ({
  accessToken: tokenSet.accessToken,
  expiresAt: tokenSet.expiresAt,
});

export const createGoogleAuthService = ({
  clientId,
  clientSecret,
  tokenStore,
  oauthClient,
  openExternal,
  now = () => Date.now(),
}: GoogleAuthServiceInput): GoogleAuthService => {
  let cachedAccessToken: AccessTokenCache | undefined;

  return {
    connect: async () => {
      if (clientId === undefined || clientId.length === 0) {
        return err({ type: "OAuthFailed", cause: "NEXTROOM_GOOGLE_CLIENT_ID is not configured." });
      }

      const state = createOauthState();
      const pkce = createPkcePair();
      const receiver = await createOAuthCallbackReceiver(state);
      if (receiver.isErr()) return err(receiver.error);

      try {
        const authorizationUrl = oauthClient.buildAuthorizationUrl({
          clientId,
          redirectUri: receiver.value.redirectUri,
          state,
          codeChallenge: pkce.codeChallenge,
        });
        let opened: boolean | undefined;
        try {
          opened = await openExternal(authorizationUrl.toString());
        } catch (cause) {
          return err({ type: "OAuthFailed", cause });
        }
        if (opened === false) {
          return err({ type: "OAuthFailed", cause: "Could not open system browser." });
        }

        const code = await receiver.value.waitForCode();
        if (code.isErr()) return err(code.error);

        const tokenSet = await oauthClient.exchangeAuthorizationCode({
          clientId,
          clientSecret,
          code: code.value,
          codeVerifier: pkce.codeVerifier,
          redirectUri: receiver.value.redirectUri,
        });
        if (tokenSet.isErr()) return err(tokenSet.error);
        if (tokenSet.value.refreshToken === undefined) {
          return err({ type: "OAuthFailed", cause: "Google did not return a refresh token." });
        }

        const stored = await tokenStore.setRefreshToken(tokenSet.value.refreshToken);
        if (stored.isErr()) return err(stored.error);

        cachedAccessToken = cacheAccessToken(tokenSet.value);
        return ok(undefined);
      } finally {
        receiver.value.close();
      }
    },
    disconnect: async () => {
      cachedAccessToken = undefined;
      const cleared = await tokenStore.clearRefreshToken();
      if (cleared.isErr()) return err(cleared.error);
      return ok(undefined);
    },
    getAccessToken: async () => {
      if (isUsableAccessToken(cachedAccessToken, now)) {
        return ok(cachedAccessToken.accessToken);
      }

      if (clientId === undefined || clientId.length === 0) {
        return err({ type: "OAuthFailed", cause: "NEXTROOM_GOOGLE_CLIENT_ID is not configured." });
      }

      const refreshToken = await tokenStore.getRefreshToken();
      if (refreshToken.isErr()) return err(refreshToken.error);
      if (refreshToken.value === null) return ok(null);

      const refreshed = await oauthClient.refreshAccessToken({
        clientId,
        clientSecret,
        refreshToken: refreshToken.value,
      });
      if (refreshed.isErr()) {
        cachedAccessToken = undefined;
        if (tokenRefreshShouldClearStoredToken(refreshed.error)) {
          await tokenStore.clearRefreshToken();
        }
        return err(refreshed.error);
      }

      cachedAccessToken = cacheAccessToken(refreshed.value);
      return ok(cachedAccessToken.accessToken);
    },
    isConnected: async () => {
      const refreshToken = await tokenStore.getRefreshToken();
      if (refreshToken.isErr()) return err(refreshToken.error);
      return ok(refreshToken.value !== null);
    },
  };
};
