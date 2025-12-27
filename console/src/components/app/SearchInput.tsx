import React, { useEffect, useRef, useState } from "react";

// not state based rather it triggers an action which can trigger a state change
export function useDebouncedAction<T>(action: (value: T) => void, delay = 500) {
  const timer = useRef<number | null>(null);

  useEffect(() => {
    {
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
    }
  }, []);

  return (value: T) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      action(value);
    }, delay);
  };
}

interface SearchInputProps
  extends Omit<React.ComponentProps<"input">, "onChange"> {
  onSearch?: (value: string) => void;
}

export default function SearchInput({ onSearch, ...props }: SearchInputProps) {
  const debouncedSearch = useDebouncedAction(onSearch ?? (() => {}), 500);

  return (
    <>
      <input {...props} type="search" onChange={(e) => debouncedSearch(e.target.value)} />
    </>
  );
}
