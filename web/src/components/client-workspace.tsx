"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Campaign = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  k_anonymity_min: number;
  starts_at: string | null;
  closes_at: string | null;
  created_at: string;
  employeeFormLink?: string;
};

type Sector = {
  sector: string;
  sectorId: string | null;
  riskParameter: number;
  accessLink: string | null;
  submissionCount: number;
  lastSubmittedAt: string | null;
};

type Report = {
  id: string;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  created_at: string;
};

type AssignedProgram = {
  id: string;
  programId: string;
  status: "Recommended" | "Active" | "Completed";
  deployedAt: string | null;
  programTitle: string;
  programDescription: string | null;
  targetRiskTopic: number | null;
  triggerThreshold: number | null;
  scheduleFrequency: string;
  scheduleAnchorDate: string | null;
};

type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
};

type AvailabilityRequest = {
  id: string;
  clientProgramId: string;
  programId: string | null;
  programTitle: string;
  status: "pending" | "submitted" | "scheduled" | "closed";
  requestedAt: string;
  dueAt: string | null;
  submittedAt: string | null;
  suggestedSlots: AvailabilitySlot[];
  selectedSlots: AvailabilitySlot[];
};

type MasterCalendarEvent = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
  title: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  sourceClientProgramId: string | null;
};

type Payload = {
  client: {
    id: string;
    companyName: string;
    cnpj: string;
    status: string;
    billingStatus: string;
    portalSlug: string;
    totalEmployees: number;
    remoteEmployees: number;
    onsiteEmployees: number;
    hybridEmployees: number;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contractStartDate: string | null;
    contractEndDate: string | null;
    updatedAt: string | null;
  };
  campaigns: Campaign[];
  selectedCampaign: Campaign | null;
  dashboard: {
    totals: { responses: number; topics: number; activeSectors: number };
    riskDistribution: { low: number; medium: number; high: number; critical: number };
    sectors: Sector[];
    latestDrps: {
      reference_period: string;
      part1_probability_score: number;
      part1_probability_class: string;
    } | null;
  } | null;
  reports: Report[];
  assignedPrograms: AssignedProgram[];
  availabilityRequests: AvailabilityRequest[];
  availabilityRequestsUnavailable?: boolean;
  masterCalendar: {
    events: MasterCalendarEvent[];
    calendarEventsUnavailable: boolean;
  };
};

