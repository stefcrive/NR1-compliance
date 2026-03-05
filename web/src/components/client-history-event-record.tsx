"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type EventRecordAttachment } from "@/lib/event-record-journal";

type EventRecordPayload = {
  record: {
    id: string;
    recordType: "calendar" | "drps";
    eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
    title: string;
    status: "scheduled" | "completed" | "cancelled";
    startsAt: string;
    endsAt: string;
    details: {
      content: string | null;
      preparationRequired: string | null;
      eventLifecycle: "provisory" | "committed";
      proposalKind: "assignment" | "reschedule" | null;
      availabilityRequestId: string | null;
    };
    journal: {
      notes: string | null;
      attachments: EventRecordAttachment[];
      available: boolean;
    };
    related: {
      campaign: {
        id: string;
        name: string;
        publicSlug: string | null;
        status: string;
        startsAt: string | null;
        closesAt: string | null;
      } | null;
      programAssignment: {
        id: string;
        clientId: string;
        programId: string;
        programTitle: string;
        status: "Recommended" | "Active" | "Completed";
        deployedAt: string | null;
      } | null;
    };
    diagnostics: {
      responseCount: number;
      latestResponseAt: string | null;
      latestDrpsResult: {
        id: string;
        sector: string;
        referencePeriod: string;
        probabilityScore: number;
        probabilityClass: "low" | "medium" | "high";
        recommendedPrograms: string[];
        governanceActions: string[];
        createdAt: string;
      } | null;
      drpsUnavailable: boolean;
    } | null;
  };
};

