import { useEffect, useRef } from "react";

/** Calls `onVisible` when the returned ref's element scrolls into view (infinite scroll). */
export function useInfiniteSentinel(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && cb.current(),
      {
        rootMargin: "300px",
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}
