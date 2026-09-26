import type { ReactNode } from "react";

export type BillingValue = { label: string; value: ReactNode; note?: string; emphasis?: boolean };

export default function BillingValueGrid({ title, items, tone = "neutral" }: {
  title: string;
  items: BillingValue[];
  tone?: "neutral" | "advance" | "credit";
}) {
  return (
    <section className={`billing-value-section billing-value-section--${tone}`} aria-label={title}>
      <h4>{title}</h4>
      <dl className="billing-value-grid">
        {items.map(({ label, value, note, emphasis }) => (
          <div key={label} className={emphasis ? "billing-value billing-value--total" : "billing-value"}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            {note && <div className="billing-value-note">{note}</div>}
          </div>
        ))}
      </dl>
    </section>
  );
}
