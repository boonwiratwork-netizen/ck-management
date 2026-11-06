import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { KitchenShortcuts } from "./AdminHome";

describe("ครัวกลาง ทางลัด", () => {
  it("three kitchen jobs one tap away, to their pages", () => {
    const onGo = vi.fn();
    render(<KitchenShortcuts pendingRequests={null} onGo={onGo} />);
    fireEvent.click(screen.getByRole("button", { name: "รับของ" }));
    fireEvent.click(screen.getByRole("button", { name: "จัดใบโอน" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกผลิต" }));
    expect(onGo.mock.calls.map((c) => c[0].path)).toEqual(["/receipt", "/transfer-order", "/production"]);
  });

  it("the waiting-requests badge only once read and above 0", () => {
    const { rerender } = render(<KitchenShortcuts pendingRequests={null} onGo={() => undefined} />);
    expect(screen.queryByText("3")).toBeNull();
    rerender(<KitchenShortcuts pendingRequests={0} onGo={() => undefined} />);
    expect(screen.getByRole("button", { name: "จัดใบโอน" })).toBeInTheDocument();
    rerender(<KitchenShortcuts pendingRequests={3} onGo={() => undefined} />);
    expect(screen.getByRole("button", { name: "จัดใบโอน · ใบขอเบิกรอ 3 ใบ" })).toHaveTextContent("3");
  });
});
