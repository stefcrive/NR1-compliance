import Link from "next/link";

export function CompanyLogoLink({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 rounded-xl px-1 py-1 ${className}`}>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#131313] text-xs font-bold text-white">
        NR1
      </span>
      <span className="text-sm font-semibold uppercase tracking-[0.14em] text-[#141d24]">Compliance</span>
    </Link>
  );
}
