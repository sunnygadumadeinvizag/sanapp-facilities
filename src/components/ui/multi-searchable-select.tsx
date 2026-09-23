"use client";

import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Short secondary text pinned to the right of the row (e.g. a username). */
  hint?: string;
  /** Extra text the search should match but which is not displayed. */
  keywords?: string;
};

type MultiSearchableSelectProps = {
  options: MultiSelectOption[];
  /** Currently selected values. */
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
  "aria-label"?: string;
};

/**
 * Searchable multi-select dropdown.
 *
 * Same interaction family as `SearchableSelect` (type-to-filter, ↑/↓/Enter
 * keyboard support, styled to match `Select`) but keeps multiple selections:
 * picked rows show a check, and the trigger renders removable chips.
 */
export function MultiSearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled = false,
  id,
  className,
  contentClassName,
  "aria-label": ariaLabel,
}: MultiSearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listId = `${React.useId()}-list`;

  const selected = React.useMemo(() => {
    const byValue = new Map(options.map((o) => [o.value, o]));
    return value.map((v) => byValue.get(v) ?? { value: v, label: v });
  }, [options, value]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((option) =>
      `${option.label} ${option.hint ?? ""} ${option.keywords ?? ""}`.toLowerCase().includes(needle)
    );
  }, [options, query]);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  React.useEffect(() => {
    setActive(0);
  }, [query, open]);
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, filtered.length]);

  function isSelected(v: string) {
    return value.includes(v);
  }

  function toggle(v: string) {
    onValueChange(isSelected(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  function remove(v: string) {
    onValueChange(value.filter((x) => x !== v));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(filtered.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[active];
      if (option) toggle(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Backspace" && !query && value.length > 0) {
      onValueChange(value.slice(0, -1));
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <div
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-controls={listId}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={onKeyDown}
          onClick={() => !disabled && setOpen((o) => !o)}
          className={cn(
            "flex min-h-9 w-full cursor-pointer flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
            disabled && "cursor-not-allowed opacity-50",
            !open && "hover:bg-muted/50",
            className
          )}
        >
          {selected.length === 0 && <span className="py-0.5 text-muted-foreground">{placeholder}</span>}
          {selected.map((option) => (
            <span
              key={option.value}
              className="inline-flex max-w-full items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="max-w-48 truncate">{option.label}</span>
              <button
                type="button"
                aria-label={`Remove ${option.label}`}
                disabled={disabled}
                className="rounded-sm opacity-60 transition hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) remove(option.value);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[var(--radix-popover-trigger-width)] p-0", contentClassName)}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="border-b px-2.5 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label={searchPlaceholder}
          />
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-multiselectable className="max-h-64 overflow-auto p-1">
          {filtered.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">{emptyText}</p>}
          {filtered.map((option, i) => {
            const picked = isSelected(option.value);
            return (
              <div
                key={option.value}
                data-index={i}
                role="option"
                aria-selected={picked}
                onClick={() => toggle(option.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                  i === active && "bg-muted",
                  picked && "font-medium"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                    picked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                  )}
                >
                  {picked && (
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
