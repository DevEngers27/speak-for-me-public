import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RoomWorkbench } from "@/components/room/RoomWorkbench";
import { RequestScreen } from "@/components/room/RoomSections";
import { formatItemKeys, formatCatalogReferences, formatFieldLabel } from "@/lib/format";
import { buildRoomView } from "./fixtures";
afterEach(cleanup);
it("renders projected shared facts with readable field and catalog labels",()=>{
 const view=buildRoomView("finance","S7");
 render(<RoomWorkbench view={view}/>);
 const facts=screen.getByTestId("shared-facts-list").textContent!;
 expect(facts).toContain("Budget cap");expect(facts).toContain("Required scope");
 expect(facts).not.toMatch(/capCents|requiredItemKeys|audit_log_export|sso_login/);
 expect(facts).toContain(view.catalog.find(item=>item.itemKey==="audit_log_export")!.title);
});
it("resolves identifiers only from the supplied role-projected catalog",()=>{
 const catalog=[{itemKey:"visible_item",title:"Visible delivery"}];
 expect(formatItemKeys(["visible_item","private_item"],catalog)).toBe("Visible delivery, Unlisted catalog item");
 expect(formatCatalogReferences("visible_item and private_item",catalog)).toBe("Visible delivery and private_item");
 expect(formatFieldLabel("capCents")).toBe("Budget cap");
});
it("offers customer fallback candidates and binds confirmation to the selected server option",()=>{
 const view=buildRoomView("customer","S7");
 if(!view.openRequest?.mine) throw Error("Expected customer request");
 const candidates=view.openRequest.options.filter(option=>option.type==="choose_candidate");
 expect(candidates.length).toBeGreaterThan(0);
 const answer=vi.fn();render(<RequestScreen view={view} onAnswerRequest={answer}/>);
 const option=candidates[candidates.length-1]!;
 const radio=screen.getByTestId(`request-radio-${option.optionKey}`) as HTMLInputElement;
 expect(radio.disabled).toBe(false);fireEvent.click(radio);
 fireEvent.click(screen.getByTestId("confirm-request-answer"));expect(answer).not.toHaveBeenCalled();
 expect(screen.getByRole("alertdialog").textContent).toContain("This creates a proposal");
 fireEvent.click(screen.getByTestId("confirm-request-answer"));expect(answer).toHaveBeenCalledWith(option.optionKey);
});
