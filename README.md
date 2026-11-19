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
  Voir la [politique de confidentialité](PRIVACY.md).

## Ce que fait Rempart pour Windows

Un installateur (`Rempart-0.1.0-installation.exe`) met en place un service Windows et l'application `Rempart.exe`.

- **Filtre DNS local sur tout le PC** : les mêmes ≈ 490 000 sites sont bloqués dans tous les navigateurs et toutes
  les applications. Les autres requêtes partent vers le DNS d'origine du PC (celui de la box ou du réseau),
  sans passer par un serveur de Rempart.
- **Réglages imposés à Chrome, Edge et Firefox** : navigation privée et mode invité désactivés, DNS chiffré du
  navigateur coupé (il contournerait le filtre), SafeSearch forcé sur Google et Bing, YouTube en mode restreint modéré.
- **Extension Rempart installée de force dans Chrome et Edge** (dès sa publication sur le Chrome Web Store) :
  impossible de la désactiver ou de la supprimer depuis le navigateur ; seule la désinstallation de Rempart par code l'enlève.
- **Surveillance toutes les 15 secondes** : si un réglage ou le DNS d'une carte réseau est modifié, il est remis en place.
- **Mode protection** : le service refuse l'arrêt, redémarre tout seul s'il est tué et se relance au démarrage du PC.
- **Désinstallation par code retardé** : on demande le code dans l'application Rempart ; il s'affiche **au bout de
  3 heures** et reste **valable 15 minutes**. La demande est annulable. Le code ne sort jamais du PC.
