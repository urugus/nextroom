import type { TokenStore } from "@main/adapters/keychainTokenStore";
import type { AppError } from "@shared/errors";
import { err, ok, type Result, ResultAsync } from "neverthrow";
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
  createCallbackReceiver?: typeof createOAuthCallbackReceiver;
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

const oauthFailed = (cause: unknown): AppError => ({ type: "OAuthFailed", cause });

const missingClientIdError = (): AppError =>
  oauthFailed("NEXTROOM_GOOGLE_CLIENT_ID is not configured.");

const flattenResultPromise = <T>(request: Promise<Result<T, AppError>>): ResultAsync<T, AppError> =>
  ResultAsync.fromPromise(request, oauthFailed).andThen((result) => result);

export const createGoogleAuthService = ({
  clientId,
  clientSecret,
  tokenStore,
  oauthClient,
  openExternal,
  createCallbackReceiver = createOAuthCallbackReceiver,
  now = () => Date.now(),
}: GoogleAuthServiceInput): GoogleAuthService => {
  let cachedAccessToken: AccessTokenCache | undefined;

  return {
    connect: async () => {
      if (clientId === undefined || clientId.length === 0) {
        return err(missingClientIdError());
      }

      const state = createOauthState();
      const pkce = createPkcePair();
      const receiver = await createCallbackReceiver(state);
      if (receiver.isErr()) return err(receiver.error);

      try {
        const authorizationUrl = oauthClient.buildAuthorizationUrl({
          clientId,
          redirectUri: receiver.value.redirectUri,
          state,
          codeChallenge: pkce.codeChallenge,
        });

        return await ResultAsync.fromThrowable(
          openExternal,
          oauthFailed,
        )(authorizationUrl.toString())
          .andThen((opened) =>
            opened === false ? err(oauthFailed("Could not open system browser.")) : ok(undefined),
          )
          .andThen(() => flattenResultPromise(receiver.value.waitForCode()))
          .andThen((code) =>
            oauthClient.exchangeAuthorizationCode({
              clientId,
              clientSecret,
              code,
              codeVerifier: pkce.codeVerifier,
              redirectUri: receiver.value.redirectUri,
            }),
          )
          .andThen((tokenSet) =>
            tokenSet.refreshToken === undefined
              ? err(oauthFailed("Google did not return a refresh token."))
              : tokenStore.setRefreshToken(tokenSet.refreshToken).map(() => tokenSet),
          )
          .map((tokenSet) => {
            cachedAccessToken = cacheAccessToken(tokenSet);
            return undefined;
          });
      } finally {
        receiver.value.close();
      }
    },
    disconnect: async () => {
      cachedAccessToken = undefined;
      return await tokenStore.clearRefreshToken().map(() => undefined);
    },
    getAccessToken: async () => {
      if (isUsableAccessToken(cachedAccessToken, now)) {
        return ok(cachedAccessToken.accessToken);
      }

      if (clientId === undefined || clientId.length === 0) {
        return err(missingClientIdError());
      }

      return await tokenStore.getRefreshToken().andThen((refreshToken) => {
        if (refreshToken === null) return ok(null);

        return oauthClient
          .refreshAccessToken({
            clientId,
            clientSecret,
            refreshToken,
          })
          .map((tokenSet) => {
            cachedAccessToken = cacheAccessToken(tokenSet);
            return cachedAccessToken.accessToken;
          })
          .orElse((error) => {
            cachedAccessToken = undefined;
            if (tokenRefreshShouldClearStoredToken(error)) {
              return ResultAsync.fromSafePromise(
                tokenStore.clearRefreshToken().match(
                  () => undefined,
                  () => undefined,
                ),
              ).andThen(() => err(error));
            }
            return err(error);
          });
      });
    },
    isConnected: async () => {
      return await tokenStore.getRefreshToken().map((refreshToken) => refreshToken !== null);
    },
  };
};
