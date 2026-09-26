import { Building2 } from "lucide-react";

export default function CondominioIdentity({ name }: { name: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-slate-900">
      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
      <div className="min-w-0 break-words text-sm leading-5">
        <span className="mr-2 text-xs font-medium text-slate-500">Condominio</span>
        <strong>{name || "Caricamento..."}</strong>
      </div>
    </div>
  );
}
