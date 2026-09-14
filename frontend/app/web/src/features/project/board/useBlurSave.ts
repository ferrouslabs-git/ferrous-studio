// Handlers for a real <input>/<textarea> that saves on blur when its value
// actually changed (Enter commits an input, Escape reverts). The field is
// UNCONTROLLED -- spread these with `defaultValue` and key the element by the
// entity id -- so a data refresh re-rendering the parent never moves the
// caret. Ported from the reference app's wireFieldSave (static/js/epicpage.js).
import { FocusEvent, KeyboardEvent, useRef } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement;

export function useBlurSave(initial: string, save: (value: string) => void | Promise<unknown>) {
  const origRef = useRef(initial);
  return {
    defaultValue: initial,
    onFocus: (e: FocusEvent<Field>) => {
      origRef.current = e.currentTarget.value;
    },
    onBlur: (e: FocusEvent<Field>) => {
      const v = e.currentTarget.value.trim();
      if (v === origRef.current.trim()) return;
      origRef.current = v;
      void save(v);
    },
    onKeyDown: (e: KeyboardEvent<Field>) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.currentTarget.value = origRef.current;
        e.currentTarget.blur();
      } else if (e.key === "Enter" && e.currentTarget.tagName === "INPUT") {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
  };
}
