import { createHash, randomBytes } from "node:crypto";

const randomBase64Url = (bytes: number): string => randomBytes(bytes).toString("base64url");

export type PkcePair = {
  codeVerifier: string;
  codeChallenge: string;
};

export const createPkcePair = (): PkcePair => {
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return { codeVerifier, codeChallenge };
};

export const createOauthState = (): string => randomBase64Url(32);
