import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate } from "./navigation";
type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; scroll?: boolean; replace?: boolean };
export default function Link({ href, onClick, replace, prefetch: _prefetch, scroll, ...props }: Props) {
  void _prefetch;
  return <a {...props} data-sfm-navigation="true" href={href} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (props.target && props.target !== "_self") || props.download !== undefined) return;
    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(href, replace, scroll);
  }} />;
}
