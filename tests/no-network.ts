/**
 * Loaded before every test file (see the "test" script): no test may reach
 * the network. Model calls are mocked per test; anything else that tries to
 * leave the machine throws, so a missing mock fails loudly instead of
 * quietly spending real credits.
 */
import http from "node:http";
import https from "node:https";

const LOCAL = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;

function refuse(target: string): never {
  throw new Error(`Unexpected outbound network call in a test: ${target}`);
}

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  return refuse(url.origin);
}) as typeof fetch;

for (const module of [http, https]) {
  const request = module.request;
  const guarded = ((...args: Parameters<typeof http.request>) => {
    const [first] = args;
    const host = typeof first === "string" || first instanceof URL ? new URL(first).hostname : (first?.hostname ?? first?.host ?? "localhost");
    if (!LOCAL.test(String(host).replace(/:\d+$/, ""))) refuse(String(host));
    return request(...(args as Parameters<typeof http.request>));
  }) as typeof http.request;
  module.request = guarded;
  module.get = ((...args: Parameters<typeof http.get>) => {
    const req = guarded(...(args as Parameters<typeof http.request>));
    req.end();
    return req;
  }) as typeof http.get;
}
