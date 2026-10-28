"use client";

import { Alert, Button, ConfirmDialog, FormField, Input, Panel, Select, Textarea } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Range {
  uid: string;
  kind: "available" | "unavailable";
  startsDate: string;
  startsTime: string;
  endsDate: string;
  endsTime: string;
}

/** Écran 39 — modifier vœux, disponibilités, binôme ; retirer la candidature. */
export function TrackingActions({
  applicationId,
  accessToken,
  editable,
  status,
  timezone,
  positions,
  initialPrefs,
  initialRanges,
  initialBuddies,
  initialConstraints,
}: {
  applicationId: string;
  accessToken: string;
  editable: boolean;
  status: string;
  timezone: string;
  positions: Array<{ id: string; name: string }>;
  initialPrefs: string[];
  initialRanges: Range[];
  initialBuddies: string[];
  initialConstraints: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [ranges, setRanges] = useState<Range[]>(initialRanges);
  const [buddies, setBuddies] = useState<Array<{ uid: string; email: string }>>(
    initialBuddies.length > 0
      ? initialBuddies.map((email, i) => ({ uid: `b${i}`, email }))
      : [{ uid: "b0", email: "" }],
  );
  const [constraints, setConstraints] = useState(initialConstraints);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const headers = { "content-type": "application/json", "x-requested-with": "kroov" };
  const q = `?k=${encodeURIComponent(accessToken)}`;

  const save = async () => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/public/volunteer-applications/${applicationId}${q}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          positionPreferences: prefs,
          availabilities: ranges.map((r) => ({
            kind: r.kind,
            startsAt: localToIso(r.startsDate, r.startsTime, timezone),
            endsAt: localToIso(r.endsDate, r.endsTime, timezone),
          })),
          buddies: buddies.map((b) => b.email.trim().toLowerCase()).filter(Boolean),
          constraints: constraints.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { error?: { message?: string; fieldErrors?: Record<string, string[]> } };
      if (!res.ok) {
        const fe = json.error?.fieldErrors ? Object.values(json.error.fieldErrors).flat().join(" ") : "";
        setMessage({ tone: "error", text: fe || json.error?.message || "Modification impossible." });
        return;
      }
      setMessage({ tone: "success", text: "Candidature mise à jour." });
      setEditing(false);
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Connexion impossible. Réessayez." });
    } finally {
      setPending(false);
    }
  };

  const withdraw = async () => {
    setPending(true);
    try {
      const res = await fetch(`/api/v1/public/volunteer-applications/${applicationId}/withdraw${q}`, {
        method: "POST",
        headers,
        body: "{}",
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        setMessage({ tone: "error", text: json.error?.message ?? "Retrait impossible." });
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const updateRange = (uid: string, patch: Partial<Range>) =>
    setRanges((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  if (!editable) return message ? <Alert tone={message.tone}>{message.text}</Alert> : null;
  return (
    <div className="space-y-3">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Modifier mes vœux et disponibilités
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="text-bordeaux">
                Retirer ma candidature
              </Button>
            }
            title="Retirer votre candidature ?"
            description={
              status === "approved"
                ? "Votre candidature a été acceptée : la retirer libère votre place, et l'équipe en est informée. C'est définitif ; vous pourrez candidater à nouveau tant que le recrutement est ouvert."
                : "C'est définitif ; vous pourrez candidater à nouveau tant que le recrutement est ouvert."
            }
            confirmLabel="Retirer"
            destructive
            pending={pending}
            onConfirm={withdraw}
          />
        </div>
      ) : (
        <Panel>
          <h2 className="text-panel-title font-bold">Modifier</h2>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-[12px] font-bold">Vœux de postes (ordre)</legend>
            <ol className="m-0 list-none space-y-1 p-0 text-[13px]">
              {prefs.map((id, i) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="w-5 text-muted">{i + 1}.</span>
                  <span className="flex-1">{positions.find((p) => p.id === id)?.name ?? "Poste retiré"}</span>
                  <button
                    type="button"
                    className="text-[12px] underline"
                    disabled={i === 0}
                    onClick={() =>
                      setPrefs((p) => {
                        const n = [...p];
                        [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                        return n;
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="text-[12px] underline"
                    onClick={() => setPrefs((p) => p.filter((x) => x !== id))}
                  >
                    Retirer
                  </button>
                </li>
              ))}
            </ol>
            {positions.some((p) => !prefs.includes(p.id)) ? (
              <Select
                aria-label="Ajouter un vœu"
                value=""
                onChange={(e) => e.target.value && setPrefs((p) => [...p, e.target.value])}
                className="mt-2"
              >
                <option value="">+ Ajouter un poste…</option>
                {positions
                  .filter((p) => !prefs.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            ) : null}
          </fieldset>
          <fieldset className="m-0 mt-4 border-0 p-0">
            <legend className="mb-1 text-[12px] font-bold">Disponibilités</legend>
            <ul className="m-0 list-none space-y-2 p-0">
              {ranges.map((r) => (
                <li key={r.uid} className="rounded-[9px] border border-border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <Select
                      value={r.kind}
                      onChange={(e) => updateRange(r.uid, { kind: e.target.value as Range["kind"] })}
                      aria-label="Type"
                      className="max-w-[180px]"
                    >
                      <option value="available">Disponible</option>
                      <option value="unavailable">Indisponible</option>
                    </Select>
                    {ranges.length > 1 ? (
                      <button
                        type="button"
                        className="text-[12px] underline"
                        onClick={() => setRanges((rs) => rs.filter((x) => x.uid !== r.uid))}
                      >
                        Retirer
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3">
                    <FormField label="Du" className="mb-2">
                      <Input
                        type="date"
                        value={r.startsDate}
                        onChange={(e) => updateRange(r.uid, { startsDate: e.target.value })}
                        aria-label="Date de début"
                      />
                    </FormField>
                    <FormField label="à" className="mb-2">
                      <Input
                        type="time"
                        value={r.startsTime}
                        onChange={(e) => updateRange(r.uid, { startsTime: e.target.value })}
                        aria-label="Heure de début"
                      />
                    </FormField>
                    <FormField label="Jusqu'au" className="mb-2">
                      <Input
                        type="date"
                        value={r.endsDate}
                        onChange={(e) => updateRange(r.uid, { endsDate: e.target.value })}
                        aria-label="Date de fin"
                      />
                    </FormField>
                    <FormField label="à" className="mb-2">
                      <Input
                        type="time"
                        value={r.endsTime}
                        onChange={(e) => updateRange(r.uid, { endsTime: e.target.value })}
                        aria-label="Heure de fin"
                      />
                    </FormField>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-2 text-[12px] underline"
              onClick={() =>
                setRanges((rs) => [
                  ...rs,
                  {
                    ...(rs[0] ?? { startsDate: "", startsTime: "18:00", endsDate: "", endsTime: "23:00" }),
                    uid: `r${Date.now()}`,
                    kind: "unavailable",
                  },
                ])
              }
            >
              + Ajouter une plage
            </button>
          </fieldset>
          <fieldset className="m-0 mt-4 border-0 p-0">
            <legend className="mb-1 text-[12px] font-bold">Binôme</legend>
            {buddies.map((b, i) => (
              <FormField
                key={b.uid}
                label={`E-mail du binôme${buddies.length > 1 ? ` ${i + 1}` : ""}`}
                className="mb-2"
              >
                <Input
                  type="email"
                  value={b.email}
                  onChange={(e) =>
                    setBuddies((bs) => bs.map((x) => (x.uid === b.uid ? { ...x, email: e.target.value } : x)))
                  }
                />
              </FormField>
            ))}
          </fieldset>
          <FormField label="Contraintes" className="mt-4">
            <Textarea rows={2} maxLength={1000} value={constraints} onChange={(e) => setConstraints(e.target.value)} />
          </FormField>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Annuler
            </Button>
            <Button variant="primary" loading={pending} loadingLabel="Enregistrement" onClick={() => void save()}>
              Enregistrer
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function localToIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined) return "";
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(instant));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - instant) / 60_000;
  };
  let guess = naive - offset(naive) * 60_000;
  guess = naive - offset(guess) * 60_000;
  return new Date(guess).toISOString();
}
