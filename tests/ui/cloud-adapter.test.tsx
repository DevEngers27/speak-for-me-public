import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Link from "../../cloud/link";
import { navigate } from "../../cloud/navigation";
import { rememberInviteFragment, restoreInviteFragment } from "../../cloud/invite-return";
import { parseRoomRoute } from "../../cloud/routes";

beforeEach(() => {
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("cloud invitation and navigation adapter", () => {
  it("restores the invitation after a token-free auth redirect, then clears transient storage", () => {
    history.replaceState(null, "", "/invite#t=private-test-token");
    expect(rememberInviteFragment()).toBe(true);
    history.replaceState(null, "", "/invite");
    restoreInviteFragment();
    expect(location.pathname).toBe("/invite");
    expect(location.search).toBe("");
    expect(location.hash).toBe("#t=private-test-token");
    expect(sessionStorage.length).toBe(0);
  });
  it("does not overwrite a newer invitation or restore an expired one", () => {
    history.replaceState(null, "", "/invite#t=old");
    rememberInviteFragment();
    history.replaceState(null, "", "/invite#t=new");
    restoreInviteFragment();
    expect(location.hash).toBe("#t=new");
    rememberInviteFragment();
    history.replaceState(null, "", "/invite");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);
    restoreInviteFragment();
    expect(location.hash).toBe("");
  });
  it("notifies mounted invitation UI when the fragment changes on the same path", () => {
    history.replaceState(null, "", "/invite#t=one");
    const changed = vi.fn();
    window.addEventListener("hashchange", changed);
    navigate("/invite#t=two");
    expect(changed).toHaveBeenCalledOnce();
    expect(location.hash).toBe("#t=two");
    window.removeEventListener("hashchange", changed);
  });
  it("honors cancellation before mutating history", () => {
    const block = (event: Event) => event.preventDefault();
    window.addEventListener("sfm:before-navigate", block);
    navigate("/rooms");
    expect(location.pathname).toBe("/");
    window.removeEventListener("sfm:before-navigate", block);
  });
  it("keeps new-tab, modified, named-target, and download clicks native", () => {
    for (const props of [{ target: "_blank" }, { target: "review" }, { download: "" }, {}]) {
      const rendered = render(createElement(Link, { href: "/rooms", ...props }, "Rooms"));
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: Object.keys(props).length === 0 });
      screen.getByText("Rooms").dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(location.pathname).toBe("/");
      rendered.unmount();
    }
  });
  it("routes regular internal links without reload and preserves scroll=false", () => {
    render(createElement(Link, { href: "/rooms", scroll: false }, "Rooms"));
    fireEvent.click(screen.getByText("Rooms"));
    expect(location.pathname).toBe("/rooms");
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it("restores the previous history entry when a dirty draft cancels browser Back", async () => {
    navigate("/rooms");
    navigate("/rooms/example/brief");
    const block = vi.fn((event: Event) => event.preventDefault());
    window.addEventListener("sfm:before-navigate", block);
    window.history.back();
    await waitFor(() => expect(block).toHaveBeenCalledOnce());
    await waitFor(() => expect(location.pathname).toBe("/rooms/example/brief"));
    window.removeEventListener("sfm:before-navigate", block);
    window.history.back();
    await waitFor(() => expect(location.pathname).toBe("/rooms"));
  });
  it("requires exact canonical route shapes", () => {
    expect(parseRoomRoute("/rooms/abc/brief")?.section).toBe("brief");
    expect(parseRoomRoute("/rooms/abc/proposals/xyz")?.id).toBe("xyz");
    for (const path of ["/rooms/abc/brief/extra", "/rooms/abc/proposals", "/rooms/abc/requests", "/rooms/%00/brief", "/rooms/abc/unknown"]) expect(parseRoomRoute(path)).toBeNull();
  });
});
