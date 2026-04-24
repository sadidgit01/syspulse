import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function AuthShell({
  eyebrow,
  title,
  description,
  footer,
  children
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}>) {
  return (
    <div className="grid min-h-screen bg-transparent lg:grid-cols-[1.1fr_0.9fr]">
      <div className="grid-shell hidden border-r border-white/6 p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="space-y-6">
          <Badge
            variant="outline"
            className="border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-blue-200"
          >
            SysPulse Access
          </Badge>
          <div className="space-y-4">
            <h1 className="max-w-lg text-5xl font-semibold leading-tight text-white">
              Infrastructure awareness that feels like a live command deck.
            </h1>
            <p className="max-w-xl text-base leading-7 text-slate-400">
              Authenticate once and drop straight into the realtime fleet surface, with agent
              health, heat lanes, and streaming telemetry already in motion.
            </p>
          </div>
        </div>

        <div className="panel-surface rounded-[32px] border border-slate-800/80 p-6">
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Preview</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <PreviewMetric label="Live buffers" value="60" description="samples per node" />
            <PreviewMetric label="Refresh window" value="15m" description="access token lifetime" />
            <PreviewMetric label="Invite lane" value="48h" description="signed team onboarding" />
            <PreviewMetric label="Realtime stream" value="WS" description="native websocket feed" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-4 sm:p-8">
        <Card className="panel-surface w-full max-w-xl rounded-[32px] border border-slate-800/80">
          <CardContent className="p-8 sm:p-10">
            <div className="mb-8 space-y-4">
              <Badge
                variant="outline"
                className="border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-300"
              >
                {eyebrow}
              </Badge>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight text-white">{title}</h2>
                <p className="text-sm leading-6 text-slate-400">{description}</p>
              </div>
            </div>

            {children}

            <div className="mt-8 border-t border-white/6 pt-6 text-sm text-slate-400">
              {footer}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PreviewMetric({
  label,
  value,
  description
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
    </div>
  );
}
