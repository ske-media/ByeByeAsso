# ADR-005 — Port de paiement et Stripe Connect

Statut : proposé (mise en œuvre phase 3) · 27 octobre 2026

## Décision

- Le domaine ne connaît que `PaymentProviderPort` (`packages/payments`). Stripe Connect (comptes connectés des organisateurs, frais de plateforme) est l'adaptateur cible ; un adaptateur sandbox déterministe sert aux tests.
- **Aucun billet n'est émis sur une redirection de succès.** Seuls un webhook signé et vérifié **ou** une relecture serveur de l'état du paiement font foi.
- Les webhooks sont idempotents (`payment_webhook_events` + `idempotency_records`), tolèrent le désordre (réconciliation sur l'état fournisseur, pas sur l'ordre d'arrivée) et les doublons.
- Les montants, frais et totaux sont recalculés côté serveur ; le client n'envoie que des identifiants et des quantités.
- La politique de frais (acheteur / organisateur), la TVA et les remboursements partiels sont des **paramètres** et des arbitrages produit à confirmer ; les valeurs du kit UX (2 % organisateur, 1,20 € par billet acheteur) ne sont que des données de démonstration.

## Conséquences

- Phase 3 doit prouver par tests : dernier billet concurrent, réservation expirée, webhook dupliqué, webhook hors ordre, succès tardif, double clic, compte déconnecté, panne fournisseur.
