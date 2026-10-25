import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDraftProtection } from "@/components/room/useDraftProtection";
function Draft({dirty=true}:{dirty?:boolean}) { useDraftProtection(dirty);return <><a href="/elsewhere">Native link</a><a href="/elsewhere" data-sfm-navigation="true" onClick={event=>event.preventDefault()}>Cloud link</a></>; }
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("draft navigation protection",()=>{
 it("cancels programmatic cloud navigation when discarding is declined",()=>{
   const confirm=vi.spyOn(window,"confirm").mockReturnValue(false); render(<Draft/>);
   const event=new Event("sfm:before-navigate",{cancelable:true});
   expect(window.dispatchEvent(event)).toBe(false);expect(confirm).toHaveBeenCalledOnce();
 });
 it("delegates cloud links to navigation event without double prompting",()=>{
   const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);const view=render(<Draft/>);
   fireEvent.click(view.getByText("Cloud link"));expect(confirm).not.toHaveBeenCalled();
   window.dispatchEvent(new Event("sfm:before-navigate",{cancelable:true}));expect(confirm).toHaveBeenCalledOnce();
 });
 it("protects native links and removes guards after draft is saved",()=>{
   const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);const view=render(<Draft/>);
   expect(fireEvent.click(view.getByText("Native link"))).toBe(false);expect(confirm).toHaveBeenCalledOnce();
   view.rerender(<Draft dirty={false}/>);
   expect(window.dispatchEvent(new Event("sfm:before-navigate",{cancelable:true}))).toBe(true);
   expect(confirm).toHaveBeenCalledOnce();
 });
});
