import { createKeychainTokenStore, type KeychainLike } from "@main/adapters/keychainTokenStore";
import { describe, expect, it } from "vitest";

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
});
