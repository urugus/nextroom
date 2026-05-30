export type HttpJsonFailure = {
  kind: "http-json-failure";
  status?: number;
  body: unknown;
};

export const isHttpJsonFailure = (cause: unknown): cause is HttpJsonFailure =>
  typeof cause === "object" &&
  cause !== null &&
  "kind" in cause &&
  cause.kind === "http-json-failure";

export const requestJson = async (
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<unknown> => {
  const response = await fetchImpl(input, init);
  const body = (await response.json().catch(() => undefined)) as unknown;

  if (!response.ok) {
    throw {
      kind: "http-json-failure",
      status: response.status,
      body,
    } satisfies HttpJsonFailure;
  }

  return body;
};
