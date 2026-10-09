import { useSyncExternalStore } from "react";

const query = "(min-width: 768px)";

/** True on tablet/desktop widths, where sheets slide in from the side. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}
