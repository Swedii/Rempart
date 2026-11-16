using Microsoft.Extensions.Logging;
using Microsoft.Win32;

namespace Rempart;

/// <summary>Un réglage imposé (stratégie de groupe) dans HKLM.</summary>
internal sealed record Reglage(string Cle, string Nom, object Valeur)
{
    public RegistryValueKind Type => Valeur is string ? RegistryValueKind.String : RegistryValueKind.DWord;
}

/// <summary>
/// Réglages imposés aux navigateurs et à Windows. Une seule liste sert à poser, surveiller et retirer.
/// Toute entrée ajoutée ici doit aussi figurer dans windows\scripts\remise-a-zero.ps1 (un test le vérifie).
/// </summary>
internal sealed class Navigateurs(ILogger log)
{
    private const string Chrome = @"SOFTWARE\Policies\Google\Chrome";
    private const string Edge = @"SOFTWARE\Policies\Microsoft\Edge";
    private const string Firefox = @"SOFTWARE\Policies\Mozilla\Firefox";
    private const string DnsWindows = @"SOFTWARE\Policies\Microsoft\Windows NT\DNSClient";

    public static readonly Reglage[] Liste =
    [
        // Chrome : navigation privée et invité coupés, DNS chiffré coupé (sinon il passerait à côté du filtre),
        // SafeSearch Google et YouTube restreint modéré (mêmes niveaux que l'extension).
        new(Chrome, "IncognitoModeAvailability", 1),
        new(Chrome, "BrowserGuestModeEnabled", 0),
        new(Chrome, "DnsOverHttpsMode", "off"),
        new(Chrome, "ForceGoogleSafeSearch", 1),
        new(Chrome, "ForceYouTubeRestrict", 1),
        // Edge : idem, plus Bing strict.
        new(Edge, "InPrivateModeAvailability", 1),
        new(Edge, "BrowserGuestModeEnabled", 0),
        new(Edge, "DnsOverHttpsMode", "off"),
        new(Edge, "ForceGoogleSafeSearch", 1),
        new(Edge, "ForceBingSafeSearch", 2),
        new(Edge, "ForceYouTubeRestrict", 1),
        // Firefox (pris en compte dès qu'il est installé) : navigation privée et DNS chiffré coupés.
        new(Firefox, "DisablePrivateBrowsing", 1),
        new(Firefox + @"\DNSOverHTTPS", "Enabled", 0),
        new(Firefox + @"\DNSOverHTTPS", "Locked", 1),
        // Windows 11 : DNS chiffré du système interdit (sans effet sous Windows 10).
        new(DnsWindows, "DoHPolicy", 1),
    ];

    /// <summary>Pose les réglages manquants ou modifiés. Renvoie le nombre de réglages remis en place.</summary>
    public int Appliquer()
    {
        int remis = 0;
        foreach (var r in Liste)
        {
            using var cle = Registry.LocalMachine.CreateSubKey(r.Cle, writable: true);
            var actuelle = cle.GetValue(r.Nom);
            if (actuelle is not null && actuelle.Equals(r.Valeur) && cle.GetValueKind(r.Nom) == r.Type) continue;
            cle.SetValue(r.Nom, r.Valeur, r.Type);
            remis++;
            if (actuelle is not null) log.LogWarning("Réglage modifié, remis en place : {Cle}\\{Nom}", r.Cle, r.Nom);
        }
        return remis;
    }

    /// <summary>Retire les réglages posés par Rempart (et les clés devenues vides), sans toucher aux autres.</summary>
    public void Retirer()
    {
        foreach (var r in Liste)
        {
            using (var cle = Registry.LocalMachine.OpenSubKey(r.Cle, writable: true))
                cle?.DeleteValue(r.Nom, throwOnMissingValue: false);
            SupprimerSiVide(r.Cle);
        }
        log.LogInformation("Réglages des navigateurs retirés.");
    }

    private static void SupprimerSiVide(string chemin)
    {
        while (chemin.Contains('\\') && !chemin.Equals(@"SOFTWARE\Policies", StringComparison.OrdinalIgnoreCase))
        {
            using (var cle = Registry.LocalMachine.OpenSubKey(chemin))
            {
                if (cle is null) { chemin = chemin[..chemin.LastIndexOf('\\')]; continue; }
                if (cle.ValueCount > 0 || cle.SubKeyCount > 0) return;
            }
            Registry.LocalMachine.DeleteSubKey(chemin, throwOnMissingSubKey: false);
            chemin = chemin[..chemin.LastIndexOf('\\')];
        }
    }
}
