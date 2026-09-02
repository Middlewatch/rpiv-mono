import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { configPath } from "@juicesharp/rpiv-config";
import { createMockCtx, createMockPi, stubFetch } from "@juicesharp/rpiv-test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import registerWebTools from "./index.js";
import { DEFAULT_REQUEST_TIMEOUT_SECONDS, resolveRequestTimeoutSeconds } from "./web-tools.js";

const CONFIG_PATH = configPath("rpiv-web-tools");

function writeConfig(contents: unknown) {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(contents), "utf-8");
}

function registerAndCapture() {
	const { pi, captured } = createMockPi();
	registerWebTools(pi);
	return captured;
}

// A provider that never answers: the response settles only when the request's
// own signal aborts, the way a real socket to a dead endpoint behaves.
function stubHangingFetch() {
	return stubFetch([
		{
			match: () => true,
			response: (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;
					if (!signal) return;
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
		},
	]);
}

const runSearch = (signal?: AbortSignal) =>
	registerAndCapture()
		.tools.get("web_search")
		?.execute?.("tc", { query: "hello", max_results: 3 }, signal as never, undefined as never, createMockCtx());

const runFetch = (signal?: AbortSignal) =>
	registerAndCapture()
		.tools.get("web_fetch")
		?.execute?.("tc", { url: "https://example.com/page" }, signal as never, undefined as never, createMockCtx());

beforeEach(() => {
	process.env.BRAVE_SEARCH_API_KEY = "k";
	rmSync(CONFIG_PATH, { force: true });
});

describe("request deadline", () => {
	it("web_search gives up on a provider that never answers", async () => {
		writeConfig({ provider: "brave", requestTimeoutSeconds: 0.05 });
		stubHangingFetch();
		const started = Date.now();
		await expect(runSearch()).rejects.toThrow(
			/Brave search did not answer within 0\.05s \(requestTimeoutSeconds in /,
		);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it("web_fetch gives up on a page that never answers", async () => {
		writeConfig({ provider: "brave", requestTimeoutSeconds: 0.05 });
		stubHangingFetch();
		await expect(runFetch()).rejects.toThrow(/Fetching https:\/\/example\.com\/page did not answer within 0\.05s/);
	});

	it("a host abort is reported as the abort, not as the deadline", async () => {
		writeConfig({ provider: "brave", requestTimeoutSeconds: 5 });
		stubHangingFetch();
		const host = new AbortController();
		const pending = runSearch(host.signal);
		host.abort(new Error("user interrupted"));
		await expect(pending).rejects.toThrow("user interrupted");
	});

	it("hands the provider a signal that carries the deadline", async () => {
		writeConfig({ provider: "brave" });
		const stub = stubFetch([
			{
				match: () => true,
				response: () => new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }),
			},
		]);
		await runSearch();
		expect(stub.calls[0]?.signal).toBeInstanceOf(AbortSignal);
	});
});

describe("resolveRequestTimeoutSeconds", () => {
	it("defaults to 30 s", () => {
		expect(DEFAULT_REQUEST_TIMEOUT_SECONDS).toBe(30);
		expect(resolveRequestTimeoutSeconds({})).toBe(30);
	});

	it("takes a positive configured value and falls back on anything else", () => {
		expect(resolveRequestTimeoutSeconds({ requestTimeoutSeconds: 7 })).toBe(7);
		expect(resolveRequestTimeoutSeconds({ requestTimeoutSeconds: 0 })).toBe(30);
		expect(resolveRequestTimeoutSeconds({ requestTimeoutSeconds: -1 })).toBe(30);
		expect(resolveRequestTimeoutSeconds({ requestTimeoutSeconds: Number.NaN })).toBe(30);
	});
});
