import type { AppError } from "@shared/errors";
import { ResultAsync } from "neverthrow";
import { z } from "zod";
import { isHttpJsonFailure, requestJson } from "../http/requestJson";

export const GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";

const googleAuthorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";

const tokenResponseSchema = z
  .object({
    access_token: z.string(),
    expires_in: z.number(),
    refresh_token: z.string().optional(),
  })
  .passthrough();

export type TokenSet = {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
};

export type AuthorizationUrlInput = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

export type ExchangeCodeInput = {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
};

export type RefreshAccessTokenInput = {
  clientId: string;
  refreshToken: string;
};

export type OAuthClient = {
  buildAuthorizationUrl: (input: AuthorizationUrlInput) => URL;
  exchangeAuthorizationCode: (input: ExchangeCodeInput) => ResultAsync<TokenSet, AppError>;
  refreshAccessToken: (input: RefreshAccessTokenInput) => ResultAsync<TokenSet, AppError>;
};

type OAuthHttpFailure = {
  kind: "oauth-http-failure";
  status?: number;
  oauthError?: string;
  cause: unknown;
};

const isOAuthHttpFailure = (cause: unknown): cause is OAuthHttpFailure =>
  typeof cause === "object" &&
  cause !== null &&
  "kind" in cause &&
  cause.kind === "oauth-http-failure";

const oauthFailureMessage = (failure: OAuthHttpFailure): string => {
  if (typeof failure.cause === "string") return failure.cause;
  if (failure.oauthError !== undefined) return failure.oauthError;
  return "Token endpoint returned an invalid response";
};

const toOAuthFailed = (cause: unknown): AppError =>
  isOAuthHttpFailure(cause)
    ? { type: "OAuthFailed", cause: oauthFailureMessage(cause) }
    : { type: "OAuthFailed", cause };

const toTokenRefreshFailed = (cause: unknown): AppError =>
  isOAuthHttpFailure(cause)
    ? {
        type: "TokenRefreshFailed",
        cause: {
          status: cause.status,
          oauthError: cause.oauthError,
          message: oauthFailureMessage(cause),
        },
      }
    : { type: "TokenRefreshFailed", cause };

const tokenSetFromResponse = (value: unknown): TokenSet => {
  const parsed = tokenResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw {
      kind: "oauth-http-failure",
      cause: parsed.error.message,
    } satisfies OAuthHttpFailure;
  }

  return {
    accessToken: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
    refreshToken: parsed.data.refresh_token,
  };
};

const requestToken = async (body: URLSearchParams, fetchImpl: typeof fetch): Promise<TokenSet> => {
  try {
    return tokenSetFromResponse(
      await requestJson(fetchImpl, googleTokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }),
    );
  } catch (cause) {
    if (!isHttpJsonFailure(cause)) throw cause;

    const parsedError = z
      .object({
        error: z.string().optional(),
        error_description: z.string().optional(),
      })
      .passthrough()
      .safeParse(cause.body);

    throw {
      kind: "oauth-http-failure",
      status: cause.status,
      oauthError: parsedError.success ? parsedError.data.error : undefined,
      cause:
        parsedError.success && parsedError.data.error_description !== undefined
          ? parsedError.data.error_description
          : cause.body,
    } satisfies OAuthHttpFailure;
  }
};

export const createOAuthClient = (fetchImpl: typeof fetch = globalThis.fetch): OAuthClient => ({
  buildAuthorizationUrl: ({ clientId, redirectUri, state, codeChallenge }) => {
    const url = new URL(googleAuthorizationUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url;
  },
  exchangeAuthorizationCode: ({ clientId, code, codeVerifier, redirectUri }) =>
    ResultAsync.fromPromise(
      requestToken(
        new URLSearchParams({
          client_id: clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
        fetchImpl,
      ),
      toOAuthFailed,
    ),
  refreshAccessToken: ({ clientId, refreshToken }) =>
    ResultAsync.fromPromise(
      requestToken(
        new URLSearchParams({
          client_id: clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        fetchImpl,
      ),
      toTokenRefreshFailed,
    ),
});
