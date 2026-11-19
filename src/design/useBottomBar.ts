import { useLayoutEffect, useRef } from 'react';

const PROPERTY = '--bottom-bar-h';
const bars = new Set<HTMLElement>();

/** The tallest bar on screen; a hidden one measures 0. */
function publish(): void {
  const height = Math.max(0, ...[...bars].map((bar) => bar.offsetHeight));
  const root = document.documentElement;
  if (height > 0) {
    root.style.setProperty(PROPERTY, `${height}px`);
  } else {
    root.style.removeProperty(PROPERTY);
  }
}

/**
 * For a bar fixed or stuck to the bottom of the screen: publishes its height as --bottom-bar-h,
 * so toasts (shape.css) rise above it instead of covering its buttons.
 */
export function useBottomBar<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) {
      return;
    }
    bars.add(bar);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      bars.delete(bar);
      publish();
    };
  }, []);
  return ref;
}
