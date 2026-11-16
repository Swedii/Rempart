using System.Text.Json;

namespace Rempart;

/// <summary>
/// Réglages du service, lus dans C:\ProgramData\Rempart\reglages.json.
/// Sans fichier : mode test (rien de réel n'est bloqué tant que le mode protection n'est pas choisi).
/// </summary>
internal sealed class Reglages
{
    public static readonly string DossierDonnees =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rempart");

    /// <summary>« test » : seulement <see cref="DomainesTest"/>, DNS d'origine gardé en secours. « protection » : la vraie liste.</summary>
    public string Mode { get; set; } = "test";

    /// <summary>Domaines inoffensifs bloqués en mode test, pour vérifier que le filtre marche.</summary>
    public string[] DomainesTest { get; set; } = ["example.org", "example.net", "neverssl.com"];

    /// <summary>Port d'écoute (53 en vrai ; autre valeur seulement pour les essais).</summary>
    public int Port { get; set; } = 53;

    /// <summary>Modifier ou non les cartes réseau (faux pour un essai qui ne touche à rien).</summary>
    public bool RedirigerCartes { get; set; } = true;

    public bool ModeTest => !string.Equals(Mode, "protection", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// « test » (seulement <see cref="DomainesTest"/>) ou « complete ». Vide : test en mode test, complète en protection.
    /// Protection + liste de test = répétition générale sans rien bloquer de réel.
    /// </summary>
    public string? Liste { get; set; }

    public bool ListeTest => Liste is null ? ModeTest : Liste.Equals("test", StringComparison.OrdinalIgnoreCase);

    /// <summary>Attente entre la demande de désinstallation et l'affichage du code.</summary>
    public double DelaiDesinstallationHeures { get; set; } = 24;

    /// <summary>Attente de la remise à zéro de secours en protection (lue par remise-a-zero.ps1).</summary>
    public double AttenteRemiseAZeroMinutes { get; set; } = 60;

    /// <summary>Durée pendant laquelle le code affiché reste valable.</summary>
    public double ValiditeCodeJours { get; set; } = 7;

    public static Reglages Charger(string? chemin = null)
    {
        chemin ??= Path.Combine(DossierDonnees, "reglages.json");
        if (!File.Exists(chemin)) return new Reglages();
        return JsonSerializer.Deserialize<Reglages>(File.ReadAllText(chemin),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true, ReadCommentHandling = JsonCommentHandling.Skip }) ?? new Reglages();
    }

    /// <summary>Liste complète : à côté des données, sinon à côté du programme.</summary>
    public static string CheminListe()
    {
        var donnees = Path.Combine(DossierDonnees, "blocklist.txt");
        return File.Exists(donnees) ? donnees : Path.Combine(AppContext.BaseDirectory, "blocklist.txt");
    }
}
