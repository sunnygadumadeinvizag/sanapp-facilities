"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";

export type CancelBookingModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: (reason: string) => Promise<void> | void;
  busy?: boolean;
};

export function CancelBookingModal({
  open,
  onOpenChange,
  count,
  onConfirm,
  busy = false,
}: CancelBookingModalProps) {
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setValidationError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setValidationError("Reason for cancellation is required.");
      return;
    }
    setValidationError(null);
    await onConfirm(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !busy && onOpenChange(val)}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {count > 1 ? `Cancel ${count} Bookings` : "Cancel Booking"}
            </DialogTitle>
            <DialogDescription>
              {count > 1
                ? `You are about to cancel ${count} selected bookings. Please enter a mandatory reason for cancellation.`
                : "Please enter a mandatory reason for cancelling this booking."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="cancel-booking-reason" className="text-sm font-semibold">
                Reason for cancellation <span className="text-destructive">*</span>
              </Label>
              <span className="text-xs text-muted-foreground">{reason.length}/500</span>
            </div>
            <Textarea
              id="cancel-booking-reason"
              placeholder="e.g. Schedule conflict, maintenance work, event postponed..."
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (validationError && e.target.value.trim()) {
                  setValidationError(null);
                }
              }}
              maxLength={500}
              autoFocus
              disabled={busy}
              className={validationError ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {validationError && (
              <p className="flex items-center gap-1 text-xs text-destructive font-medium">
                <AlertCircle className="h-3.5 w-3.5" />
                {validationError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              This cancellation reason will be recorded in the history log and visible on the booking record.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Keep Booking
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!reason.trim() || busy}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancelling…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" /> Confirm Cancellation
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
