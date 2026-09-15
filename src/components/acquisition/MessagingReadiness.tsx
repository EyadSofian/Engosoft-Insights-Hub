import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  KeyRound,
  MessagesSquare,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { PageSection } from "@/components/dashboard-bits";
import { Card, Pill } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";

/**
 * Technical view of messaging attribution readiness and Meta credential
 * capabilities. Statuses and plain explanations only; no credential text.
 */

interface Check {
  key: string;
  label: string;
  state: "ready" | "not_ready" | "unverified" | "permission_pending";
  detail: string;
}
interface Channel {
  status: string;
  label: { en: string; ar: string };
  realDeliveries: number;
  resolvedDeliveries: number;
  lastSelfTest: { passed: boolean; ranAt: string } | null;
  checks: Check[];
}
interface Readiness {
  configured: boolean;
  generatedAt?: string;
  whatsapp?: Channel;
  messenger?: Channel;
  instagram?: Channel;
}
interface CredentialView {
  configured: boolean;
  credentials?: {
    variable: string;
    configured: boolean;
    valid: boolean;
    attributionApp: boolean;
    scopes: string[];
    capabilities: Record<string, { label: string; state: string; detail: string }>;
    checkedAt: string | null;
    bootstrap:
      { step: string; ok: boolean; skipped?: boolean; detail: string }[] | Record<string, never>;
    bootstrappedAt: string | null;
  }[];
}

const STATE_ICON: Record<Check["state"], ReactNode> = {
  ready: <CheckCircle2 size={14} className="text-success" />,
  not_ready: <XCircle size={14} className="text-danger" />,
  unverified: <CircleDashed size={14} className="text-warning" />,
  permission_pending: <Clock3 size={14} className="text-warning" />,
};
const STATE_LABEL: Record<Check["state"], { en: string; ar: string }> = {
  ready: { en: "Ready", ar: "جاهز" },
  not_ready: { en: "Not ready", ar: "غير جاهز" },
  unverified: { en: "Cannot verify yet", ar: "لا يمكن التحقق بعد" },
  permission_pending: { en: "Meta permission pending", ar: "بانتظار صلاحية Meta" },
};

export function MessagingReadinessPanel() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const readiness = useApi<Readiness>("/api/meta/messaging-readiness");
  const credentials = useApi<CredentialView>("/api/meta/credential-health");
  const channels: [string, Channel | undefined][] = [
    ["WhatsApp", readiness.data?.whatsapp],
    ["Messenger", readiness.data?.messenger],
    ["Instagram", readiness.data?.instagram],
  ];
  return (
    <PageSection
      title={A ? "جاهزية إسناد الرسائل" : "Messaging attribution readiness"}
      icon={<MessagesSquare size={16} />}
      tone="violet"
      hint={
        A
          ? "اختبار البنية يرسل رسالة موقّعة تجريبية عبر الرابط الحقيقي حتى التخزين وتحديد الإعلان، بلا صرف ولا تُحسب كحركة حقيقية."
          : "The infrastructure self-test sends a signed test message through the real production URL to storage and exact ad resolution, with no ad spend and never counted as real traffic."
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-3">
          {channels.map(([name, channel]) => (
            <Card padded key={name}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <b className="text-sm">{name}</b>
                <Pill
                  tone={
                    channel?.status === "connected"
                      ? "success"
                      : channel?.status === "infrastructure_ready_permission_pending"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {channel
                    ? A
                      ? channel.label.ar
                      : channel.label.en
                    : readiness.isLoading
                      ? "…"
                      : A
                        ? "غير متصل"
                        : "Not connected"}
                </Pill>
              </div>
              <div className="mb-2 text-[11px] text-text-muted">
                {channel?.lastSelfTest
                  ? `${A ? "آخر اختبار بنية" : "Last infrastructure self-test"}: ${channel.lastSelfTest.passed ? (A ? "نجح" : "passed") : A ? "فشل" : "failed"} · ${String(channel.lastSelfTest.ranAt).replace("T", " ").slice(0, 16)}`
                  : A
                    ? "لم يُشغَّل اختبار البنية بعد"
                    : "Infrastructure self-test not run yet"}
                {" · "}
                {A ? "رسائل حقيقية" : "Real deliveries"} {channel?.realDeliveries ?? 0}
              </div>
              <ul className="space-y-1.5">
                {(channel?.checks ?? []).map((check) => (
                  <li key={check.key} className="flex gap-2 text-xs" title={check.detail}>
                    <span className="mt-0.5">{STATE_ICON[check.state]}</span>
                    <div className="min-w-0">
                      <div className="text-text">
                        {check.label} —{" "}
                        <span className="text-text-muted">
                          {A ? STATE_LABEL[check.state].ar : STATE_LABEL[check.state].en}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-muted">{check.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <Card padded>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <KeyRound size={14} aria-hidden />
            {A ? "صلاحيات بيانات اعتماد Meta" : "Meta credential capabilities"}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(credentials.data?.credentials ?? []).map((credential) => (
              <div key={credential.variable} className="text-xs">
                <div className="mb-1 font-semibold text-text">
                  {credential.variable === "META_LEAD_ADS_ACCESS_TOKEN"
                    ? A
                      ? "بيانات اعتماد تطبيق Engosoft Attribution"
                      : "Engosoft Attribution credential"
                    : A
                      ? "بيانات اعتماد Marketing API الحالية"
                      : "Current Marketing API credential"}
                  <span className="ms-2 font-normal text-text-muted">
                    {credential.configured
                      ? credential.valid
                        ? A
                          ? "صالحة"
                          : "valid"
                        : A
                          ? "غير صالحة"
                          : "invalid"
                      : A
                        ? "غير مضبوطة"
                        : "not set"}
                  </span>
                </div>
                <ul className="space-y-1">
                  {Object.entries(credential.capabilities).map(([key, cap]) => (
                    <li key={key} className="flex items-start gap-2" title={cap.detail}>
                      {cap.state === "connected" ? (
                        <CheckCircle2 size={13} className="mt-0.5 text-success" />
                      ) : (
                        <CircleDashed size={13} className="mt-0.5 text-text-muted" />
                      )}
                      <span className="text-text">{cap.label}</span>
                      <span className="ms-auto text-text-muted">
                        {cap.state === "connected"
                          ? A
                            ? "متصل"
                            : "Connected"
                          : cap.state === "not_configured"
                            ? A
                              ? "غير مضبوط"
                              : "Not configured"
                            : A
                              ? "غير متصل"
                              : "Not connected"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageSection>
  );
}