function fmt(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function durationMinutes(startsAt: string, endsAt: string) {
  const starts = new Date(startsAt).getTime();
  const ends = new Date(endsAt).getTime();
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return "-";
  const duration = Math.max(0, Math.round((ends - starts) / (60 * 1000)));
  return `${duration} min`;
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function eventTypeLabel(value: "drps_start" | "drps_close" | "continuous_meeting" | "blocked") {
  if (value === "drps_start") return "Inicio DRPS";
  if (value === "drps_close") return "Fechamento DRPS";
  if (value === "continuous_meeting") return "Reuniao continua";
  return "Bloqueio";
}

function statusLabel(value: "scheduled" | "completed" | "cancelled") {
  if (value === "scheduled") return "Agendado";
  if (value === "completed") return "Concluido";
  return "Cancelado";
}

function lifecycleLabel(value: "provisory" | "committed") {
  return value === "committed" ? "Commitado" : "Provisorio";
}

function proposalLabel(value: "assignment" | "reschedule" | null) {
  if (value === "assignment") return "Atribuicao de cadencia";
  if (value === "reschedule") return "Pedido de reagendamento";
  return "Sem proposta";
}

function probabilityLabel(value: "low" | "medium" | "high") {
  if (value === "low") return "Baixa";
  if (value === "medium") return "Media";
  return "Alta";
}

export function ClientHistoryEventRecord({
  clientSlug,
  eventId,
}: {
  clientSlug: string;
  eventId: string;
}) {
  const [payload, setPayload] = useState<EventRecordPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRecord = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/client/portal/${clientSlug}/history/events/${encodeURIComponent(eventId)}`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as EventRecordPayload & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Nao foi possivel carregar ficha do evento.");
      }
      setPayload(body);
    } catch (loadError) {
      setPayload(null);
      setError(
        loadError instanceof Error ? loadError.message : "Nao foi possivel carregar ficha do evento.",
      );
    } finally {
      setLoading(false);
    }
  }, [clientSlug, eventId]);

  useEffect(() => {
    void loadRecord();
  }, [loadRecord]);

  const record = payload?.record ?? null;
  const hasRelated = useMemo(
    () => Boolean(record?.related.campaign || record?.related.programAssignment),
    [record?.related.campaign, record?.related.programAssignment],
  );

  if (loading) return <p className="text-sm text-[#49697a]">Carregando ficha do evento...</p>;
  if (error || !record) return <p className="text-sm text-red-600">{error || "Ficha indisponivel."}</p>;
  const eventTitleWithDate = `${record.title} (${fmt(record.startsAt)})`;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href={`/client/${clientSlug}/history`} className="text-[#0f5b73] hover:underline">
          Historico
        </Link>{" "}
        / <span>{eventTitleWithDate}</span>
      </nav>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">{eventTitleWithDate}</h2>
      </section>

      <section className="grid gap-3 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
          <p className="text-xs text-[#4f6977]">Tipo</p>
          <p className="text-sm font-semibold text-[#123447]">{eventTypeLabel(record.eventType)}</p>
        </article>
        <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
          <p className="text-xs text-[#4f6977]">Status</p>
          <p className="text-sm font-semibold text-[#123447]">{statusLabel(record.status)}</p>
        </article>
        <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
          <p className="text-xs text-[#4f6977]">Data/hora</p>
          <p className="text-sm font-semibold text-[#123447]">{fmt(record.startsAt)}</p>
        </article>
        <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
          <p className="text-xs text-[#4f6977]">Duracao</p>
          <p className="text-sm font-semibold text-[#123447]">
            {durationMinutes(record.startsAt, record.endsAt)}
          </p>
        </article>
        <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
          <p className="text-xs text-[#4f6977]">Ciclo</p>
          <p className="text-sm font-semibold text-[#123447]">
            {lifecycleLabel(record.details.eventLifecycle)}
          </p>
        </article>
        <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
          <p className="text-xs text-[#4f6977]">Proposta</p>
          <p className="text-sm font-semibold text-[#123447]">{proposalLabel(record.details.proposalKind)}</p>
        </article>
      </section>

      <section className="grid gap-3 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:grid-cols-2">
        <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
          <p className="text-xs text-[#4f6977]">Conteudo</p>
          <p className="mt-1 text-sm text-[#123447]">{record.details.content ?? "Sem detalhes cadastrados."}</p>
        </article>
        <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
          <p className="text-xs text-[#4f6977]">Preparacao necessaria</p>
          <p className="mt-1 text-sm text-[#123447]">
            {record.details.preparationRequired ?? "Sem detalhes cadastrados."}
          </p>
        </article>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-base font-semibold text-[#123447]">Diario do evento</h3>
        {!record.journal.available ? (
          <p className="mt-3 text-sm text-[#4f6977]">
            Armazenamento do diario indisponivel no momento.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">Notas</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[#123447]">
                {record.journal.notes ?? "Sem anotacoes registradas."}
              </p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">Arquivos</p>
              {record.journal.attachments.length === 0 ? (
                <p className="mt-1 text-sm text-[#4f6977]">Nenhum arquivo registrado.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {record.journal.attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e3edf3] p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#123447]">{attachment.title}</p>
                        <p className="truncate text-xs text-[#4f6977]">
                          {attachment.fileName} | {formatFileSize(attachment.sizeBytes)} |{" "}
                          {fmt(attachment.uploadedAt)}
                        </p>
                      </div>
                      <a
                        href={attachment.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                      >
                        Abrir arquivo
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        )}
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-base font-semibold text-[#123447]">Registros relacionados</h3>
        {!hasRelated ? (
          <p className="mt-3 text-sm text-[#4f6977]">Sem registros relacionados.</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {record.related.campaign ? (
              <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                <p className="text-xs text-[#4f6977]">Diagnostico</p>
                <p className="mt-1 text-sm font-semibold text-[#123447]">{record.related.campaign.name}</p>
                <p className="mt-1 text-xs text-[#4f6977]">{record.related.campaign.status}</p>
                <Link
                  href={`/client/${clientSlug}/diagnostic/${record.related.campaign.id}?from=history`}
                  className="mt-2 inline-flex text-xs font-semibold text-[#0f5b73] hover:underline"
                >
                  Abrir DRPS
                </Link>
              </article>
            ) : null}
            {record.related.programAssignment ? (
              <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                <p className="text-xs text-[#4f6977]">Programa atribuido</p>
                <p className="mt-1 text-sm font-semibold text-[#123447]">
                  {record.related.programAssignment.programTitle}
                </p>
                <p className="mt-1 text-xs text-[#4f6977]">
                  {record.related.programAssignment.status} |{" "}
                  {fmt(record.related.programAssignment.deployedAt)}
                </p>
                <Link
                  href={`/client/${clientSlug}/programs/${record.related.programAssignment.programId}?assignmentId=${record.related.programAssignment.id}&from=history`}
                  className="mt-2 inline-flex text-xs font-semibold text-[#0f5b73] hover:underline"
                >
                  Abrir programa
                </Link>
              </article>
            ) : null}
          </div>
        )}
      </section>

      {record.diagnostics ? (
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-base font-semibold text-[#123447]">Snapshot diagnostico</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">Respostas</p>
              <p className="text-sm font-semibold text-[#123447]">{record.diagnostics.responseCount}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">Ultima resposta</p>
              <p className="text-sm font-semibold text-[#123447]">{fmt(record.diagnostics.latestResponseAt)}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">Ultimo resultado DRPS</p>
              {record.diagnostics.latestDrpsResult ? (
                <p className="text-sm font-semibold text-[#123447]">
                  {record.diagnostics.latestDrpsResult.probabilityScore.toFixed(2)} (
                  {probabilityLabel(record.diagnostics.latestDrpsResult.probabilityClass)})
                </p>
              ) : (
                <p className="text-sm text-[#4f6977]">
                  {record.diagnostics.drpsUnavailable ? "Snapshots DRPS indisponiveis." : "-"}
                </p>
              )}
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}
