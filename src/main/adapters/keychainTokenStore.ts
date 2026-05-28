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
): TokenStore => ({
  getRefreshToken: () =>
    ResultAsync.fromPromise(keychain.getPassword(service, account), toKeychainError),
  setRefreshToken: (refreshToken) =>
    ResultAsync.fromPromise(keychain.setPassword(service, account, refreshToken), toKeychainError),
  clearRefreshToken: () =>
    ResultAsync.fromPromise(keychain.deletePassword(service, account), toKeychainError),
});
