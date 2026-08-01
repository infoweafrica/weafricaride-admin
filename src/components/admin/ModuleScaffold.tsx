import Link from "next/link";

type Metric = {
  label: string;
  value: string;
  tone?: "green" | "blue" | "amber" | "red" | "purple" | "gray";
};

type Section = {
  title: string;
  description: string;
  items: string[];
};

type Table = {
  columns: string[];
  rows: string[][];
};

type ModuleScaffoldProps = {
  title: string;
  eyebrow: string;
  description: string;
  primaryAction?: string;
  metrics: Metric[];
  sections: Section[];
  table?: Table;
  relatedLinks?: { label: string; href: string }[];
};

const toneClasses: Record<NonNullable<Metric["tone"]>, string> = {
  green: "bg-green-50 text-green-700 border-green-100",
  blue: "bg-blue-50 text-blue-700 border-blue-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
  red: "bg-red-50 text-red-700 border-red-100",
  purple: "bg-purple-50 text-purple-700 border-purple-100",
  gray: "bg-gray-50 text-gray-700 border-gray-100",
};

export default function ModuleScaffold({
  title,
  eyebrow,
  description,
  primaryAction = "Configure",
  metrics,
  sections,
  table,
  relatedLinks = [],
}: ModuleScaffoldProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-green-700">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">{description}</p>
        </div>
        <button className="inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
          {primaryAction}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{metric.label}</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{metric.value}</p>
            <span className={`mt-3 inline-flex rounded-full border px-2 py-1 text-xs font-medium ${toneClasses[metric.tone || "gray"]}`}>
              Production metric
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-base font-semibold text-gray-900">{section.title}</h2>
            <p className="mt-1 text-sm text-gray-500">{section.description}</p>
            <ul className="mt-4 space-y-2">
              {section.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {table && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">Operational View</h2>
            <p className="text-sm text-gray-500">Sample structure for live Supabase data integration.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  {table.columns.map((column) => (
                    <th key={column} className="px-5 py-3 font-medium">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {table.rows.map((row, rowIndex) => (
                  <tr key={`${row[0]}-${rowIndex}`} className="hover:bg-gray-50">
                    {row.map((cell, cellIndex) => (
                      <td key={`${cell}-${cellIndex}`} className="px-5 py-3 text-gray-700">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {relatedLinks.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Related admin areas</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {relatedLinks.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-green-300 hover:bg-green-50">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}