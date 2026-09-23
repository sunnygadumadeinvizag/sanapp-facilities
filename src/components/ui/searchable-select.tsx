"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Short secondary text pinned to the right of the row (e.g. a username). */
  hint?: string;
  /** Extra text the search should match but which is not displayed. */
  keywords?: string;
};

type SearchableSelectProps = {
  options: SearchableSelectOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
  /**
   * Long lists get a type-to-filter box; short ones stay a plain dropdown.
   * The box appears once the list holds at least this many options.
   */
  searchThreshold?: number;
  "aria-label"?: string;
};

/**
 * Dropdown that adds a type-to-filter box when the list is long.
 *
 * Built on the Popover primitive this app already depends on (no new package)
 * and styled to match `Select`, so the two can be swapped for one another.
 * Keyboard: ↑/↓ move, Enter selects, Escape closes, Home/End jump.
 */
export function SearchableSelect({
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
  searchThreshold = 8,
  "aria-label": ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listId = `${React.useId()}-list`;

  const withSearch = options.length >= searchThreshold;
  const selected = options.find((option) => option.value === value);

  const filtered = React.useMemo(() => {
    if (!withSearch || !query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((option) =>
      `${option.label} ${option.hint ?? ""} ${option.keywords ?? ""}`.toLowerCase().includes(needle)
    );
  }, [options, query, withSearch]);

  // Fresh query + highlight every time the dropdown opens.
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  React.useEffect(() => {
    setActive(0);
  }, [query, open]);

  // Keep the highlighted row in view while arrowing.
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, filtered.length]);

  function choose(option: SearchableSelectOption | undefined) {
    if (!option) return;
    onValueChange(option.value);
    setOpen(false);
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
      choose(filtered[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-[var(--radix-popover-trigger-width)] min-w-[12rem] overflow-hidden rounded-md border p-0 shadow-md",
          contentClassName
        )}
        onOpenAutoFocus={(event) => {
          // Focus the search box when there is one, else the list itself.
          event.preventDefault();
          (withSearch ? inputRef.current : listRef.current)?.focus();
        }}
        onKeyDown={onKeyDown}
      >
        {withSearch ? (
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-autocomplete="list"
              aria-controls={listId}
              className="h-5 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        ) : null}

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="max-h-72 overflow-y-auto p-1 outline-none"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {query.trim() ? `No matches for “${query.trim()}”` : emptyText}
            </div>
          ) : (
            filtered.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <div
                  key={option.value}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm",
                    index === active && "bg-secondary text-foreground"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                  ) : null}
                  <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                    {isSelected ? <Check className="h-4 w-4" /> : null}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
