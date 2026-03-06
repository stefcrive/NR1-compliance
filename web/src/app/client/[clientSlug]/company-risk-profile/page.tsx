import { ClientCompanyRiskProfile } from "@/components/client-company-risk-profile";

export default async function ClientCompanyRiskProfilePage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  return <ClientCompanyRiskProfile clientSlug={clientSlug} />;
}
