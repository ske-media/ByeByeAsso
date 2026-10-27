import {
  Alert,
  Badge,
  Button,
  colors,
  EmptyState,
  ErrorState,
  ForbiddenState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Panel,
  PanelTitle,
  PasswordInput,
  STATUS_BADGES,
  Stat,
  StatGrid,
  StatusBadge,
  Wordmark,
} from "@kroov/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemShell } from "./shell";

export const metadata: Metadata = { title: "Système de design" };

/**
 * DEVELOPMENT-ONLY reference page. Returns 404 in production: it contains static
 * demonstration values (the UX kit scenario) that must never be mistaken for live data.
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <DesignSystemShell>
      <PageHeader
        eyebrow="Kroov · Système de design · Phase 0"
        title="Fondation visuelle"
        description="Tokens, composants de base et états système. Toutes les valeurs ci-dessous sont des données de démonstration."
        actions={<Button variant="primary">Action principale</Button>}
      />

      <Alert tone="warning" heading="Page de développement">
        Cette page n'est pas servie en production. Elle sert de référence visuelle et d'outil de vérification manuelle
        (clavier, contraste, 320 px).
      </Alert>

      <section aria-labelledby="ds-couleurs" className="mt-8">
        <h2 id="ds-couleurs" className="text-section-title font-black">
          Couleurs
        </h2>
        <ul className="mt-4 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(colors).map(([name, hex]) => (
            <li key={name} className="rounded-panel border border-border bg-surface p-3">
              <span
                className="block h-12 rounded-control border border-border"
                style={{ background: hex }}
                aria-hidden="true"
              />
              <span className="mt-2 block text-[12px] font-bold">{name}</span>
              <span className="block text-meta text-muted">{hex}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ds-typo" className="mt-10">
        <h2 id="ds-typo" className="text-section-title font-black">
          Typographie et marque
        </h2>
        <Panel className="mt-4 space-y-4">
          <Wordmark />
          <p className="text-page-title font-black">Titre de page 43 px</p>
          <p className="text-section-title font-black">Titre de section 27 px</p>
          <p className="text-panel-title font-bold">Titre de panneau 17 px</p>
          <p>Texte courant 14 px / 1,45 — jamais tout en capitales dans les paragraphes.</p>
          <p className="text-meta text-muted">Métadonnée 12 px : ne pas y placer une information essentielle isolée.</p>
        </Panel>
      </section>

      <section aria-labelledby="ds-stats" className="mt-10">
        <h2 id="ds-stats" className="text-section-title font-black">
          Indicateurs
        </h2>
        <StatGrid className="mt-4">
          <Stat tone="lime" label="Billets vendus" value="624" hint="Sur 900 places · événement à venir" />
          <Stat label="Recettes billetterie" value="15 840" unit="€" hint="Montant brut · hors remboursements" />
          <Stat tone="pink" label="Bénévoles acceptés" value="32 / 36" hint="4 personnes à recruter" />
          <Stat tone="lavender" label="Adhésions actives" value="128" hint="À votre organisation · saison 2027" />
        </StatGrid>
        <StatGrid className="mt-4">
          <Stat label="Valeur inconnue" loading hint="Un skeleton, jamais un faux « 0 »" />
        </StatGrid>
      </section>

      <section aria-labelledby="ds-boutons" className="mt-10">
        <h2 id="ds-boutons" className="text-section-title font-black">
          Boutons
        </h2>
        <Panel className="mt-4 flex flex-wrap gap-3">
          <Button variant="primary">Créer un événement</Button>
          <Button variant="secondary">Gérer l'événement</Button>
          <Button variant="solid">Enregistrer</Button>
          <Button variant="danger">Annuler l'événement</Button>
          <Button variant="ghost">Action discrète</Button>
          <Button variant="primary" loading loadingLabel="Publication en cours">
            Publier le planning V4
          </Button>
          <Button variant="primary" disabled disabledReason="Complétez les champs obligatoires avant de publier.">
            Publier
          </Button>
        </Panel>
      </section>

      <section aria-labelledby="ds-badges" className="mt-10">
        <h2 id="ds-badges" className="text-section-title font-black">
          Statuts
        </h2>
        <Panel className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(STATUS_BADGES) as Array<keyof typeof STATUS_BADGES>).map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
          <Badge tone="outline">Contour</Badge>
        </Panel>
      </section>

      <section aria-labelledby="ds-form" className="mt-10">
        <h2 id="ds-form" className="text-section-title font-black">
          Formulaire
        </h2>
        <Panel className="mt-4 max-w-[480px]">
          <PanelTitle>Se connecter</PanelTitle>
          <form action="#" method="post">
            <FormField label="Adresse e-mail" required hint="Nous ne révélons jamais si une adresse existe.">
              <Input type="email" name="email" autoComplete="email" inputMode="email" />
            </FormField>
            <FormField
              label="Mot de passe"
              required
              error="Le mot de passe saisi est incorrect. Votre saisie est conservée."
            >
              <PasswordInput name="password" defaultValue="exemple" />
            </FormField>
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled
              disabledReason="Formulaire de démonstration : aucune action réelle."
            >
              Se connecter
            </Button>
          </form>
        </Panel>
      </section>

      <section aria-labelledby="ds-etats" className="mt-10 space-y-4">
        <h2 id="ds-etats" className="text-section-title font-black">
          États système
        </h2>
        <LoadingState label="Chargement des événements" rows={2} />
        <EmptyState
          title="Aucun événement pour le moment"
          description="Créez votre premier événement pour commencer à vendre des billets et recruter des bénévoles."
          action={<Button variant="primary">Créer un événement</Button>}
        />
        <ErrorState description="Le serveur n'a pas répondu. Vos filtres sont conservés ; réessayez dans quelques instants." />
        <ForbiddenState />
        <Alert tone="success" heading="Planning V4 publié">
          36 bénévoles ont été notifiés. Les missions modifiées sont identifiées dans la notification.
        </Alert>
        <Alert tone="error" heading="Paiement refusé">
          Votre banque a refusé la transaction. Votre réservation reste valide 6 minutes ; aucun montant n'a été
          prélevé.
        </Alert>
      </section>
    </DesignSystemShell>
  );
}
