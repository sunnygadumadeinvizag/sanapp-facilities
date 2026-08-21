"use client";

import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD string into a LOCAL Date (no UTC shifting). */
export function parseYmd(value: string | null | undefined): Date | undefined {
  if (!value || !YMD_RE.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format a LOCAL Date back into a YYYY-MM-DD string. */
export function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * shadcn calendar in a popover producing plain YYYY-MM-DD values,
 * matching the apps' IST date-string convention.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  clearable,
  className,
}: {
  value: string;
  onChange: (ymd: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseYmd(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("h-8 justify-start px-2.5 text-xs font-normal", className)}
        >
          <CalendarIcon className="mr-1 h-3.5 w-3.5" />
          {selected ? (
            format(selected, "EEE, dd MMM yyyy")
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            if (d) {
              onChange(formatYmd(d));
              setOpen(false);
            }
          }}
          initialFocus
        />
        {clearable && value ? (
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
