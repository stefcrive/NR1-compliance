import Link from "next/link";

const FLOW = [
  "Manager portal: govern clients, DRPS diagnostics calendar, and programs database.",
  "Client portal: monitor company metrics, DRPS diagnostics, and continuous programs.",
  "Employee portal: answer active questionnaires with zero-distraction flow.",
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 md:py-12">
      <header className="rounded-[28px] border border-[#d5e2ea] bg-[linear-gradient(115deg,#ffffff_0%,#edf7fb_48%,#fff4e2_100%)] p-8 shadow-sm md:p-12">
        <p className="text-xs uppercase tracking-[0.22em] text-[#0f6077]">NR1 Compliance Platform</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight text-[#112a38] md:text-5xl">
          Full workflow for psychossocial compliance: diagnostics, interventions, and continuous evidence
        </h1>
        <p className="mt-4 max-w-3xl text-base text-[#385464]">
          Start in one gateway and route each profile to the correct experience: Manager,
          Client, or Employee.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/access"
            className="rounded-full bg-[#0f6077] px-6 py-3 text-sm font-semibold text-white hover:bg-[#0c4f61]"
          >
            Access to platform
          </Link>
        </div>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {FLOW.map((item) => (
          <article key={item} className="rounded-2xl border border-[#d5e2ea] bg-white p-5 text-sm text-[#3a5868] shadow-sm">
            {item}
          </article>
        ))}
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <article className="rounded-2xl border border-[#d5e2ea] bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#0f6077]">Access architecture</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#112a38]">Role-based access control gateway</h3>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[#3a5868]">
            <li>Public landing page focused on conversion with one CTA.</li>
            <li>Role selection asks: Manager, Client, or Employee.</li>
            <li>Manager/Client use email+password flow.</li>
            <li>Employee enters by tokenized link or diagnostic slug + token.</li>
          </ul>
        </article>

        <article className="rounded-2xl border border-[#d5e2ea] bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#0f6077]">Platform model</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#112a38]">
            Dashboard consistency across portals
          </h3>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[#3a5868]">
            <li>Manager and Client use fixed left sidebars + dynamic right content area.</li>
            <li>Diagnostic and program detail pages include breadcrumb navigation.</li>
            <li>Program pages support chronogram, materials, and evaluation metrics.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
