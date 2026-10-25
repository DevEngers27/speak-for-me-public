import { useSyncExternalStore } from "react";
const navigationEvent = "sfm:navigation";
const historyIndexKey = "sfm:history-index";
let currentIndex = Number(window.history.state?.[historyIndexKey] ?? 0);
window.history.replaceState({ ...window.history.state, [historyIndexKey]: currentIndex }, "");
let restoringHistory = false;
let acceptedPathname = window.location.pathname;
let acceptedHref = window.location.href;
window.addEventListener("popstate", (event) => {
  const rawIndex: unknown = event.state?.[historyIndexKey];
  const nextIndex = typeof rawIndex === "number" ? rawIndex : currentIndex;
  if (restoringHistory) { restoringHistory = false; return; }
  if (!window.dispatchEvent(new CustomEvent("sfm:before-navigate", { cancelable: true, detail: { href: window.location.href, source: "popstate" } }))) {
    event.stopImmediatePropagation();
    const delta = currentIndex - nextIndex;
    if (delta === 0) window.history.replaceState(window.history.state, "", acceptedHref);
    else { restoringHistory = true; window.history.go(delta); }
    return;
  }
  currentIndex = nextIndex;
  acceptedPathname = window.location.pathname;
  acceptedHref = window.location.href;
});
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);
  window.addEventListener(navigationEvent, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("hashchange", callback);
    window.removeEventListener(navigationEvent, callback);
  };
}
export function usePathname() {
  return useSyncExternalStore(subscribe, () => acceptedPathname, () => "/");
}
export function navigate(href: string, replace = false, scroll = true) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  if (!window.dispatchEvent(new CustomEvent("sfm:before-navigate", { cancelable: true, detail: { href } }))) return;
  const previousUrl = window.location.href;
  const previousHash = window.location.hash;
  if (!replace) currentIndex += 1;
  window.history[replace ? "replaceState" : "pushState"]({ [historyIndexKey]: currentIndex }, "", url);
  acceptedPathname = url.pathname;
  acceptedHref = url.href;
  window.dispatchEvent(new Event(navigationEvent));
  if (previousHash !== url.hash) window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: previousUrl, newURL: url.href }));
  if (scroll) window.scrollTo(0, 0);
}
const router = {
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href, true),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => window.dispatchEvent(new Event(navigationEvent)),
  prefetch: () => {},
};
export function useRouter() { return router; }
