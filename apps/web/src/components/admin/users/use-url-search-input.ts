import { useEffect, useState } from "react";

// A search box backed by a URL param: the input starts from `value` (the URL's term), and typing
// calls `write` with the trimmed term (undefined when blank) once the admin stops typing for
// `delayMs`. When the URL changes to anything this hook did not write (a link to the bare page,
// Back), the input follows the URL instead of writing its old text back.
export function useUrlSearchInput(
  value: string | undefined,
  write: (term: string | undefined) => void,
  delayMs = 300,
): [string, (input: string) => void] {
  const [input, setInput] = useState(value ?? "");
  // The term last written to (or read from) the URL. Adjusted during render (React's "storing
  // information from previous renders" pattern), not in an effect.
  const [written, setWritten] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== written) {
      setWritten(value);
      setInput(value ?? "");
    }
  }

  useEffect(() => {
    const term = input.trim() || undefined;
    if (term === written) return;
    const handle = setTimeout(() => {
      setWritten(term);
      write(term);
    }, delayMs);
    return () => clearTimeout(handle);
  }, [input, written, write, delayMs]);

  return [input, setInput];
}
