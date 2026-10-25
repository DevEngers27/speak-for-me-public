import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BriefScreen, PeopleScreen } from "@/components/room/RoomSections";
import type { Role, RoomView } from "@/lib/viewModels/types";
import { buildBriefQuery, buildCatalogQuery, buildRoomView } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function creatorView(role: Role, states: Record<Role, "empty" | "filled" | "invited">): RoomView {
  const view = buildRoomView(role, "S3");
  return { ...view, header: { ...view.header, isCreator: true, status: "setup" }, seats: (["customer", "provider", "finance"] as const).map(seat => ({ role: seat, state: states[seat], inviteMode: null, invitedEmail: null, inviteExpiresAt: null })) };
}
it.each(["provider", "finance"] as const)("defaults %s creator invitations to the first empty seat", async role => {
  const view = creatorView(role, { customer: "empty", provider: role === "provider" ? "filled" : "empty", finance: role === "finance" ? "filled" : "empty" });
  const create = vi.fn().mockResolvedValue(undefined);
  render(<PeopleScreen view={view} onCreateInvite={create} />);
  const select = screen.getByTestId("invite-role-select") as HTMLSelectElement;
  expect(select.value).toBe("customer");
  expect(select.querySelector<HTMLOptionElement>(`option[value="${role}"]`)!.disabled).toBe(true);
  fireEvent.change(screen.getByTestId("invite-email-input"), { target: { value: "participant@example.com" } });
  fireEvent.click(screen.getByTestId("send-email-invite-btn"));
  await waitFor(() => expect(create).toHaveBeenCalledExactlyOnceWith({ role: "customer", invitedEmail: "participant@example.com" }));
});
it("prefers empty seats over invited seats while retaining allowed invitation reissues", async () => {
  const view = creatorView("provider", { customer: "invited", provider: "filled", finance: "empty" });
  const link = vi.fn().mockResolvedValue({ token: "test-only" });
  render(<PeopleScreen view={view} onCreateInviteLink={link} />);
  const select = screen.getByTestId("invite-role-select") as HTMLSelectElement;
  expect(select.value).toBe("finance");
  expect(select.querySelector<HTMLOptionElement>('option[value="customer"]')!.disabled).toBe(false);
  fireEvent.change(select, { target: { value: "customer" } });
  fireEvent.click(screen.getByTestId("create-invite-link-btn"));
  await waitFor(() => expect(link).toHaveBeenCalledExactlyOnceWith("customer"));
});
it("updates the choice when a seat fills and blocks invitations once all seats are filled", () => {
  const create = vi.fn(), link = vi.fn();
  const props = { onCreateInvite: create, onCreateInviteLink: link };
  const view = creatorView("provider", { customer: "empty", provider: "filled", finance: "empty" });
  const mounted = render(<PeopleScreen view={view} {...props} />);
  fireEvent.change(screen.getByTestId("invite-role-select"), { target: { value: "finance" } });
  mounted.rerender(<PeopleScreen view={creatorView("provider", { customer: "empty", provider: "filled", finance: "filled" })} {...props} />);
  expect((screen.getByTestId("invite-role-select") as HTMLSelectElement).value).toBe("customer");
  mounted.rerender(<PeopleScreen view={creatorView("provider", { customer: "filled", provider: "filled", finance: "filled" })} {...props} />);
  for (const id of ["invite-role-select", "send-email-invite-btn", "create-invite-link-btn"]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("send-email-invite-btn")); fireEvent.click(screen.getByTestId("create-invite-link-btn"));
  expect(create).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("All three seats are filled");
});
it.each(["provider", "finance"] as const)("confirms fresh %s notes without warning that those same notes will be discarded", async role => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const save = vi.fn().mockResolvedValue(undefined);
  render(<BriefScreen view={buildRoomView(role, "S3")} brief={{ ...buildBriefQuery(role, "S3"), latest: null }} catalog={buildCatalogQuery()} onConfirmBrief={save} />);
  fireEvent.change(screen.getByTestId("role-soft-notes"), { target: { value: "Keep delivery lean." } });
  if (role === "finance") fireEvent.change(screen.getByTestId("finance-cap-input"), { target: { value: "5000" } });
  fireEvent.click(screen.getByTestId(role === "provider" ? "confirm-provider-brief-btn" : "confirm-cap-btn"));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ softFields: { schemaKey: `scope_change.${role}.v1`, notes: "Keep delivery lean." } })));
  await waitFor(() => expect(screen.getByTestId("brief-status-note").textContent).toBe("Saved."));
  expect(window.dispatchEvent(new Event("sfm:before-navigate", { cancelable: true }))).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});
it("still protects unrelated unsaved catalog edits when confirming Provider notes", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const save = vi.fn();
  render(<BriefScreen view={buildRoomView("provider", "S3")} brief={{ ...buildBriefQuery("provider", "S3"), latest: null }} catalog={buildCatalogQuery()} onConfirmBrief={save} />);
  fireEvent.change(screen.getByTestId("role-soft-notes"), { target: { value: "Keep delivery lean." } });
  fireEvent.change(screen.getByTestId("catalog-title-input"), { target: { value: "Unconfirmed catalog change" } });
  fireEvent.click(screen.getByTestId("confirm-provider-brief-btn"));
  expect(confirm).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Unconfirmed changes in other sections"));
  expect(save).not.toHaveBeenCalled();
});
