"use client";

export default function BuildingsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-6">
      <h2 className="font-semibold text-red-700">Could not load buildings</h2>
      <p className="mt-1 text-sm text-muted-foreground">{error.message || "Please reload the page."}</p>
      <button type="button" className="mt-3 rounded-md border bg-white px-3 py-1.5 text-sm" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
