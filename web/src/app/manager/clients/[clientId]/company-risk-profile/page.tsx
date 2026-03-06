import { ManagerCompanyRiskProfile } from "@/components/manager-company-risk-profile";

export default async function ManagerClientCompanyRiskProfilePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ManagerCompanyRiskProfile clientId={clientId} />;
}
