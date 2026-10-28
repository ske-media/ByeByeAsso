"use client";

import { Alert, Button, FormField, Input, Panel, Select, Textarea } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PublicPosition {
  id: string;
  name: string;
  teamName: string;
  description: string | null;
  minAge: number | null;
  skills: Array<{ skillId: string; name: string; mandatory: boolean }>;
  shiftsLabel: string;
}
export interface PublicSkill {
  id: string;
  name: string;
  requiresVerification: boolean;
}
export interface PublicQuestion {
  key: string;
  label: string;
  helpText: string | null;
  type: "short_text" | "long_text" | "single_choice" | "checkbox";
  required: boolean;
  options: string[];
}
interface Range {
  uid: string;
  kind: "available" | "unavailable";
  startsDate: string;
  startsTime: string;
  endsDate: string;
  endsTime: string;
}

/** Écrans 37 + 38 — candidature en deux étapes : profil et vœux, puis disponibilités et binôme. */
export function ApplyForm({
  organizationSlug,
  eventSlug,
  positions,
  skills,
  questions,
  defaults,
  eventDays,
  timezone,
}: {
  organizationSlug: string;
  eventSlug: string;
  positions: PublicPosition[];
  skills: PublicSkill[];
  questions: PublicQuestion[];
  defaults: { email: string; firstName: string; lastName: string };
  /** Pre-filled suggestion for the first availability range (event day, local wall clock). */
  eventDays: { startsDate: string; startsTime: string; endsDate: string; endsTime: string };
  timezone: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState(defaults.email);
  const [firstName, setFirstName] = useState(defaults.firstName);
  const [lastName, setLastName] = useState(defaults.lastName);
  const [phone, setPhone] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [motivation, setMotivation] = useState("");
  const [experience, setExperience] = useState("");
  const [prefs, setPrefs] = useState<string[]>([]);
  const [declared, setDeclared] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [ranges, setRanges] = useState<Range[]>([{ uid: "r1", kind: "available", ...eventDays }]);
  const [buddies, setBuddies] = useState<Array<{ uid: string; email: string }>>([{ uid: "b1", email: "" }]);
  const [constraints, setConstraints] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);

  const togglePref = (id: string) => setPrefs((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const move = (id: string, dir: -1 | 1) =>
    setPrefs((p) => {
      const i = p.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const n = [...p];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const updateRange = (uid: string, patch: Partial<Range>) =>
    setRanges((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const goStep2 = () => {
    const errs: Record<string, string[]> = {};
    if (!firstName.trim() || !lastName.trim() || !email.trim())
      errs.identity = ["Prénom, nom et e-mail sont nécessaires."];
    if (prefs.length === 0) errs.positionPreferences = ["Choisissez au moins un poste."];
    for (const q of questions) {
      const v = answers[q.key];
      if (q.required && (v === undefined || v === "" || v === false))
        errs[`answers.${q.key}`] = ["Réponse obligatoire."];
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError("Complétez les champs signalés avant de continuer.");
      return;
    }
    setError(null);
    setStep(2);
    window.scrollTo({ top: 0 });
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const body = {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        birthYear: birthYear ? Number(birthYear) : undefined,
        motivation: motivation.trim() || undefined,
        experience: experience.trim() || undefined,
        positionPreferences: prefs,
        availabilities: ranges.map((r) => ({
          kind: r.kind,
          startsAt: localToIso(r.startsDate, r.startsTime, timezone),
          endsAt: localToIso(r.endsDate, r.endsTime, timezone),
        })),
        skills: declared.map((skillId) => ({ skillId })),
        buddies: buddies.map((b) => b.email.trim().toLowerCase()).filter(Boolean),
        constraints: constraints.trim() || undefined,
        marketingOptIn: optIn,
        answers,
      };
      const res = await fetch(
        `/api/v1/public/organizations/${organizationSlug}/events/${eventSlug}/volunteer-applications`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-requested-with": "kroov" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as {
        data?: { id: string; accessToken: string };
        error?: { message?: string; fieldErrors?: Record<string, string[]> };
      };
      if (!res.ok || !json.data) {
        setFieldErrors(json.error?.fieldErrors ?? {});
        setError(json.error?.message ?? "Impossible d'envoyer la candidature pour l'instant.");
        if (
          json.error?.fieldErrors &&
          Object.keys(json.error.fieldErrors).some((k) => k !== "availabilities" && k !== "buddies")
        )
          setStep(1);
        return;
      }
      router.push(`/candidature/${json.data.id}?k=${encodeURIComponent(json.data.accessToken)}&nouveau=1`);
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    } finally {
      setPending(false);
    }
  };

  const err = (k: string) => fieldErrors[k];

  if (step === 1) {
    return (
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          goStep2();
        }}
      >
        <p className="text-[12px] text-muted">1. Vous et vos vœux → 2. Disponibilités et binôme</p>
        <Panel>
          <h2 className="text-panel-title font-bold">Vous</h2>
          {err("identity") ? <p className="text-[12px] text-error-text">{err("identity")?.join(" ")}</p> : null}
          <div className="mt-2 grid gap-x-3 sm:grid-cols-2">
            <FormField label="Prénom" required error={err("firstName")}>
              <Input
                name="firstName"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </FormField>
            <FormField label="Nom" required error={err("lastName")}>
              <Input
                name="lastName"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </FormField>
            <FormField
              label="E-mail"
              required
              hint="Le suivi de votre candidature arrive à cette adresse."
              error={err("email")}
            >
              <Input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
            <FormField label="Téléphone" error={err("phone")}>
              <Input name="phone" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
            <FormField label="Année de naissance" hint="Certains postes ont un âge minimum." error={err("birthYear")}>
              <Input
                name="birthYear"
                inputMode="numeric"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                placeholder="1998"
              />
            </FormField>
          </div>
          <FormField label="Pourquoi vous ?" error={err("motivation")}>
            <Textarea
              name="motivation"
              rows={3}
              maxLength={2000}
              value={motivation}
              onChange={(e) => setMotivation(e.target.value)}
              placeholder="Ce qui vous donne envie d'aider…"
            />
          </FormField>
          <FormField label="Expérience et qualifications" error={err("experience")}>
            <Textarea
              name="experience"
              rows={2}
              maxLength={2000}
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              placeholder="Festivals, associations, diplômes…"
            />
          </FormField>
        </Panel>

        <Panel>
          <h2 className="text-panel-title font-bold">Vos vœux de postes</h2>
          <p className="text-[12px] text-muted">
            Cochez les postes qui vous tentent, puis ordonnez-les : le premier est votre préféré.
          </p>
          {err("positionPreferences") ? (
            <p className="text-[12px] text-error-text">{err("positionPreferences")?.join(" ")}</p>
          ) : null}
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {positions.map((p) => {
              const i = prefs.indexOf(p.id);
              return (
                <li key={p.id}>
                  <label className="block cursor-pointer">
                    <input type="checkbox" checked={i >= 0} onChange={() => togglePref(p.id)} className="k-sr-only" />
                    <Panel className={i >= 0 ? "border-ink bg-[#fbffe0]" : ""}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="m-0 text-[14px] font-bold">
                            {i >= 0 ? `${i + 1}. ` : ""}
                            {p.name} <span className="text-[11px] font-normal text-muted">· {p.teamName}</span>
                          </h3>
                          {p.description ? <p className="mt-1 text-[12px] text-muted">{p.description}</p> : null}
                          <p className="mt-1 text-[11px] text-muted">
                            {p.shiftsLabel}
                            {p.minAge ? ` · ${p.minAge} ans minimum` : ""}
                            {p.skills.length > 0
                              ? ` · ${p.skills.map((s) => `${s.name}${s.mandatory ? " (requis)" : ""}`).join(", ")}`
                              : ""}
                          </p>
                        </div>
                        <span
                          aria-hidden="true"
                          className={`mt-1 size-5 shrink-0 rounded-[5px] border-[2px] border-ink ${i >= 0 ? "bg-ink" : ""}`}
                        />
                      </div>
                      {i >= 0 ? (
                        <div className="mt-2 flex gap-2 text-[12px]">
                          <button
                            type="button"
                            className="underline"
                            disabled={i === 0}
                            onClick={(e) => {
                              e.preventDefault();
                              move(p.id, -1);
                            }}
                          >
                            ↑ Monter
                          </button>
                          <button
                            type="button"
                            className="underline"
                            disabled={i === prefs.length - 1}
                            onClick={(e) => {
                              e.preventDefault();
                              move(p.id, 1);
                            }}
                          >
                            ↓ Descendre
                          </button>
                        </div>
                      ) : null}
                    </Panel>
                  </label>
                </li>
              );
            })}
          </ul>
        </Panel>

        {skills.length > 0 ? (
          <Panel>
            <h2 className="text-panel-title font-bold">Vos compétences</h2>
            <p className="text-[12px] text-muted">
              Déclaratif : l'équipe peut demander un justificatif pour celles marquées « à vérifier ».
            </p>
            <ul className="m-0 mt-2 list-none space-y-1 p-0">
              {skills.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 py-1 text-[13px]">
                    <input
                      type="checkbox"
                      checked={declared.includes(s.id)}
                      onChange={() =>
                        setDeclared((d) => (d.includes(s.id) ? d.filter((x) => x !== s.id) : [...d, s.id]))
                      }
                      className="size-4 accent-ink"
                    />
                    {s.name}
                    {s.requiresVerification ? <span className="text-[11px] text-muted">(à vérifier)</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {questions.length > 0 ? (
          <Panel>
            <h2 className="text-panel-title font-bold">Quelques questions</h2>
            {questions.map((q) => (
              <FormField
                key={q.key}
                label={q.label}
                required={q.required}
                hint={q.helpText ?? undefined}
                error={err(`answers.${q.key}`)}
              >
                {q.type === "checkbox" ? (
                  <label className="flex items-center gap-2 py-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={answers[q.key] === true}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.checked }))}
                      className="size-4 accent-ink"
                    />
                    Oui
                  </label>
                ) : q.type === "single_choice" ? (
                  <Select
                    value={String(answers[q.key] ?? "")}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                  >
                    <option value="">Choisir…</option>
                    {q.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : q.type === "long_text" ? (
                  <Textarea
                    rows={3}
                    maxLength={2000}
                    value={String(answers[q.key] ?? "")}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                  />
                ) : (
                  <Input
                    value={String(answers[q.key] ?? "")}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                  />
                )}
              </FormField>
            ))}
          </Panel>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" variant="primary" className="w-full">
          Continuer : mes disponibilités →
        </Button>
        <p className="text-center text-[11px] text-muted">
          Sans créer de compte. Vos notes restent entre vous et l'organisation.
        </p>
      </form>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-[12px] text-muted">1. Vous et vos vœux → 2. Disponibilités et binôme</p>
      <Panel>
        <h2 className="text-panel-title font-bold">Vos disponibilités</h2>
        <p className="text-[12px] text-muted">
          Indiquez les plages où vous pouvez être là (de la veille au lendemain de l'événement, montage et démontage
          compris). Ajoutez une indisponibilité pour une pause ou un départ obligatoire.
        </p>
        {err("availabilities") ? (
          <p className="mt-1 text-[12px] text-error-text">{err("availabilities")?.join(" ")}</p>
        ) : null}
        <ul className="m-0 mt-2 list-none space-y-2 p-0">
          {ranges.map((r) => (
            <li key={r.uid} className="rounded-[9px] border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Select
                  value={r.kind}
                  onChange={(e) => updateRange(r.uid, { kind: e.target.value as Range["kind"] })}
                  aria-label="Type de plage"
                  className="max-w-[200px]"
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
                <FormField label="Du" required>
                  <Input
                    type="date"
                    value={r.startsDate}
                    onChange={(e) => updateRange(r.uid, { startsDate: e.target.value })}
                    aria-label="Date de début"
                  />
                </FormField>
                <FormField label="à" required>
                  <Input
                    type="time"
                    value={r.startsTime}
                    onChange={(e) => updateRange(r.uid, { startsTime: e.target.value })}
                    aria-label="Heure de début"
                  />
                </FormField>
                <FormField label="Jusqu'au" required>
                  <Input
                    type="date"
                    value={r.endsDate}
                    onChange={(e) => updateRange(r.uid, { endsDate: e.target.value })}
                    aria-label="Date de fin"
                  />
                </FormField>
                <FormField label="à" required>
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
        {ranges.length < 12 ? (
          <Button
            type="button"
            variant="ghost"
            className="mt-2 min-h-9 text-[12px]"
            onClick={() => setRanges((rs) => [...rs, { uid: `r${Date.now()}`, kind: "unavailable", ...eventDays }])}
          >
            + Ajouter une plage
          </Button>
        ) : null}
      </Panel>

      <Panel>
        <h2 className="text-panel-title font-bold">Un binôme ?</h2>
        <p className="text-[12px] text-muted">
          Indiquez l'e-mail d'une personne avec qui vous aimeriez être placé·e. Elle recevra une invitation à candidater
          ; si elle vous indique aussi, l'équipe essaiera de vous mettre ensemble (sans garantie). Rien d'autre ne lui
          est communiqué.
        </p>
        {err("buddies") ? <p className="mt-1 text-[12px] text-error-text">{err("buddies")?.join(" ")}</p> : null}
        {buddies.map((b, i) => (
          <FormField key={b.uid} label={`E-mail du binôme${buddies.length > 1 ? ` ${i + 1}` : ""}`}>
            <Input
              type="email"
              value={b.email}
              onChange={(e) =>
                setBuddies((bs) => bs.map((x) => (x.uid === b.uid ? { ...x, email: e.target.value } : x)))
              }
              placeholder="prenom@exemple.fr"
            />
          </FormField>
        ))}
        {buddies.length < 3 ? (
          <button
            type="button"
            className="text-[12px] underline"
            onClick={() => setBuddies((bs) => [...bs, { uid: `b${Date.now()}`, email: "" }])}
          >
            + Un autre binôme
          </button>
        ) : null}
      </Panel>

      <Panel>
        <h2 className="text-panel-title font-bold">Contraintes (facultatif)</h2>
        <FormField label="À savoir pour vous placer" error={err("constraints")}>
          <Textarea
            rows={2}
            maxLength={1000}
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder="Dernier métro à 1 h, pas de port de charges…"
          />
        </FormField>
        <label className="flex items-start gap-2 py-2 text-[13px]">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="mt-1 size-4 accent-ink"
          />
          <span>J'accepte de recevoir les actualités de l'organisation (facultatif).</span>
        </label>
      </Panel>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => setStep(1)}>
          ← Retour
        </Button>
        <Button type="submit" variant="primary" className="flex-1" loading={pending} loadingLabel="Envoi">
          Envoyer ma candidature
        </Button>
      </div>
    </form>
  );
}

/** Wall-clock "YYYY-MM-DD" + "HH:MM" in `timeZone` → ISO instant. Mirrors the server's parseLocalDateTime. */
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
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return (asUtc - instant) / 60_000;
  };
  let guess = naive - offset(naive) * 60_000;
  guess = naive - offset(guess) * 60_000;
  return new Date(guess).toISOString();
}
