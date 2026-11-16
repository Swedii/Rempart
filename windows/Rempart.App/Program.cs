using System.Globalization;
using System.IO.Pipes;
using System.Text.Json;

namespace Rempart.App;

// Rempart.exe                 -> fenêtre d'état et de désinstallation
// Rempart.exe --desinstaller  -> demande le code (appelé par le désinstalleur) ; code de sortie 0 = autorisé

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args.Contains("--desinstaller")) return FenetreCode.Autoriser();
        Application.Run(new FenetrePrincipale());
        return 0;
    }
}

/// <summary>État renvoyé par le service (voir Rempart.Service/Desinstallation.cs).</summary>
internal sealed record Etat(string Mode, DateTimeOffset? DemandeLe, DateTimeOffset? DisponibleLe, string? Code,
    DateTimeOffset? ExpireLe, double DelaiMinutes, double ValiditeMinutes);
internal sealed record Resultat(bool Ok, string? Erreur);

/// <summary>Dialogue avec le service par le tube nommé « Rempart ».</summary>
internal static class Service
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Null si le service ne répond pas (arrêté ou pas installé).</summary>
    public static string? Envoyer(string commande)
    {
        try
        {
            using var tube = new NamedPipeClientStream(".", "Rempart", PipeDirection.InOut);
            tube.Connect(3000);
            using var ecrivain = new StreamWriter(tube, leaveOpen: true) { AutoFlush = true };
            using var lecteur = new StreamReader(tube, leaveOpen: true);
            ecrivain.WriteLine(commande);
            return lecteur.ReadLine();
        }
        catch (Exception e) when (e is TimeoutException or IOException or UnauthorizedAccessException) { return null; }
    }

    public static Etat? Lire(string commande = "etat") =>
        Envoyer(commande) is { } r ? JsonSerializer.Deserialize<Etat>(r, Json) : null;

    public static Resultat? Desinstaller(string code) =>
        Envoyer($"desinstaller {code}") is { } r ? JsonSerializer.Deserialize<Resultat>(r, Json) : null;
}

/// <summary>Textes français / anglais selon la langue de Windows.</summary>
internal static class T
{
    private static readonly bool Fr = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "fr";
    public static string S(string fr, string en) => Fr ? fr : en;

    public static string Duree(TimeSpan d) => d.TotalHours >= 1
        ? S($"{(int)d.TotalHours} h {d.Minutes:00} min", $"{(int)d.TotalHours} h {d.Minutes:00} min")
        : S($"{Math.Max(1, (int)Math.Ceiling(d.TotalMinutes))} min", $"{Math.Max(1, (int)Math.Ceiling(d.TotalMinutes))} min");

    /// <summary>« 3 heures », « 15 minutes », « 1 h 30 ».</summary>
    public static string DureeRonde(double minutes)
    {
        var d = TimeSpan.FromMinutes(minutes);
        int m = Math.Max(1, (int)Math.Round(d.TotalMinutes));
        if (d.TotalMinutes < 60) return m == 1 ? "1 minute" : $"{m} minutes";
        if (d.Minutes == 0) return d.TotalHours < 2 ? S("1 heure", "1 hour") : S($"{(int)d.TotalHours} heures", $"{(int)d.TotalHours} hours");
        return $"{(int)d.TotalHours} h {d.Minutes:00}";
    }

    public static string Heure(DateTimeOffset d) => d.LocalDateTime.ToString(S("HH:mm", "h:mm tt"));

    public static string Date(DateTimeOffset d) => d.LocalDateTime.ToString(S("dddd d MMMM 'à' HH:mm", "dddd, MMMM d 'at' h:mm tt"));
}
