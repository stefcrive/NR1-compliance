import { ManagerClientFicha } from "@/components/manager-client-ficha";

type ClientTab =
  | "overview"
  | "company-data"
  | "assigned-drps"
  | "assigned-continuous"
  | "contracts-invoicing"
  | "history";

function parseTab(tab: string | undefined): ClientTab {
  if (tab === "company-data") return tab;
  if (tab === "assigned-drps") return tab;
  if (tab === "assigned-continuous") return tab;
  if (tab === "contracts-invoicing") return tab;
  if (tab === "history") return tab;
  return "overview";
}

export default async function ManagerClientFichaPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { clientId } = await params;
  const { tab } = await searchParams;
  const initialTab = parseTab(tab);

  return <ManagerClientFicha clientId={clientId} initialTab={initialTab} />;
}
