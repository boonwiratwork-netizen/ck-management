import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProgressiveList } from "./use-progressive-list";

describe("useProgressiveList", () => {
  it("draws a page, more on request, and resets when the list changes", () => {
    const a = Array.from({ length: 250 }, (_, i) => i);
    const { result, rerender } = renderHook(({ items }) => useProgressiveList(items, 100), { initialProps: { items: a } });
    expect(result.current.visible).toHaveLength(100);
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(200);
    act(() => result.current.showAll());
    expect(result.current.hasMore).toBe(false);
    rerender({ items: a.slice(0, 180) });
    expect(result.current.visible).toHaveLength(100);
  });
});
