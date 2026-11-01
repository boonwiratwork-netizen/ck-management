import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMissingPage, pageLoader, reloadForNewVersion } from "./new-version";

beforeEach(() => sessionStorage.clear());

describe("a page whose code is gone after a release", () => {
  it("a failed download reloads once for the new version; a second failure goes to the error screen", async () => {
    const reload = vi.fn();
    const load = pageLoader(() => Promise.reject(new Error("Failed to fetch dynamically imported module")), reload);
    void load(); // reloading: never settles
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    // Same tab right after the reload (guard still set): no loop, the error goes on
    await expect(load()).rejects.toThrow(/Failed to fetch/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("an empty module (a swallowed load error hands back undefined) is a failure, not a white screen", async () => {
    const reload = vi.fn();
    const load = pageLoader(() => Promise.resolve(undefined as unknown as { default: () => null }), reload);
    void load();
    await Promise.resolve();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    await expect(load()).rejects.toThrow("page code missing");
  });

  it("a page that loads is handed through untouched", async () => {
    const page = { default: () => null };
    const reload = vi.fn();
    await expect(pageLoader(() => Promise.resolve(page), reload)()).resolves.toBe(page);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads at most once per guard", () => {
    const reload = vi.fn();
    expect(reloadForNewVersion(reload)).toBe(true);
    expect(reloadForNewVersion(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isMissingPage(undefined)).toBe(true);
    expect(isMissingPage({})).toBe(true);
    expect(isMissingPage({ default: () => null })).toBe(false);
  });
});
