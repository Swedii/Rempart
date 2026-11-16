# Politique de confidentialité de Rempart

*Dernière mise à jour : 16 novembre 2026 · [English below](#privacy-policy)*

**Rempart ne collecte aucune donnée.** Pas de compte, pas de statistiques, pas de publicité, pas de serveur Rempart :
rien de ce que vous faites n'est envoyé au développeur ni à qui que ce soit.

## Extension navigateur

Pour fonctionner, l'extension lit et enregistre certaines informations **uniquement sur votre appareil** :

| Information | Pourquoi | Où elle reste |
|---|---|---|
| Adresse des pages que vous ouvrez | Comparer le domaine à la liste de sites bloqués, et afficher sur la page de blocage le site demandé | Mémoire de l'onglet, effacée à sa fermeture |
| Balises « contenu adulte » d'une page (RTA, `rating`) | Bloquer un site qui se déclare lui-même réservé aux adultes | Seul le nom de domaine concerné est retenu, sur l'appareil |
| Vos réglages, votre compteur de jours, vos déverrouillages et les réponses écrites pendant un déverrouillage | Le parcours de déverrouillage et le compteur | Stockage local du navigateur (`chrome.storage.local`) |
| Les sites que vous autorisez (faux positifs) | Ne plus les bloquer | Stockage local du navigateur |

Ces données ne quittent jamais votre appareil. Elles sont supprimées quand vous désinstallez l'extension.

Les seules connexions réseau que Rempart provoque :

- **Reddit** : sur reddit.com, l'extension demande à Reddit lui-même si une communauté est réservée aux adultes
  (adresse publique `/r/<nom>/about.json`), exactement comme le fait le site Reddit que vous êtes en train d'utiliser.
- **Signalement d'un faux positif** : seulement si vous cliquez sur « Signaler », un onglet GitHub s'ouvre avec le nom
  de domaine pré-rempli. Rien n'est envoyé tant que vous ne validez pas vous-même le ticket sur GitHub, qui est public.

## Application Windows

Le service Windows fonctionne entièrement sur votre PC : le filtre DNS transmet les requêtes autorisées au serveur DNS
d'origine de votre PC (celui de votre box ou de votre réseau), comme Windows le ferait sans Rempart. Aucun journal de
navigation n'est conservé. Le code de désinstallation est créé et affiché sur le PC, il n'est envoyé nulle part.

## Contact

Questions ou remarques : ouvrez un ticket sur [github.com/Swedii/Rempart/issues](https://github.com/Swedii/Rempart/issues).

---

## Privacy policy

*Last updated: November 16, 2026*

**Rempart collects no data.** No account, no analytics, no ads, no Rempart server: nothing you do is sent to the
developer or to anyone else.

### Browser extension

To work, the extension reads and stores some information **only on your device**:

| Information | Why | Where it stays |
|---|---|---|
| Address of the pages you open | Match the domain against the block list, and show the requested site on the block page | Tab memory, cleared when the tab closes |
| A page's "adult content" tags (RTA, `rating`) | Block a site that labels itself as adults-only | Only the domain name is kept, on the device |
| Your settings, streak counter, unlocks and the answers you write during an unlock | The unlock process and the counter | Browser local storage (`chrome.storage.local`) |
| Sites you allow (false positives) | Stop blocking them | Browser local storage |

This data never leaves your device and is deleted when you uninstall the extension.

The only network connections Rempart causes:

- **Reddit**: on reddit.com, the extension asks Reddit itself whether a community is adults-only (public
  `/r/<name>/about.json` address), just as the Reddit site you are using does.
- **False-positive report**: only if you click "Report", a GitHub tab opens with the domain name pre-filled. Nothing
  is sent unless you submit the issue on GitHub yourself, where it is public.

### Windows app

The Windows service runs entirely on your PC: the DNS filter forwards allowed queries to your PC's original DNS
server (your router's or network's), as Windows would without Rempart. No browsing log is kept. The uninstall code is
generated and shown on the PC and is never sent anywhere.

### Contact

Questions or comments: open an issue at [github.com/Swedii/Rempart/issues](https://github.com/Swedii/Rempart/issues).
