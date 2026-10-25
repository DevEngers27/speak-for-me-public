import Link from "next/link";
import { APP_NAME } from "@core/engine/ui";
import { EngineStatus } from "@/components/engine-status";
import { BackendGate } from "@/components/providers";

const steps = [
  ["Your brief", "Tell your agent what matters. Choose exactly what you share."],
  ["Negotiation meeting", "Agents explore scope, price, and timing within confirmed constraints."],
  ["Your decision", "Review the exact proposal. Only people can approve an agreement."],
  ["Recorded agreement", "One version everyone agreed to, with clear delivery tasks."],
];

export default function HomePage() {
  return (
    <main className="home-shell" data-testid="home-page">
      <header className="product-masthead">
        <Link href="/" className="product-wordmark">{APP_NAME}</Link>
        <Link className="btn" href="/rooms">Open rooms</Link>
      </header>
      <section className="home-hero">
        <div>
          <p className="eyebrow">A shared decision. Your own voice.</p>
          <h1>Find the terms.<br />Keep the final say.</h1>
          <p className="hero-intro">A negotiation workspace for Customer, Provider, and Finance. Let your agents explore the options while you stay in control of the agreement.</p>
          <Link className="btn primary" href="/rooms">Open your workspace <span aria-hidden="true">→</span></Link>
        </div>
        <ol className="home-process" aria-label="How a room works">
          {steps.map(([title,body],index)=><li key={title}><span className="step-number">0{index+1}</span><div><h2>{title}</h2><p>{body}</p></div></li>)}
        </ol>
      </section>
      <section className="home-principles" aria-label="Built around trust">
        <div><h2>Private by choice</h2><p>Your brief stays with you and your agent. Shared facts go only to the recipients you choose.</p></div>
        <div><h2>Checked against constraints</h2><p>Code checks the proposal. Agent suggestions stay separate from human approval.</p></div>
        <div><h2>Every approval has a version</h2><p>When the terms or constraints change, review them again. No payment happens here.</p></div>
      </section>
      <footer className="home-footer row-between"><BackendGate fallback={<p className="subtle">Workspace connection needs configuration.</p>}><EngineStatus /></BackendGate><Link href="/setup">Connection settings</Link></footer>
    </main>
  );
}
