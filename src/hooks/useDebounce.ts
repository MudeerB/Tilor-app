/**
 * src/hooks/useDebounce.ts
 *
 * Generic debounce hook for text inputs and search filters.
 * Decouples immediate 60fps text input responsiveness from heavy data filtering calculations.
 */

import { useState, useEffect } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number = 200): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
