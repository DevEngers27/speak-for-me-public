// Reached only after proxy.ts `auth.protect()` (or never, when Clerk is not
// configured: the proxy redirects to /setup). Real authorization happens in Convex.
export default function RoomsPage() {
  return (
    <section>
      <h1>Rooms</h1>
      <p>Room list goes here. Every query enforces membership server-side.</p>
    </section>
  );
}
