import Link from "next/link";

const HIGHLIGHTS = [
  "Conformidade com NR-01 e foco em risco psicossocial com evidencias rastreaveis.",
  "Coleta anonima com protecoes anti-abuso e k-anonimato para evitar exposicao indevida.",
  "Leitura executiva por topico, setor e nivel de risco para priorizacao rapida.",
];

export default function PortalHomePage() {
  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-[#0d6077]">Painel do cliente</p>
        <h2 className="mt-2 text-3xl font-semibold text-[#102f3f]">
          Operacao de compliance psicossocial
        </h2>
        <p className="mt-3 max-w-3xl text-sm text-[#35515f]">
          Acompanhe campanhas, execute DRPS tecnico e visualize riscos por topico para orientar o
          plano anual de medidas de controle.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/portal/campaigns"
            className="rounded-full bg-[#0f5b73] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0c4d61]"
          >
            Gerenciar campanhas
          </Link>
          <Link
            href="/portal/dashboard"
            className="rounded-full border border-[#9ec8db] px-5 py-2 text-sm font-semibold text-[#0e4e62] hover:bg-[#e8f3f8]"
          >
            Abrir dashboard visual
          </Link>
          <Link
            href="/portal/drps/new"
            className="rounded-full border border-[#e4c898] px-5 py-2 text-sm font-semibold text-[#7a4b00] hover:bg-[#fff4df]"
          >
            Preencher novo DRPS
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {HIGHLIGHTS.map((item) => (
          <article
            key={item}
            className="rounded-2xl border border-[#d8e4ee] bg-white p-4 text-sm text-[#304c5b] shadow-sm"
          >
            {item}
          </article>
        ))}
      </section>
    </main>
  );
}
