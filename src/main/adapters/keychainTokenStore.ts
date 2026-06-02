import type { AppError } from "@shared/errors";
import { ResultAsync } from "neverthrow";

export type KeychainLike = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
};

export type TokenStore = {
  getRefreshToken: () => ResultAsync<string | null, AppError>;
  setRefreshToken: (refreshToken: string) => ResultAsync<void, AppError>;
  clearRefreshToken: () => ResultAsync<boolean, AppError>;
};

const toKeychainError = (cause: unknown): AppError => ({ type: "KeychainUnavailable", cause });

export const createKeychainTokenStore = (
  keychain: KeychainLike,
  service = "nextroom",
  account = "google-refresh-token",
): TokenStore => {
  let inFlightRefreshTokenRead: Promise<string | null> | undefined;
  let inFlightRefreshTokenMutation: Promise<void> | undefined;

  const trackRefreshTokenMutation = <T>(request: Promise<T>): Promise<T> => {
    inFlightRefreshTokenRead = undefined;
    let mutation: Promise<void>;
    mutation = request
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (inFlightRefreshTokenMutation === mutation) {
          inFlightRefreshTokenMutation = undefined;
        }
      });
    inFlightRefreshTokenMutation = mutation;

    return request;
  };

  const readRefreshToken = async (): Promise<string | null> => {
    if (inFlightRefreshTokenMutation !== undefined) {
      await inFlightRefreshTokenMutation;
    }
    if (inFlightRefreshTokenRead !== undefined) return inFlightRefreshTokenRead;

    const request = keychain.getPassword(service, account).finally(() => {
      if (inFlightRefreshTokenRead === request) {
        inFlightRefreshTokenRead = undefined;
      }
    });
    inFlightRefreshTokenRead = request;

    return request;
  };

  return {
    getRefreshToken: () => ResultAsync.fromPromise(readRefreshToken(), toKeychainError),
    setRefreshToken: (refreshToken) =>
      ResultAsync.fromPromise(
        trackRefreshTokenMutation(
          Promise.resolve().then(() => keychain.setPassword(service, account, refreshToken)),
        ),
        toKeychainError,
      ),
    clearRefreshToken: () =>
      ResultAsync.fromPromise(
        trackRefreshTokenMutation(
          Promise.resolve().then(() => keychain.deletePassword(service, account)),
        ),
        toKeychainError,
      ),
  };
};
