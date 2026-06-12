import { createHash } from "node:crypto";
import { createOauthState, createPkcePair } from "@main/oauth/pkce";
import { describe, expect, it } from "vitest";

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

describe("createPkcePair", () => {
  it("creates an RFC 7636 length code verifier using base64url characters", () => {
    const { codeVerifier } = createPkcePair();

    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(base64UrlPattern);
  });

  it("creates a SHA-256 code challenge from the verifier", () => {
    const { codeChallenge, codeVerifier } = createPkcePair();
    const expectedChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    expect(codeChallenge).toBe(expectedChallenge);
    expect(codeChallenge).toHaveLength(43);
    expect(codeChallenge).toMatch(base64UrlPattern);
  });

  it("smoke-tests verifier uniqueness across two calls", () => {
    const first = createPkcePair();
    const second = createPkcePair();

    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});

describe("createOauthState", () => {
  it("creates a base64url state value", () => {
    const state = createOauthState();

    expect(state).toHaveLength(43);
    expect(state).toMatch(base64UrlPattern);
  });

  it("smoke-tests state uniqueness across two calls", () => {
    const first = createOauthState();
    const second = createOauthState();

    expect(first).not.toBe(second);
  });
});
