import { PublicSurveyForm } from "@/components/public-survey-form";
import { CompanyLogoLink } from "@/components/company-logo-link";

export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const token = Array.isArray(query.token) ? query.token[0] : query.token;

  return (
    <main className="min-h-screen bg-[#f6f6f6] px-4 py-10">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <header className="flex items-center justify-between rounded-[26px] border border-[#dfdfdf] bg-white p-4 shadow-sm">
          <CompanyLogoLink />
        </header>

        <header className="rounded-[26px] border border-[#dfdfdf] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#5d6d77]">Employee Survey</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#141d24]">Anonymous DRPS Questionnaire</h1>
          <p className="mt-2 text-sm text-[#4a5862]">
            Complete all required sections. No personal identification is collected.
          </p>
        </header>
        <PublicSurveyForm slug={slug} sectorToken={token} />
      </div>
    </main>
  );
}