function fmt(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function dayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"] as const;

export function ClientWorkspace({ clientSlug }: { clientSlug: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [copiedCampaignId, setCopiedCampaignId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [availabilitySelection, setAvailabilitySelection] = useState<Record<string, string[]>>({});
  const [submittingAvailabilityId, setSubmittingAvailabilityId] = useState<string | null>(null);
  const [availabilityFeedback, setAvailabilityFeedback] = useState("");

  const loadData = useCallback(
    async (campaignId?: string) => {
      setIsLoading(true);
      setError("");
      try {
        const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
        const response = await fetch(`/api/client/portal/${clientSlug}${query}`, { cache: "no-store" });
        if (!response.ok) {
          const e = (await response.json()) as { error?: string };
          throw new Error(e.error ?? "Nao foi possivel carregar o portal do cliente.");
        }
        const data = (await response.json()) as Payload;
        setPayload(data);
        setSelectedCampaignId(data.selectedCampaign?.id ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar portal.");
        setPayload(null);
      } finally {
        setIsLoading(false);
      }
    },
    [clientSlug],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!payload) return;
    setAvailabilitySelection((previous) => {
      const next = { ...previous };
      for (const request of payload.availabilityRequests) {
        if (request.status !== "pending") continue;
        if (next[request.id] && next[request.id].length > 0) continue;
        next[request.id] =
          request.selectedSlots.length > 0
            ? request.selectedSlots.map((slot) => slot.startsAt)
            : request.suggestedSlots.slice(0, 2).map((slot) => slot.startsAt);
      }
      return next;
    });
  }, [payload]);

  const selectedCampaign = useMemo(
    () => payload?.campaigns.find((item) => item.id === selectedCampaignId) ?? payload?.selectedCampaign ?? null,
    [payload, selectedCampaignId],
  );

  const primaryContinuousProgram = useMemo(() => {
    if (!payload) return null;
    return (
      payload.assignedPrograms.find((program) => program.status === "Active") ??
      payload.assignedPrograms[0] ??
      null
    );
  }, [payload]);

  const pendingAvailabilityRequests = useMemo(
    () => (payload?.availabilityRequests ?? []).filter((request) => request.status === "pending"),
    [payload],
  );

  async function copyEmployeeLink(campaign: Campaign) {
    const link = campaign.employeeFormLink ?? `${window.location.origin}/s/${campaign.public_slug}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedCampaignId(campaign.id);
      window.setTimeout(() => setCopiedCampaignId(null), 1600);
    } catch {
      setError("Nao foi possivel copiar o link do colaborador.");
    }
  }

  function toggleAvailabilitySlot(requestId: string, startsAt: string) {
    setAvailabilitySelection((previous) => {
      const current = previous[requestId] ?? [];
      const exists = current.includes(startsAt);
      if (exists) {
        return { ...previous, [requestId]: current.filter((value) => value !== startsAt) };
      }
      if (current.length >= 3) {
        return previous;
      }
      return { ...previous, [requestId]: [...current, startsAt] };
    });
  }

  async function submitAvailability(request: AvailabilityRequest) {
    if (request.id.startsWith("virtual-")) {
      setAvailabilityFeedback(
        "Envio indisponivel nesta base. Aplique a migration 20260302220000_master_calendar_availability.sql.",
      );
      return;
    }

    const selectedSlots = availabilitySelection[request.id] ?? [];
    if (selectedSlots.length === 0) {
      setAvailabilityFeedback("Selecione pelo menos um horario para enviar a disponibilidade.");
      return;
    }

    setSubmittingAvailabilityId(request.id);
    setAvailabilityFeedback("");
    try {
      const response = await fetch(
        `/api/client/portal/${clientSlug}/availability/${request.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedSlots }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Nao foi possivel enviar disponibilidade.");
      }
      setAvailabilityFeedback("Disponibilidade enviada. Reunioes do processo continuo agendadas no calendario.");
      await loadData(selectedCampaignId || undefined);
    } catch (submitError) {
      setAvailabilityFeedback(
        submitError instanceof Error ? submitError.message : "Nao foi possivel enviar disponibilidade.",
      );
    } finally {
      setSubmittingAvailabilityId(null);
    }
  }

  const calendarEvents = useMemo(() => {
    const events = payload?.masterCalendar.events ?? [];
    return events
      .map((event) => {
        const date = new Date(event.startsAt);
        if (Number.isNaN(date.getTime())) return null;
        return {
          day: dayKey(date),
          title: event.title,
          type:
            event.eventType === "drps_start"
              ? "start"
              : event.eventType === "drps_close"
                ? "close"
                : event.eventType === "continuous_meeting"
                  ? "meeting"
                  : "blocked",
        };
      })
      .filter((value): value is { day: string; title: string; type: "start" | "close" | "meeting" | "blocked" } =>
        Boolean(value),
      );
  }, [payload]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, typeof calendarEvents>();
    for (const event of calendarEvents) map.set(event.day, [...(map.get(event.day) ?? []), event]);
    return map;
  }, [calendarEvents]);

  const days = useMemo(() => {
    const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const gridStart = new Date(start);
    gridStart.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, idx) => {
      const value = new Date(gridStart);
      value.setDate(gridStart.getDate() + idx);
      const key = dayKey(value);
      return { value, key, inMonth: value.getMonth() === calendarMonth.getMonth(), events: eventsByDay.get(key) ?? [] };
    });
  }, [calendarMonth, eventsByDay]);

  if (isLoading) {
    return <p className="text-sm text-[#3d5a69]">Carregando portal...</p>;
  }
  if (error || !payload) {
    return <p className="text-sm text-red-600">{error || "Portal indisponivel."}</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-[#0f6077]">Portal do cliente</p>
        <h2 className="mt-1 text-2xl font-semibold text-[#123447]">{payload.client.companyName}</h2>
        <p className="mt-2 text-sm text-[#3d5a69]">
          Status: <strong>{payload.client.status}</strong> | Financeiro:{" "}
          <strong>{payload.client.billingStatus}</strong> | CNPJ: {payload.client.cnpj}
        </p>
        <p className="mt-1 text-xs text-[#4f6977]">
          Colaboradores: {payload.client.totalEmployees} (R {payload.client.remoteEmployees} / P{" "}
          {payload.client.onsiteEmployees} / H {payload.client.hybridEmployees})
        </p>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Resultados atuais</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <article className="rounded-xl border border-[#d8e4ee] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[#4f6977]">DRPS atual</p>
            {payload.dashboard?.latestDrps ? (
              <>
                <p className="mt-1 text-sm font-semibold text-[#133748]">
                  {payload.dashboard.latestDrps.part1_probability_score.toFixed(2)} (
                  {payload.dashboard.latestDrps.part1_probability_class})
                </p>
                <p className="mt-1 text-xs text-[#4f6977]">
                  Periodo: {payload.dashboard.latestDrps.reference_period}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-[#5a7383]">Sem resultado DRPS disponivel.</p>
            )}
          </article>
          <article className="rounded-xl border border-[#d8e4ee] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[#4f6977]">Processo continuo atual</p>
            {primaryContinuousProgram ? (
              <>
                <p className="mt-1 text-sm font-semibold text-[#133748]">{primaryContinuousProgram.programTitle}</p>
                <p className="mt-1 text-xs text-[#4f6977]">
                  Status {primaryContinuousProgram.status} | Aplicado em{" "}
                  {fmt(primaryContinuousProgram.deployedAt)}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-[#5a7383]">Nenhum processo continuo atribuido.</p>
            )}
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Solicitacao de disponibilidade</h3>
        <p className="mt-1 text-sm text-[#3d5a69]">
          Quando um processo continuo for aplicado, selecione ate 3 horarios livres. As opcoes ja excluem reunioes
          atuais e bloqueios do calendario mestre.
        </p>
        {payload.availabilityRequestsUnavailable ? (
          <p className="mt-2 text-xs text-[#8a5b2d]">
            Persistencia de solicitacoes indisponivel nesta base. Exibindo solicitacoes estimadas a partir dos
            processos atribuidos.
          </p>
        ) : null}
        {pendingAvailabilityRequests.length === 0 ? (
          <p className="mt-3 text-sm text-[#5a7383]">Nenhuma solicitacao pendente no momento.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {pendingAvailabilityRequests.map((request) => (
              <article key={request.id} className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#133748]">{request.programTitle}</p>
                  <p className="text-xs text-[#4f6977]">
                    Solicitado em {fmt(request.requestedAt)} | Prazo {fmt(request.dueAt)}
                  </p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {request.suggestedSlots.length === 0 ? (
                    <p className="text-xs text-[#5a7383]">Sem horarios sugeridos no momento.</p>
                  ) : (
                    request.suggestedSlots.map((slot) => {
                      const selected = (availabilitySelection[request.id] ?? []).includes(slot.startsAt);
                      return (
                        <label
                          key={`${request.id}-${slot.startsAt}`}
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                            selected ? "border-[#0f5b73] bg-[#e8f3f8]" : "border-[#d8e4ee] bg-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleAvailabilitySlot(request.id, slot.startsAt)}
                            className="mt-0.5"
                          />
                          <span>{fmt(slot.startsAt)} - {fmt(slot.endsAt)}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void submitAvailability(request)}
                    disabled={submittingAvailabilityId === request.id || request.id.startsWith("virtual-")}
                    className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {request.id.startsWith("virtual-")
                      ? "Envio indisponivel"
                      : submittingAvailabilityId === request.id
                        ? "Enviando..."
                        : "Enviar disponibilidade"}
                  </button>
                  <span className="text-xs text-[#4f6977]">Maximo de 3 horarios.</span>
                </div>
              </article>
            ))}
          </div>
        )}
        {availabilityFeedback ? <p className="mt-3 text-sm text-[#0f5b73]">{availabilityFeedback}</p> : null}
      </section>

      {payload.dashboard ? (
        <section className="grid gap-4 md:grid-cols-4">
          <article className="rounded-xl border border-[#d8e4ee] bg-white p-4">
            <p className="text-xs text-[#4f6977]">Respostas</p>
            <p className="mt-1 text-2xl font-semibold text-[#133748]">{payload.dashboard.totals.responses}</p>
          </article>
          <article className="rounded-xl border border-[#d8e4ee] bg-white p-4">
            <p className="text-xs text-[#4f6977]">Topicos</p>
            <p className="mt-1 text-2xl font-semibold text-[#133748]">{payload.dashboard.totals.topics}</p>
          </article>
          <article className="rounded-xl border border-[#d8e4ee] bg-white p-4">
            <p className="text-xs text-[#4f6977]">Setores ativos</p>
            <p className="mt-1 text-2xl font-semibold text-[#133748]">{payload.dashboard.totals.activeSectors}</p>
          </article>
          <article className="rounded-xl border border-[#d8e4ee] bg-white p-4">
            <p className="text-xs text-[#4f6977]">Risco alto+critico</p>
            <p className="mt-1 text-2xl font-semibold text-[#133748]">
              {payload.dashboard.riskDistribution.high + payload.dashboard.riskDistribution.critical}
            </p>
          </article>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Dados da empresa</h3>
        <p className="mt-2 text-sm">
          Contato: {payload.client.contactName || "-"} | {payload.client.contactEmail || "-"} |{" "}
          {payload.client.contactPhone || "-"}
        </p>
        <p className="mt-1 text-sm">
          Colaboradores: {payload.client.totalEmployees} (R {payload.client.remoteEmployees} / P{" "}
          {payload.client.onsiteEmployees} / H {payload.client.hybridEmployees})
        </p>
        <p className="mt-1 text-sm">Setores: {payload.dashboard?.totals.activeSectors ?? 0}</p>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Diagnosticos DRPS</h3>
          <select
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            value={selectedCampaignId}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedCampaignId(value);
              void loadData(value);
            }}
          >
            {payload.campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name} ({campaign.status})
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Diagnostico</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Inicio</th>
                <th className="px-2 py-2 text-left">Fechamento</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {payload.campaigns.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-xs text-[#5a7383]" colSpan={5}>
                    Sem diagnosticos atribuidos.
                  </td>
                </tr>
              ) : (
                payload.campaigns.map((campaign) => (
                  <tr key={campaign.id} className={`border-b ${campaign.id === selectedCampaignId ? "bg-[#f6fbfe]" : ""}`}>
                    <td className="px-2 py-2">{campaign.name}</td>
                    <td className="px-2 py-2">{campaign.status}</td>
                    <td className="px-2 py-2">{fmt(campaign.starts_at)}</td>
                    <td className="px-2 py-2">{fmt(campaign.closes_at)}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCampaignId(campaign.id);
                            void loadData(campaign.id);
                          }}
                          className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                        >
                          Ver
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyEmployeeLink(campaign)}
                          className="rounded-full border border-[#b9d8a5] px-3 py-1 text-xs font-semibold text-[#2d5f23]"
                        >
                          {copiedCampaignId === campaign.id ? "Copiado" : "Gerar link colaboradores"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#123447]">Calendario mestre (DRPS + reunioes + bloqueios)</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCalendarMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs"
            >
              Mes anterior
            </button>
            <button
              type="button"
              onClick={() => setCalendarMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs"
            >
              Proximo
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm text-[#3d5a69]">
          {new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(calendarMonth)}
        </p>
        {payload.masterCalendar.calendarEventsUnavailable ? (
          <p className="mt-1 text-xs text-[#8a5b2d]">
            Eventos de reunioes/bloqueios indisponiveis no momento. Exibindo somente marcos DRPS.
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-7 gap-2">
          {WEEK.map((label) => (
            <p key={label} className="text-center text-xs font-semibold text-[#5e7d8d]">
              {label}
            </p>
          ))}
          {days.map((day) => (
            <div
              key={day.key}
              className={`min-h-[105px] rounded-xl border p-2 ${
                day.inMonth ? "border-[#d7e6ee] bg-white" : "border-[#edf3f7] bg-[#f8fbfd]"
              }`}
            >
              <p className={`text-xs font-semibold ${day.inMonth ? "text-[#163748]" : "text-[#86a0ac]"}`}>
                {day.value.getDate()}
              </p>
              <div className="mt-1 space-y-1">
                {day.events.slice(0, 3).map((event, idx) => (
                  <p
                    key={`${event.day}-${idx}`}
                    title={event.title}
                    className={`rounded px-1 py-0.5 text-[10px] ${
                      event.type === "start"
                        ? "bg-[#e2f4ea] text-[#1f5b38]"
                        : event.type === "close"
                          ? "bg-[#fff3df] text-[#7a4b00]"
                          : event.type === "meeting"
                            ? "bg-[#e8f3f8] text-[#0f5b73]"
                            : "bg-[#fce6f1] text-[#7a2755]"
                    }`}
                  >
                    {event.type === "meeting"
                      ? "Reuniao continua"
                      : event.type === "blocked"
                        ? "Bloqueio"
                        : event.type === "start"
                          ? "Inicio DRPS"
                          : "Fim DRPS"}
                  </p>
                ))}
                {day.events.length > 3 ? <p className="text-[10px] text-[#527083]">+{day.events.length - 3}</p> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Links por setor (diagnostico selecionado)</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Setor</th>
                <th className="px-2 py-2 text-left">Parametro</th>
                <th className="px-2 py-2 text-left">Respostas</th>
                <th className="px-2 py-2 text-left">Ultimo envio</th>
                <th className="px-2 py-2 text-left">Link</th>
              </tr>
            </thead>
            <tbody>
              {(payload.dashboard?.sectors ?? []).map((sector) => (
                <tr key={`${sector.sector}-${sector.sectorId ?? "none"}`} className="border-b">
                  <td className="px-2 py-2">{sector.sector}</td>
                  <td className="px-2 py-2">{sector.riskParameter.toFixed(2)}x</td>
                  <td className="px-2 py-2">{sector.submissionCount}</td>
                  <td className="px-2 py-2">{fmt(sector.lastSubmittedAt)}</td>
                  <td className="px-2 py-2">
                    <input
                      readOnly
                      value={sector.accessLink ?? "-"}
                      className="min-w-[260px] rounded border border-[#d5e2ea] bg-[#f7fbfe] px-2 py-1 text-xs"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Relatorios disponibilizados</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Titulo</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Data</th>
              </tr>
            </thead>
            <tbody>
              {payload.reports.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-xs text-[#5a7383]" colSpan={3}>
                    Sem relatorios ainda.
                  </td>
                </tr>
              ) : (
                payload.reports.map((report) => (
                  <tr key={report.id} className="border-b">
                    <td className="px-2 py-2">{report.report_title}</td>
                    <td className="px-2 py-2">{report.status}</td>
                    <td className="px-2 py-2">{fmt(report.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Processos continuos atribuidos</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Programa</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Aplicado em</th>
                <th className="px-2 py-2 text-left">Frequencia</th>
              </tr>
            </thead>
            <tbody>
              {payload.assignedPrograms.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum processo continuo atribuido.
                  </td>
                </tr>
              ) : (
                payload.assignedPrograms.map((assignment) => (
                  <tr key={assignment.id} className="border-b">
                    <td className="px-2 py-2">{assignment.programTitle}</td>
                    <td className="px-2 py-2">{assignment.status}</td>
                    <td className="px-2 py-2">{fmt(assignment.deployedAt)}</td>
                    <td className="px-2 py-2">{assignment.scheduleFrequency}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Contratos e faturamento</h3>
        <p className="mt-2 text-sm">Financeiro: {payload.client.billingStatus}</p>
        <p className="mt-1 text-sm">
          Contrato: {fmtDate(payload.client.contractStartDate)} - {fmtDate(payload.client.contractEndDate)}
        </p>
        <p className="mt-1 text-sm">Ultima atualizacao: {fmt(payload.client.updatedAt)}</p>
      </section>

      {selectedCampaign ? (
        <p className="text-xs text-[#5a7383]">
          Diagnostico ativo: {selectedCampaign.name} ({selectedCampaign.public_slug})
        </p>
      ) : null}
    </div>
  );
}
