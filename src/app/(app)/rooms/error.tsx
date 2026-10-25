"use client";

import Link from "next/link";

/**
 * Error boundary for `/rooms` product routes (13 §13.2, §13.12, W1-6-r08).
 * Never displays raw `error.message` (I-FE-7); invokes Next.js 16 `retry()`
 * (with fallback to `reset()` for test harnesses).
 */
export default function RoomsError({
  error,
  reset,
  retry,
}: {
  error: unknown;
  reset?: () => void;
  retry?: () => void;
}) {
  void error;
  const handleRetry = () => {
    if (typeof retry === "function") {
      retry();
      return;
    }
    if (typeof reset === "function") {
      reset();
    }
  };

  return (
    <main className="page-shell" data-testid="room-error-boundary">
      <div className="panel stack" role="alert">
        <p className="eyebrow">Room Error</p>
        <h1 style={{ fontSize: "1.2rem" }}>
          Something went wrong loading this room.
        </h1>
        <p className="subtle">
          Your private brief and recorded approvals are safe. Try reloading the
          room state or return to your rooms inbox.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            data-testid="room-error-retry"
            onClick={handleRetry}
          >
            Try again
          </button>
          <Link className="btn" href="/rooms">
            Back to rooms
          </Link>
        </div>
      </div>
    </main>
  );
}
