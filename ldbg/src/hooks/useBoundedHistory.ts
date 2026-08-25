import { useCallback, useState } from "react";

const DEFAULT_MAX = 50;

type HistoryState<T> = { stack: T[]; index: number };

export function useBoundedHistory<T>(initial: T, maxSize = DEFAULT_MAX) {
  const [state, setState] = useState<HistoryState<T>>({
    stack: [initial],
    index: 0,
  });

  const current = state.stack[state.index] ?? initial;

  const push = useCallback(
    (next: T) => {
      setState(({ stack, index }) => {
        const base = stack.slice(0, index + 1);
        base.push(next);
        while (base.length > maxSize) base.shift();
        return { stack: base, index: base.length - 1 };
      });
    },
    [maxSize]
  );

  const replace = useCallback((next: T) => {
    setState({ stack: [next], index: 0 });
  }, []);

  const undo = useCallback(() => {
    setState((s) => ({ ...s, index: Math.max(0, s.index - 1) }));
  }, []);

  const redo = useCallback(() => {
    setState((s) => ({
      ...s,
      index: Math.min(s.stack.length - 1, s.index + 1),
    }));
  }, []);

  return {
    current,
    push,
    replace,
    undo,
    redo,
    canUndo: state.index > 0,
    canRedo: state.index < state.stack.length - 1,
    index: state.index,
  };
}
