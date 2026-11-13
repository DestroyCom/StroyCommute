# Changelog

Les changements visibles de StroyCommute, version par version. Ajoutez
chaque changement sous `[Unreleased]`, en une phrase écrite pour les
utilisateurs, dans la bonne rubrique (Nouveautés, Améliorations,
Corrections). Le workflow Release déplace cette section sous le numéro de
la nouvelle version et en fait les notes de la release GitHub, avec une
version texte à coller dans le store.

## [Unreleased]

### Nouveautés

- Tes prochains départs peuvent s'afficher sur les cadrans compatibles avec les plugins Pebble (aperçu à activer dans l'app Pebble), avec une consommation de quota limitée. Réglage « Cadrans » pour le désactiver.
- Compatible avec la Pebble Round 2 : mise en page adaptée à l'écran rond.
- Vibration à l'approche du train, au choix de 1 à 10 minutes avant le départ (réglage « Vibration », désactivé par défaut).
- La montre indique quand le téléphone est déconnecté, tout en gardant les derniers horaires affichés.
- Section **Diagnostic** dans les réglages : les erreurs rencontrées par l'app sont enregistrées et peuvent être copiées pour les envoyer au développeur.

### Améliorations

- Une erreur inattendue ne ferme plus l'application : elle est enregistrée et l'app continue de fonctionner.
- Compatibilité avec les dernières versions de l'app Pebble : les accès réseau à PRIM et à la recherche d'arrêts IDFM sont déclarés.
- Affichage plus léger sur la montre : l'écran n'est plus redessiné entièrement à chaque mise à jour, ce qui économise mémoire et batterie.
- Moins d'appels à l'API PRIM : une même demande faite plusieurs fois en quelques secondes ne coûte plus qu'un appel sur ton quota.
- Les minutes avant le départ se mettent à jour toutes seules chaque minute, et le train suivant prend le relais quand le premier est parti.
- Quand le prochain départ est à plus de 10 minutes, les horaires sont rafraîchis toutes les 3 minutes au lieu de chaque minute : moins de batterie et de quota consommés.
- Couleurs des lignes ajustées à l'écran de la montre, avec un texte toujours lisible sur le bandeau.
- Les trajets avec arrêt d'arrivée tiennent dans le bandeau grâce à un texte plus petit quand il est long.

### Corrections

- Un envoi bloqué entre la montre et le téléphone ne peut plus figer les rafraîchissements.
- Une requête PRIM qui ne répond pas affiche une erreur réseau au bout de 10 secondes au lieu de rester sans réponse.
- Les horaires reçus par la montre sont renvoyés si elle était occupée, au lieu d'être perdus jusqu'au rafraîchissement suivant.
- Des réglages enregistrés par une ancienne version ou abîmés n'empêchent plus l'app de démarrer.
- Sans arrêt configuré, la montre l'indique et explique où en ajouter, au lieu d'afficher l'écran Réglages.

## [1.0.0]

- Première version publiée sur le store.
