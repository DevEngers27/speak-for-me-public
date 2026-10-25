import { BackendGate } from "@/components/providers";
import { EngineStatus } from "@/components/engine-status";

export default function HomePage() {
  return (
    <section>
      <h1>Speak for Me</h1>
      <BackendGate fallback={<p>Running without a backend. See /setup.</p>}>
        <EngineStatus />
      </BackendGate>
    </section>
  );
}
