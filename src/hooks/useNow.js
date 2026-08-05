import { useEffect, useState } from 'react';

/**
 * The current instant, refreshed every 30s. Lives only in the UI layer - never
 * inside `src/lib/planner.js`, which must stay a pure function of its input.
 */
export default function useNow() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return now;
}
