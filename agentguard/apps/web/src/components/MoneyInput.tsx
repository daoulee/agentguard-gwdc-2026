import { useEffect, useRef, useState } from "react";

export function MoneyInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(() => value.toLocaleString("ko-KR"));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(current => Number(current.replaceAll(",", "")) === value ? current : value.toLocaleString("ko-KR"));
  }, [value]);
  return <input ref={input} type="text" inputMode="numeric" value={text} onBlur={() => setText(value.toLocaleString("ko-KR"))} onChange={event => {
    const raw = event.target.value;
    if (!/^[\d,]*$/.test(raw)) return;
    const digits = raw.replaceAll(",", "");
    const amount = Number(digits);
    if (!Number.isSafeInteger(amount)) return;
    const digitsBeforeCaret = raw.slice(0, event.target.selectionStart ?? raw.length).replaceAll(",", "").length;
    const formatted = digits ? amount.toLocaleString("ko-KR") : "";
    setText(formatted);
    onChange(amount);
    requestAnimationFrame(() => {
      let position = 0;
      let count = 0;
      while (position < formatted.length && count < digitsBeforeCaret) {
        if (formatted[position] !== ",") count++;
        position++;
      }
      input.current?.setSelectionRange(position, position);
    });
  }} />;
}