- **Remise à zéro de secours** (`REMISE-A-ZERO.cmd`, dans le dossier d'installation) : si quelque chose se passe mal,
  elle enlève toutes les protections et remet Internet comme avant, après **1 heure d'attente** fenêtre ouverte.
- Si le service tombe en panne, Internet reste accessible (jamais de PC coupé du réseau).

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

1. Extension navigateur — *v0.1 ; publication sur le Chrome Web Store puis Firefox Add-ons à venir*
2. Service Windows — *v0.1* (extension installée de force dans Chrome et Edge) ; à venir : installateur signé
3. Appli Android (VPN local de filtrage)
4. Guide iPhone (Temps d'écran + profil DNS) et mode « tiers de confiance »

## Développement

### Extension

Prérequis : Node.js 20+.

```sh
npm install
npm run build:blocklist     # télécharge les listes et génère extension/rules/blocklist-*.json
npx puppeteer browsers install chrome
npm test                    # test de bout en bout dans un Chrome headless, réseau coupé
npx puppeteer browsers install firefox
npm run test:firefox        # même test dans un Firefox headless (proxy local, rien ne sort du PC)
npm run package:chrome      # paquets pour les boutiques -> sortie/
npm run package:firefox
```

Charger l'extension : `chrome://extensions` → mode développeur → « Charger l'extension non empaquetée » → dossier `extension/`.

### Service et installateur Windows

Prérequis : Windows 10/11 x64, [SDK .NET 10](https://dotnet.microsoft.com), [Inno Setup 6](https://jrsoftware.org/isinfo.php)
(`winget install JRSoftware.InnoSetup --scope user`), et la liste générée par `npm run build:blocklist` (`data/blocklist.txt`).

```powershell
dotnet test windows\Rempart.slnx                       # tests du filtre DNS et du code de désinstallation
.\windows\installateur\construire.ps1                  # vraie version  -> windows\sortie\Rempart-0.1.0-installation.exe
.\windows\installateur\construire.ps1 -Variante repetition   # protection, 3 domaines de test, délais de quelques minutes
.\windows\installateur\construire.ps1 -Variante test         # mode test : rien de réel bloqué, l'arrêt du service retire tout
```

Avant d'essayer sur son propre PC : `windows\scripts\point-de-restauration.ps1` crée un point de restauration
Windows, et `windows\REMISE-A-ZERO.cmd` remet tout comme avant (immédiat en mode test).

### Limites connues (v0.1)

- Sans le service Windows, l'extension peut être désactivée depuis `chrome://extensions` et ne fonctionne pas en
  navigation privée. Avec le service, elle est installée de force (Chrome et Edge) : l'installation forcée ne prend
  effet qu'une fois l'extension publiée sur le Chrome Web Store.
- L'installateur n'est pas encore signé : Windows SmartScreen et certains antivirus peuvent avertir.
- SafeSearch non forcé sur Ecosia, Qwant et Startpage (paramètres à vérifier) ; Instagram, Bluesky, Discord et
  Telegram ne sont pas encore filtrés.
- Les filtres Reddit et X s'appuient sur la structure actuelle de ces sites et devront suivre leurs changements.

## Sources des listes

- [oisd nsfw](https://oisd.nl) — GPL-3.0
- [Public Suffix List](https://publicsuffix.org) — MPL-2.0 (utilisée pour ne jamais bloquer un suffixe public)

## Politique de signature du code

*Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).*
(Signature de code gratuite fournie par SignPath.io, certificat de la SignPath Foundation : demande en cours.)

- L'installateur Windows est construit uniquement à partir du code de ce dépôt, sur les serveurs de GitHub
  ([.github/workflows/installateur.yml](.github/workflows/installateur.yml)), puis signé par SignPath.
- Auteurs et relecteurs (*committers and reviewers*) : [Swedii](https://github.com/Swedii).
  Approbation de chaque signature (*approvers*) : [Swedii](https://github.com/Swedii).
- Validation en deux étapes obligatoire sur GitHub et sur SignPath pour toute personne de l'équipe.
- Vie privée : ce programme ne transmet aucune information à d'autres systèmes en réseau, sauf à la demande
  explicite de l'utilisateur (signalement d'un faux positif) ; le filtre DNS transmet seulement les requêtes
  autorisées au serveur DNS d'origine du PC, comme Windows le ferait sans lui, et Chrome et Edge téléchargent
  l'extension Rempart depuis le Chrome Web Store. Voir la [politique de confidentialité](PRIVACY.md).

## Licence

GPL-3.0-or-later — voir [LICENSE](LICENSE).

---

## English

**Free, open-source porn blocker.** Blocks ~490,000 porn sites (OISD NSFW list, chosen for its very low false-positive rate), learns sites that label themselves as adult (RTA tag),
forces SafeSearch (Google, Bing, DuckDuckGo, Yahoo, Yandex, Brave) and YouTube Moderate Restricted Mode, blurs image search
results, and filters adult content on Reddit and X instead of blocking those platforms. Anyone who really wants through
must complete a deliberately slow unlock process (30-minute wait, written reflection, hand-typed text, 5 captchas in a
row) for 10 minutes of access to that one site; each unlock doubles the next wait and resets the streak counter.
No data is collected.

**Windows**: an installer sets up a service and the `Rempart.exe` app. A local DNS filter blocks the same sites
system-wide (other queries go to the PC's original DNS, never to a Rempart server); Chrome, Edge and Firefox policies
disable private/guest browsing and browser DNS-over-HTTPS and enforce SafeSearch and YouTube Restricted Mode, and the
Rempart extension is force-installed in Chrome and Edge (it cannot be disabled or removed from the browser); settings
are checked and restored every 15 seconds. In protection mode the service refuses to stop, restarts if killed and
starts with Windows. Uninstalling requires a code requested in the app: it appears after 3 hours and stays valid for
15 minutes. An emergency reset script removes everything after a 1-hour wait.

**False positives are the top priority**: when in doubt, the site stays accessible. Rempart blocks pornography only
(plus sex shops and gore), not dating, gambling, mainstream manga or torrents. Report a wrongly blocked site with the
“False positive” issue form. Android app and iPhone guide are on the roadmap. Licensed GPL-3.0-or-later.

**Code signing policy**: free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org) (application pending). The Windows installer is built only from this
repository's source on GitHub-hosted runners ([workflow](.github/workflows/installateur.yml)) and then signed by SignPath.
Committers, reviewers and approvers: [Swedii](https://github.com/Swedii); two-factor authentication is required for
GitHub and SignPath. Privacy: this program will not transfer any information to other networked systems unless
specifically requested by the user (false-positive report); the DNS filter only forwards allowed queries to the PC's
original DNS server, as Windows would without it, and Chrome and Edge download the Rempart extension from the Chrome
Web Store. See the [privacy policy](PRIVACY.md).
