import { useEffect, useMemo, useRef, useState } from "react";
import type { SymbolInfo } from "../api/types";
import { useDismiss } from "../lib/hooks";
import { SearchIcon } from "./Icons";

/** Combobox over all symbols. Ctrl/⌘+K or "/" focuses it from anywhere. */
export function SymbolSearch({ symbols, value, onChange }: { symbols: SymbolInfo[]; value: string | null; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), box);

  const list = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return symbols;
    const starts = symbols.filter((x) => x.symbol.startsWith(s));
    const has = symbols.filter((x) => !x.symbol.startsWith(s) && x.symbol.includes(s));
    return [...starts, ...has];
  }, [q, symbols]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select");
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setHi(0), [q]);

  const pick = (s: string) => {
    onChange(s);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="search" ref={box}>
      <SearchIcon />
      <input
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls="symbol-list"
        aria-autocomplete="list"
        aria-label="Symbol"
        spellCheck={false}
        placeholder={value ?? "Search symbol"}
        value={open ? q : value ?? ""}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(list.length - 1, h + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === "Enter" && list[hi]) pick(list[hi].symbol);
          else if (e.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          }
        }}
      />
      <kbd className="kbd">Ctrl K</kbd>
      {open && (
        <ul className="popover search-list" id="symbol-list" role="listbox">
          {list.length === 0 && <li className="muted search-empty">No symbol matches “{q}”</li>}
          {list.map((s, i) => (
            <li
              key={s.symbol}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? "hi" : ""}
              onMouseEnter={() => setHi(i)}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(s.symbol);
              }}
            >
              <span className="search-sym">{s.symbol}</span>
              {s.has_fno ? <span className="chip">F&amp;O</span> : <span className="chip chip-quiet">Equity only</span>}
              {s.symbol === value && <span className="search-cur muted">current</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
