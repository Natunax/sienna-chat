import { useEffect, type RefObject } from "react";

/**
 * Keyboard behaviour of a menu (WAI-ARIA menu pattern): opening moves focus to
 * the checked or first item, arrows, Home and End move between items, and
 * closing returns focus to the button that opened it unless the user clicked
 * somewhere else. Other controls in the menu (the effort slider) keep their keys.
 */
export function useMenuFocus(open: boolean, menu: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const element = menu.current;
    if (!element) return;
    // Menu items, or the controls of a small dialog marked with data-menu-item.
    const items = () => [
      ...element.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled), [data-menu-item]:not(:disabled)'),
    ];
    const start = items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0];
    if (start) start.focus({ preventScroll: true });
    else if (element.tabIndex >= 0 || element.hasAttribute("tabindex")) element.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (at < 0 || !list.length) return;
      const next =
        event.key === "ArrowDown"
          ? (at + 1) % list.length
          : event.key === "ArrowUp"
            ? (at - 1 + list.length) % list.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? list.length - 1
                : -1;
      if (next < 0) return;
      event.preventDefault();
      list[next].focus();
    };
    element.addEventListener("keydown", onKey);
    return () => {
      element.removeEventListener("keydown", onKey);
      const focus = document.activeElement;
      if (!focus || focus === document.body || element.contains(focus)) trigger.current?.focus({ preventScroll: true });
    };
  }, [open, menu, trigger]);
}
