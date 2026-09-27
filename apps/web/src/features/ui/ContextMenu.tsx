/**
 * A small accessible context menu: role="menu" with arrow-key, Home/End and
 * Escape handling, focus moved into it on open and returned on close, and a
 * position that stays on screen. Closes on outside click, Tab, blur or scroll.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { menuPosition, type Point } from './menu-position.js';

export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
};

export type ContextMenuProps = {
  anchor: Point;
  label: string;
  items: readonly ContextMenuItem[];
  onClose: () => void;
};

export function ContextMenu({
  anchor,
  label,
  items,
  onClose,
}: ContextMenuProps): React.ReactElement {
  const menu = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState<Point>(anchor);

  // Give focus back to whatever had it before the menu opened. It is a
  // layout effect so its cleanup runs before anything the chosen item mounts
  // (a rename input) takes focus, and it is declared before the effect that
  // moves focus into the menu, because layout effects run in order.
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      previous?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition(
      menuPosition(
        anchor,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const close = (): void => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [onClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    const buttons = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number): void => {
      buttons[(next + buttons.length) % buttons.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(buttons.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        onClose();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <ul
      ref={menu}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 min-w-44 rounded-md border border-zinc-700 bg-zinc-900 py-1 text-sm shadow-xl"
    >
      {items.map((item) => (
        <li key={item.label} role="none">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`block w-full px-3 py-1.5 text-left outline-none hover:bg-zinc-800 focus:bg-zinc-800 ${
              item.danger ? 'text-red-300' : 'text-zinc-200'
            }`}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
