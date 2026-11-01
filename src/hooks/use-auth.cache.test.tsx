import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

// The client's auth as an object with methods (they keep `this`); the listener is captured to drive events
type Listener = (event: string, session: { user: { id: string } } | null) => void;
const { auth, query } = vi.hoisted(() => {
  const auth = {
    listener: null as Listener | null,
    onAuthStateChange(cb: Listener) {
      this.listener = cb;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    getSession() {
      return Promise.resolve({ data: { session: null } });
    },
    signOut() {
      return Promise.resolve({ error: null });
    },
  };
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    single() {
      return Promise.resolve({ data: null, error: null });
    },
    then(r: (v: { data: unknown[]; error: null }) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(r);
    },
  };
  return { auth, query };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth, from: () => Object.create(query) } }));

import { AuthProvider } from "./use-auth";
import { keep, lastSeen } from "@/lib/page-cache";

describe("the auth listener clears kept page data", () => {
  it("on a session that ends without signOut() (expiry / another tab), and when another person signs in", async () => {
    render(
      <AuthProvider>
        <div />
      </AuthProvider>,
    );
    await act(async () => auth.listener!("SIGNED_IN", { user: { id: "u1" } }));
    keep("today|b1|d", ["sales_entries"], 1);
    await act(async () => auth.listener!("TOKEN_REFRESHED", { user: { id: "u1" } }));
    expect(lastSeen("today|b1|d")).not.toBeNull();
    await act(async () => auth.listener!("SIGNED_OUT", null));
    expect(lastSeen("today|b1|d")).toBeNull();

    await act(async () => auth.listener!("SIGNED_IN", { user: { id: "u1" } }));
    keep("today|b1|d", ["sales_entries"], 1);
    await act(async () => auth.listener!("SIGNED_IN", { user: { id: "u2" } }));
    expect(lastSeen("today|b1|d")).toBeNull();
  });
});
