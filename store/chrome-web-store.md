# Fiche Chrome Web Store

Tout ce qu'il faut copier dans le tableau de bord développeur du Chrome Web Store
(https://chrome.google.com/webstore/devconsole). Paquet : `npm run build:blocklist` puis `npm run package:chrome`
→ `sortie/rempart-chrome-<version>.zip`. Captures : `npm run captures:store` → `store/captures/`.

## Onglet « Fiche Play Store » / Store listing

- **Langue par défaut** : français. Ajouter l'anglais (English) comme seconde langue.
- **Nom et résumé** : lus dans le paquet (`_locales`), rien à saisir.
- **Catégorie** : Lifestyle → Well-being (Bien-être)
- **Icône de la boutique** : `extension/icons/128.png`
- **Captures (1280×800)** : international = `store/captures/en/1-blocage.png` à `4-reglages.png` ;
  localisé français = `store/captures/fr/…`
- **Petite tuile promotionnelle (440×280)** : `store/captures/fr/tuile-440x280.png` (EN : `store/captures/en/…`)
- **URL officielle** : laisser vide (exige un domaine vérifié dans la Search Console)
- **Page d'accueil** : https://github.com/Swedii/Rempart
- **Assistance** : https://github.com/Swedii/Rempart/issues

### Description détaillée (FR)

```
Rempart bloque les sites pornographiques et filtre le contenu adulte des réseaux sociaux et des moteurs de recherche, pour se protéger de l'exposition permanente à ce contenu et résister à la tentation. Gratuit, open source (GPL-3.0), sans compte et sans aucune collecte de données.

CE QUE FAIT REMPART
• Environ 490 000 sites pornographiques bloqués, à partir de la liste OISD NSFW, choisie pour son très faible taux de faux positifs.
• Les sites qui se déclarent eux-mêmes « réservés aux adultes » (balise RTA) sont détectés et bloqués automatiquement.
• SafeSearch forcé sur Google, Bing, DuckDuckGo, Yahoo, Yandex et Brave ; YouTube en mode restreint.
• Images floutées dans les recherches d'images (un clic pour en révéler une).
• Réseaux sociaux filtrés, pas bloqués : sur Reddit, les communautés 18+ et les publications NSFW sont retirées ; sur X, les photos et vidéos marquées « contenu adulte » disparaissent. Le reste de la plateforme reste utilisable.

UN DÉVERROUILLAGE VOLONTAIREMENT LENT
Pour passer quand même : 30 minutes d'attente onglet ouvert, 3 questions de réflexion écrites, un texte à recopier à la main et 5 captchas d'affilée, puis 10 minutes d'accès au seul site demandé. Chaque déverrouillage double l'attente suivante et remet à zéro le compteur de jours. Les réglages ne peuvent être changés que dans le sens le plus strict.

FAUX POSITIFS : PRIORITÉ ABSOLUE
Dans le doute, un site reste accessible. Rempart bloque la pornographie, pas les sites de rencontre, les jeux d'argent, les mangas grand public ou les torrents. Un site bloqué à tort se signale en un clic depuis la page de blocage, et peut être autorisé sur votre appareil (effet après 24 h).

VIE PRIVÉE
Tout se passe sur votre appareil : aucune donnée n'est envoyée au développeur ni à personne. Code source : https://github.com/Swedii/Rempart

POUR ALLER PLUS LOIN
Sur Windows, l'application Rempart étend la protection à tout le PC (tous les navigateurs, navigation privée coupée) : voir le site du projet.
```

### Description détaillée (EN)

```
Rempart blocks porn sites and filters adult content from social networks and search engines, to protect you from constant exposure to it and help you resist temptation. Free, open source (GPL-3.0), no account and no data collection.

WHAT REMPART DOES
• About 490,000 porn sites blocked, using the OISD NSFW list, chosen for its very low false-positive rate.
• Sites that label themselves as adults-only (RTA tag) are detected and blocked automatically.
• SafeSearch enforced on Google, Bing, DuckDuckGo, Yahoo, Yandex and Brave; YouTube Restricted Mode.
• Image search results are blurred (click one to reveal it).
• Social networks are filtered, not blocked: on Reddit, 18+ communities and NSFW posts are removed; on X, photos and videos marked as adult content disappear. The rest of the platform stays usable.

A DELIBERATELY SLOW UNLOCK
To get through anyway: a 30-minute wait with the tab open, 3 written reflection questions, a text to retype by hand and 5 captchas in a row, then 10 minutes of access to that one site. Each unlock doubles the next wait and resets the streak counter. Settings can only be made stricter.

FALSE POSITIVES COME FIRST
When in doubt, a site stays accessible. Rempart blocks pornography, not dating, gambling, mainstream manga or torrent sites. A wrongly blocked site can be reported in one click from the block page, and allowed on your device (takes effect after 24 hours).

PRIVACY
Everything happens on your device: no data is sent to the developer or anyone else. Source code: https://github.com/Swedii/Rempart

GOING FURTHER
On Windows, the Rempart app extends protection to the whole PC (every browser, private browsing disabled): see the project site.
```

## Onglet « Pratiques de confidentialité » / Privacy practices

### Objectif unique / Single purpose

```
Rempart blocks pornographic websites and hides adult content on search engines and social networks, to protect users from exposure to pornography.
```

### Justification des autorisations / Permission justification

**declarativeNetRequest**
```
Used to block about 490,000 pornographic domains (bundled static rules) and to enforce SafeSearch on search engines and Restricted Mode on YouTube by redirecting to the safe version of the same URL. All matching is done by the browser; the extension never sees or stores the requests.
```

**storage**
```
Stores the user's settings, streak counter, unlock history, allowed sites (false positives) and domains that label themselves as adult, locally on the device. Nothing is synced or sent anywhere.
```

**alarms**
```
Re-locks a site when the 10-minute access granted by the unlock process ends, and activates a user-allowed site after its 24-hour delay, even if the browser was closed in between.
```

**webNavigation**
```
Remembers the address requested in each tab (in session memory only, cleared when the tab closes) so that the block page can show which site was blocked and offer to report it as a false positive.
```

**Autorisation d'hôte `<all_urls>` / Host permission**
```
Pornographic content can appear on any site, so blocking must apply everywhere. The content script on every page only checks for the standard adult-content meta tags (RTA label, rating=adult) to block self-declared adult sites, and blurs image search results. It also filters adult-marked posts on reddit.com and x.com. No page content is collected, stored or transmitted.
```

**Code distant / Remote code** : Non, je n'utilise pas de code distant. / No, I am not using remote code.

### Utilisation des données / Data usage

Ne rien cocher dans la liste des données collectées : Rempart ne collecte aucune donnée (tout reste sur l'appareil).
Cocher les trois certifications :
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**URL des règles de confidentialité / Privacy policy URL** :
https://github.com/Swedii/Rempart/blob/main/PRIVACY.md

## Instructions de test / Test instructions

```
No account, login or configuration is needed: protection is active as soon as the extension is installed.

1. Blocking: open any well-known adult site (e.g. pornhub.com). The request is blocked and the Rempart block page is shown instead.
2. SafeSearch: search anything on google.com or bing.com: the results URL is redirected to the SafeSearch version (safe=active / adlt=strict). On youtube.com, Restricted Mode is enforced.
3. Image search: on Google Images, thumbnails are blurred; clicking one reveals it.
4. Settings: open the extension's options page. Settings can only be made stricter, never looser (by design).
5. Unlock process (optional, slow by design): on the block page, "I still want to access it" starts a 30-minute wait with the tab open, with reflection questions, a text to retype by hand and 5 captchas. It is meant to discourage, so it cannot be skipped.
6. False positive: on the block page, "Nothing pornographic on this site?" opens a pre-filled GitHub issue form and lets the user allow the site locally after 24 hours.

Everything runs locally; the extension makes no network requests of its own and collects no data. Source code: https://github.com/Swedii/Rempart
```

## Onglet « Distribution »

- **Visibilité** : Public
- **Régions** : toutes
- **Contenu pour adultes** : non (l'extension bloque ce contenu, elle n'en contient pas)
