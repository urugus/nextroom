import { createKeychainTokenStore, type KeychainLike } from "@main/adapters/keychainTokenStore";
import { describe, expect, it, vi } from "vitest";

const noopResolve = <T>(_value: T): void => undefined;
const noopReject = (_cause: unknown): void => undefined;

const deferred = <T>() => {
  let resolve: (value: T) => void = noopResolve;
  let reject: (cause: unknown) => void = noopReject;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
};

describe("createKeychainTokenStore", () => {
  it("maps keychain rejections into KeychainUnavailable", async () => {
    const keychain: KeychainLike = {
      getPassword: () => Promise.reject(new Error("locked")),
      setPassword: () => Promise.resolve(),
      deletePassword: () => Promise.resolve(true),
    };
    const store = createKeychainTokenStore(keychain);
    const result = await store.getRefreshToken();

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("KeychainUnavailable");
  });

  it("stores and reads refresh tokens through the injected keychain", async () => {
    let stored: string | null = null;
    const keychain: KeychainLike = {
      getPassword: () => Promise.resolve(stored),
      setPassword: (_service, _account, password) => {
        stored = password;
        return Promise.resolve();
      },
      deletePassword: () => {
        stored = null;
        return Promise.resolve(true);
      },
    };
    const store = createKeychainTokenStore(keychain);

    expect((await store.setRefreshToken("refresh-token")).isOk()).toBe(true);
    expect((await store.getRefreshToken())._unsafeUnwrap()).toBe("refresh-token");
    expect((await store.clearRefreshToken())._unsafeUnwrap()).toBe(true);
    expect((await store.getRefreshToken())._unsafeUnwrap()).toBeNull();
  });

  it("shares concurrent refresh token reads through a single keychain request", async () => {
    const read = deferred<string | null>();
    const getPassword = vi.fn(() => read.promise);
    const keychain: KeychainLike = {
      getPassword,
      setPassword: () => Promise.resolve(),
      deletePassword: () => Promise.resolve(true),
    };
    const store = createKeychainTokenStore(keychain);

    const first = store.getRefreshToken();
    const second = store.getRefreshToken();

    expect(getPassword).toHaveBeenCalledTimes(1);
    read.resolve("refresh-token");
    expect((await first)._unsafeUnwrap()).toBe("refresh-token");
    expect((await second)._unsafeUnwrap()).toBe("refresh-token");
  });

  it("shares a concurrent keychain failure across refresh token readers", async () => {
    const read = deferred<string | null>();
    const getPassword = vi.fn(() => read.promise);
    const keychain: KeychainLike = {
      getPassword,
      setPassword: () => Promise.resolve(),
      deletePassword: () => Promise.resolve(true),
    };
    const store = createKeychainTokenStore(keychain);

    const first = store.getRefreshToken();
    const second = store.getRefreshToken();

    expect(getPassword).toHaveBeenCalledTimes(1);
    read.reject(new Error("locked"));
    expect((await first)._unsafeUnwrapErr().type).toBe("KeychainUnavailable");
    expect((await second)._unsafeUnwrapErr().type).toBe("KeychainUnavailable");
  });

  it("retries refresh token reads after a keychain failure", async () => {
    const getPassword = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValueOnce("refresh-token");
    const keychain: KeychainLike = {
      getPassword,
      setPassword: () => Promise.resolve(),
      deletePassword: () => Promise.resolve(true),
    };
    const store = createKeychainTokenStore(keychain);

    expect((await store.getRefreshToken())._unsafeUnwrapErr().type).toBe("KeychainUnavailable");
    expect((await store.getRefreshToken())._unsafeUnwrap()).toBe("refresh-token");
    expect(getPassword).toHaveBeenCalledTimes(2);
  });

  it("does not cache refresh token reads after a successful keychain request", async () => {
    const getPassword = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("first-token")
      .mockResolvedValueOnce("second-token");
    const keychain: KeychainLike = {
      getPassword,
      setPassword: () => Promise.resolve(),
      deletePassword: () => Promise.resolve(true),
    };
    const store = createKeychainTokenStore(keychain);

    expect((await store.getRefreshToken())._unsafeUnwrap()).toBe("first-token");
    expect((await store.getRefreshToken())._unsafeUnwrap()).toBe("second-token");
    expect(getPassword).toHaveBeenCalledTimes(2);
  });

  it("does not share a stale pending read after clearing the refresh token", async () => {
    const staleRead = deferred<string | null>();
    const freshRead = deferred<string | null>();
    const getPassword = vi
      .fn<() => Promise<string | null>>()
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValueOnce(freshRead.promise);
    const keychain: KeychainLike = {
      getPassword,
      setPassword: () => Promise.resolve(),
      deletePassword: () => Promise.resolve(true),
    };
    const store = createKeychainTokenStore(keychain);

    const staleResult = store.getRefreshToken();
    expect(getPassword).toHaveBeenCalledTimes(1);
    expect((await store.clearRefreshToken())._unsafeUnwrap()).toBe(true);

    const freshResult = store.getRefreshToken();
    expect(getPassword).toHaveBeenCalledTimes(2);
    staleRead.resolve("stale-token");
    freshRead.resolve(null);

    expect((await staleResult)._unsafeUnwrap()).toBe("stale-token");
    expect((await freshResult)._unsafeUnwrap()).toBeNull();
  });
});
