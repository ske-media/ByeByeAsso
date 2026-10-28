"use client";

import { Button, CheckInShell, Input } from "@kroov/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type ScanResult = "accepted" | "already_used" | "revoked" | "refunded" | "invalid";

interface ScanOutcome {
  result: ScanResult;
  ticket: { number: string; attendeeName: string | null; typeLabel: string } | null;
  firstScan: { at: string; byName: string | null } | null;
  scannedAt: string;
  counters: { admitted: number; valid: number };
}

interface Summary {
  admitted: number;
  valid: number;
  recent: Array<{
    at: string;
    result: ScanResult;
    number: string | null;
    attendeeName: string | null;
    byName: string | null;
  }>;
}

type View =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "result"; outcome: ScanOutcome }
  | { kind: "offline"; message: string };

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: {
      formats: string[];
    }) => { detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>> };
  }
}

function fmt(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Écrans 41–44 : scanner caméra (BarcodeDetector) + saisie manuelle, résultats, erreur réseau. */
export function Scanner({
  organizationId,
  eventId,
  eventTitle,
  organizationName,
  userName,
  timezone,
  initial,
  slug,
  eventSlug,
  tab,
}: {
  organizationId: string;
  eventId: string;
  eventTitle: string;
  organizationName: string;
  userName: string;
  timezone: string;
  initial: Summary;
  slug: string;
  eventSlug: string;
  tab: "scanner" | "journal";
}) {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [summary, setSummary] = useState<Summary>(initial);
  const [manual, setManual] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRef = useRef<{ value: string; at: number } | null>(null);
  const base = `/controle/${slug}/${eventSlug}`;

  const scan = useCallback(
    async (credential: string, source: "camera" | "manual" = "manual") => {
      const value = credential.trim();
      if (!value || busy) return;
      const now = Date.now();
      // Camera: the same QR stays in frame for several ticks — scan it once. Manual entry always goes through.
      if (source === "camera" && lastRef.current && lastRef.current.value === value && now - lastRef.current.at < 4000)
        return;
      lastRef.current = { value, at: now };
      setBusy(true);
      setView({ kind: "scanning" });
      try {
        const res = await fetch(`/api/v1/organizations/${organizationId}/events/${eventId}/checkins`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-requested-with": "kroov" },
          body: JSON.stringify({ credential: value, device: navigator.userAgent.slice(0, 120) }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          setView({ kind: "offline", message: json?.error?.message ?? `Erreur ${res.status}` });
          return;
        }
        const { data } = (await res.json()) as { data: ScanOutcome };
        setView({ kind: "result", outcome: data });
        setSummary((s) => ({ ...s, admitted: data.counters.admitted, valid: data.counters.valid }));
        if (navigator.vibrate) navigator.vibrate(data.result === "accepted" ? 80 : [60, 60, 60]);
      } catch {
        setView({ kind: "offline", message: "Impossible de joindre le serveur." });
      } finally {
        setBusy(false);
      }
    },
    [busy, organizationId, eventId],
  );

  const refreshSummary = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/events/${eventId}/checkins/summary`, {
        headers: { "x-requested-with": "kroov" },
      });
      if (res.ok) setSummary(((await res.json()) as { data: Summary }).data);
    } catch {
      /* keep the last known counters */
    }
  }, [organizationId, eventId]);

  useEffect(() => {
    if (tab === "journal") void refreshSummary();
  }, [tab, refreshSummary]);

  const stopCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!window.BarcodeDetector) {
      setCameraError("La lecture caméra n'est pas disponible sur ce navigateur : utilisez la saisie manuelle.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError("Caméra refusée ou indisponible. Vous pouvez saisir le code manuellement.");
    }
  }, []);

  useEffect(() => {
    if (!cameraOn || !window.BarcodeDetector) return;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    let active = true;
    const tick = async () => {
      if (!active) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && view.kind !== "scanning") {
        try {
          const codes = await detector.detect(video);
          const first = codes[0]?.rawValue;
          if (first) await scan(first, "camera");
        } catch {
          /* frame skipped */
        }
      }
      if (active) setTimeout(tick, 350);
    };
    void tick();
    return () => {
      active = false;
    };
  }, [cameraOn, scan, view.kind]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const nav = [
    { href: `${base}`, label: "Scanner", icon: "▣", active: tab === "scanner" },
    { href: `${base}?onglet=journal`, label: "Journal", icon: "≡", active: tab === "journal" },
  ];

  return (
    <CheckInShell LinkComponent={Link} context={`${organizationName} · ${userName}`} nav={nav}>
      {tab === "journal" ? (
        <section className="py-5">
          <p className="text-eyebrow font-extrabold uppercase text-muted">{eventTitle}</p>
          <h1 className="mt-2 text-[32px] font-black leading-[1.04] tracking-[-1.2px]">Journal des contrôles</h1>
          <p className="mt-2 text-[13px]">
            Entrées validées <b>{summary.admitted}</b> / {summary.valid} billets valides
          </p>
          <ul className="m-0 mt-4 list-none divide-y divide-border p-0 text-[13px]">
            {summary.recent.length === 0 ? <li className="py-3 text-muted">Aucun contrôle pour l'instant.</li> : null}
            {summary.recent.map((r) => (
              <li key={`${r.at}-${r.number ?? "x"}`} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <b>{r.number ?? "Code inconnu"}</b>
                  {r.attendeeName ? ` · ${r.attendeeName}` : ""}
                  <span className="block text-[11px] text-muted">
                    {fmt(r.at, timezone)} · {r.byName ?? "—"}
                  </span>
                </span>
                <span
                  className={`rounded-[5px] px-2 py-1 text-[10px] font-bold ${r.result === "accepted" ? "bg-lime" : r.result === "already_used" ? "bg-orange" : "bg-error-bg text-error-text"}`}
                >
                  {r.result === "accepted"
                    ? "Entrée"
                    : r.result === "already_used"
                      ? "Déjà passé"
                      : r.result === "invalid"
                        ? "Invalide"
                        : r.result === "refunded"
                          ? "Remboursé"
                          : "Révoqué"}
                </span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="mt-4" onClick={() => void refreshSummary()}>
            Actualiser
          </Button>
        </section>
      ) : view.kind === "result" ? (
        <ResultView outcome={view.outcome} timezone={timezone} onNext={() => setView({ kind: "idle" })} />
      ) : view.kind === "offline" ? (
        <section className="py-5">
          <div className="rounded-[14px] bg-lavender p-6">
            <p className="text-[28px]" aria-hidden="true">
              ↯
            </p>
            <p className="text-eyebrow font-extrabold uppercase">Contrôle suspendu</p>
            <h1 className="mt-2 text-[32px] font-black leading-[1.04] tracking-[-1.2px]">
              La connexion fait une pause.
            </h1>
          </div>
          <p className="mt-4 rounded-[9px] bg-orange px-3 py-2 text-[13px]">
            Impossible de vérifier si ce billet a déjà été utilisé. Aucune entrée n'a été enregistrée. ({view.message})
          </p>
          <div className="mt-4 rounded-[14px] border border-border bg-surface p-4 text-[13px]">
            <b>Pour reprendre le contrôle</b>
            <ol className="m-0 mt-2 pl-5">
              <li>Vérifiez le réseau ou le Wi-Fi.</li>
              <li>Réessayez la connexion.</li>
              <li>Scannez à nouveau le billet.</li>
            </ol>
          </div>
          <Button variant="primary" className="mt-4 w-full" onClick={() => setView({ kind: "idle" })}>
            Réessayer la connexion
          </Button>
        </section>
      ) : (
        <section className="py-5">
          <p className="text-eyebrow font-extrabold uppercase text-muted">{eventTitle}</p>
          <h1 className="mt-2 text-[32px] font-black leading-[1.04] tracking-[-1.2px]">Bienvenue à l'entrée.</h1>
          <p className="mt-1 text-[13px] text-muted">Connecté en tant que {userName} · Contrôle d'accès</p>
          <div className="relative mt-4 overflow-hidden rounded-[14px] bg-ink" style={{ aspectRatio: "4 / 3" }}>
            <video ref={videoRef} className={`size-full object-cover ${cameraOn ? "" : "hidden"}`} playsInline muted />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="size-[60%] rounded-[12px] border-4 border-lime" aria-hidden="true" />
            </div>
            <p className="absolute inset-x-0 bottom-3 text-center text-[11px] text-white">
              {cameraOn
                ? "Placez le QR code dans le cadre"
                : view.kind === "scanning"
                  ? "Vérification…"
                  : "Caméra inactive"}
            </p>
          </div>
          <p className="mt-3 flex justify-between text-[13px]">
            <span>Entrées validées</span>
            <b>
              {summary.admitted} / {summary.valid}
            </b>
          </p>
          {cameraError ? <p className="mt-2 rounded-[9px] bg-orange px-3 py-2 text-[12px]">{cameraError}</p> : null}
          <div className="mt-3 grid gap-2">
            {cameraOn ? (
              <Button variant="secondary" onClick={stopCamera}>
                Couper la caméra
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void startCamera()}>
                Activer la caméra
              </Button>
            )}
            <form
              className="grid grid-cols-[1fr_auto] gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void scan(manual);
                setManual("");
              }}
            >
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Saisir un code manuellement"
                aria-label="Code du billet"
                autoComplete="off"
                autoCapitalize="off"
              />
              <Button type="submit" variant="secondary" loading={busy} loadingLabel="Vérification">
                Valider
              </Button>
            </form>
          </div>
          <p className="mt-3 rounded-[9px] bg-lavender px-3 py-2 text-[12px]">
            Connexion active · Contrôle en ligne uniquement.
          </p>
          <p className="mt-1 text-[11px] text-muted">Accès limité aux billets de cet événement.</p>
        </section>
      )}
    </CheckInShell>
  );
}

function ResultView({ outcome, timezone, onNext }: { outcome: ScanOutcome; timezone: string; onNext: () => void }) {
  const r = outcome.result;
  const banner =
    r === "accepted"
      ? {
          bg: "bg-lime",
          icon: "✓",
          eyebrow: "Entrée autorisée",
          title: `Bonne soirée${outcome.ticket?.attendeeName ? `, ${outcome.ticket.attendeeName.split(" ")[0]}` : ""} !`,
        }
      : r === "already_used"
        ? { bg: "bg-orange", icon: "!", eyebrow: "Entrée non validée", title: "Ce billet est déjà passé." }
        : r === "refunded"
          ? {
              bg: "bg-error-bg text-error-text",
              icon: "✕",
              eyebrow: "Entrée refusée",
              title: "Ce billet a été remboursé.",
            }
          : r === "revoked"
            ? {
                bg: "bg-error-bg text-error-text",
                icon: "✕",
                eyebrow: "Entrée refusée",
                title: "Ce billet n'est pas valide.",
              }
            : {
                bg: "bg-error-bg text-error-text",
                icon: "?",
                eyebrow: "Code inconnu",
                title: "Ce code ne correspond à aucun billet de cet événement.",
              };
  return (
    <section className="py-5" aria-live="polite">
      <div className={`rounded-[14px] p-6 ${banner.bg}`}>
        <p className="text-[36px] font-black" aria-hidden="true">
          {banner.icon}
        </p>
        <p className="text-eyebrow font-extrabold uppercase">{banner.eyebrow}</p>
        <h1 className="mt-2 text-[32px] font-black leading-[1.04] tracking-[-1.2px]">{banner.title}</h1>
      </div>
      {outcome.ticket ? (
        <dl className="m-0 mt-4 divide-y divide-border rounded-[14px] border border-border bg-surface px-4 text-[13px]">
          <div className="flex justify-between py-2">
            <dt className="text-muted">Participant</dt>
            <dd className="m-0 font-bold">{outcome.ticket.attendeeName ?? "—"}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-muted">Tarif</dt>
            <dd className="m-0 font-bold">{outcome.ticket.typeLabel}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-muted">Référence</dt>
            <dd className="m-0 font-bold">{outcome.ticket.number}</dd>
          </div>
          {r === "accepted" ? (
            <div className="flex justify-between py-2">
              <dt className="text-muted">Entrée enregistrée</dt>
              <dd className="m-0 font-bold">{fmt(outcome.scannedAt, timezone)}</dd>
            </div>
          ) : null}
          {r === "already_used" && outcome.firstScan ? (
            <>
              <div className="flex justify-between py-2">
                <dt className="text-muted">Premier passage</dt>
                <dd className="m-0 font-bold">{fmt(outcome.firstScan.at, timezone)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted">Contrôlé par</dt>
                <dd className="m-0 font-bold">{outcome.firstScan.byName ?? "—"}</dd>
              </div>
            </>
          ) : null}
        </dl>
      ) : null}
      {r === "already_used" ? (
        <p className="mt-3 rounded-[9px] bg-orange px-3 py-2 text-[13px]">
          N'enregistrez pas une seconde entrée. Adressez-vous au responsable en cas de litige.
        </p>
      ) : null}
      <Button variant="primary" className="mt-4 w-full" onClick={onNext} autoFocus>
        {r === "accepted" ? "Scanner le billet suivant →" : "Scanner un autre billet →"}
      </Button>
      <p className="mt-2 text-center text-[11px] text-muted">
        Entrées validées {outcome.counters.admitted} / {outcome.counters.valid} · Validation synchronisée avec
        l'événement.
      </p>
    </section>
  );
}
