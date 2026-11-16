# Rempart

**Bloqueur de contenu pornographique, gratuit et open source.**
Rempart bloque les sites pornographiques et filtre le contenu adulte des réseaux sociaux et des moteurs de recherche,
pour protéger de l'exposition permanente à ce contenu et aider à résister à la tentation.

*English below.*

## Ce que fait l'extension (navigateur)

- **≈ 490 000 sites bloqués** (liste [OISD NSFW](https://oisd.nl), choisie pour son très faible taux de faux positifs),
  plus la détection des pages qui se déclarent elles-mêmes « adultes » (balise RTA ou `rating=adult`) : ces domaines
  sont appris et bloqués automatiquement.
- **Moteurs de recherche** : SafeSearch forcé sur Google, Bing, DuckDuckGo, Yahoo, Yandex et Brave ; mode restreint
  modéré forcé sur YouTube ; images floutées dans les recherches d'images (un clic pour révéler).
- **Réseaux sociaux filtrés, pas bloqués** :
  - Reddit : communautés 18+ et publications NSFW retirées ;
  - X / Twitter : photos et vidéos marquées « contenu adulte » retirées, même si les avertissements sont désactivés
    (les images violentes d'actualité ne sont pas touchées).
- **Parcours de déverrouillage** pour qui veut vraiment passer : 30 min d'attente onglet ouvert, 3 questions de
  réflexion écrites, un texte à recopier à la main, 5 captchas d'affilée, puis 10 min d'accès au seul site demandé.
  Chaque déverrouillage double l'attente suivante (retour à la normale après 7 jours) et remet à zéro le compteur de jours.
- **Réglages modifiables uniquement dans le sens le plus strict.**
- **Aucune donnée collectée** : pas de compte, pas de statistiques, rien n'est envoyé sur Internet.

## Faux positifs : priorité absolue

**Dans le doute, le site reste accessible** : on ne peut pas être parfait partout, mais on ne bloque que ce qui est sûr.
Les réseaux sociaux ne sont filtrés que sur les marqueurs officiels des plateformes (NSFW Reddit, « contenu adulte » X),
jamais sur une devinette ; en cas de panne ou de réponse illisible, la page s'affiche normalement.
Les domaines institutionnels (.gouv, .edu, .ac…) ne sont jamais bloqués en entier sauf adresse explicite.

Rempart bloque la **pornographie**, rien d'autre : rencontres, jeux d'argent, mangas grand public, torrents ou
plateformes de blogs ne sont pas bloqués.
- Une seule source de domaines, OISD (« Block. Don't break. »). Les listes Block List Project et StevenBlack ont été
  écartées : l'audit du 16/11/2026 y a trouvé b-cdn.net (CDN), ekstrabladet.dk, cosmopolitan.com, kinopoisk.ru…
- Pas de blocage par mot-clé dans l'adresse (Pornic, Pornichet, cabinporn.com, « canalblog »…).
- Les suffixes publics (co.uk, github.io…) et les grandes infrastructures (CDN, hébergeurs) ne sont jamais bloqués en entier.
- `node tools/audit-false-positives.mjs` croise la liste avec le classement Tranco des sites les plus visités ;
  les faux positifs confirmés vont dans `tools/blocklist-allow.txt`.
- Faux positif restant : depuis la page de blocage, « Ce site n'a rien de pornographique ? » permet de le signaler
  (signalement public, corrigé pour tout le monde) et de l'autoriser localement ; l'autorisation prend effet après
  24 h, sans toucher au compteur. La retirer est immédiat.

## Feuille de route

1. Extension navigateur — *en cours (v0.1)*
2. Service Windows : filtre DNS sur toute la machine, extension installée de force, navigation privée et DNS chiffré
   désactivés, surveillance anti-contournement, désinstallation par code retardé de 24 h
3. Appli Android (VPN local de filtrage)
4. Guide iPhone (Temps d'écran + profil DNS) et mode « tiers de confiance »

## Développement

Prérequis : Node.js 20+.

```sh
npm install
npm run build:blocklist     # télécharge les listes et génère extension/rules/blocklist.json
npx puppeteer browsers install chrome
npm test                    # test de bout en bout dans un Chrome headless, réseau coupé
```

Charger l'extension : `chrome://extensions` → mode développeur → « Charger l'extension non empaquetée » → dossier `extension/`.

### Limites connues (v0.1)

- Tant que le service Windows (étape 2) n'existe pas, l'extension peut être désactivée depuis `chrome://extensions`
  et ne fonctionne pas en navigation privée.
- SafeSearch non forcé sur Ecosia, Qwant et Startpage (paramètres à vérifier) ; Instagram, Bluesky, Discord et
  Telegram ne sont pas encore filtrés.
- Les filtres Reddit et X s'appuient sur la structure actuelle de ces sites et devront suivre leurs changements.

## Sources des listes

- [oisd nsfw](https://oisd.nl) — GPL-3.0
- [Public Suffix List](https://publicsuffix.org) — MPL-2.0 (utilisée pour ne jamais bloquer un suffixe public)

## Licence

GPL-3.0-or-later — voir [LICENSE](LICENSE).

---

## English

**Free, open-source porn blocker.** Blocks ~490,000 porn sites (OISD NSFW list, chosen for its very low false-positive rate), learns sites that label themselves as adult (RTA tag),
forces SafeSearch (Google, Bing, DuckDuckGo, Yahoo, Yandex, Brave) and YouTube Moderate Restricted Mode, blurs image search
results, and filters adult content on Reddit and X instead of blocking those platforms. Anyone who really wants through
must complete a deliberately slow unlock process (30-minute wait, written reflection, hand-typed text, 5 captchas in a
row) for 10 minutes of access to that one site; each unlock doubles the next wait and resets the streak counter.
No data is collected. Windows service, Android app and iPhone guide are on the roadmap. Licensed GPL-3.0-or-later.
