import { describe, expect, it, vi } from "vitest";
import { failedMessage, withBusy } from "./with-busy";

describe("a busy button", () => {
  it("clears when the work ends, returns, or throws (then says so)", async () => {
    const flags: boolean[] = [];
    const set = (b: boolean) => flags.push(b);
    expect(await withBusy(set, async () => 3)).toBe(3);
    expect(flags).toEqual([true, false]);

    const onError = vi.fn();
    expect(await withBusy(set, async () => Promise.reject(new TypeError("Failed to fetch")), onError)).toBeUndefined();
    expect(flags).toEqual([true, false, true, false]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(failedMessage(new TypeError("Failed to fetch"))).toBe("ไม่สำเร็จ ลองอีกครั้ง: Failed to fetch");
    expect(failedMessage("x")).toBe("ไม่สำเร็จ ลองอีกครั้ง: x");
  });
});
