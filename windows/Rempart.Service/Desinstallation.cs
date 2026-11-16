using System.Security.Cryptography;
using System.Text.Json;

namespace Rempart;

/// <summary>Ce que voient l'application Rempart et le désinstalleur.</summary>
internal sealed record VueDesinstallation(
    string Mode, DateTimeOffset? DemandeLe, DateTimeOffset? DisponibleLe, string? Code, DateTimeOffset? ExpireLe);

/// <summary>
/// Désinstallation par code retardé (décision du projet : option 1, « pas trop sévère ») :
/// la demande déclenche une attente fixe (24 h) ; ensuite le code s'affiche dans l'application et reste valable
/// quelques jours. La demande s'annule à tout moment. Le code n'est créé qu'à la fin de l'attente : avant, il
/// n'existe nulle part et ne peut pas être lu en avance.
/// </summary>
internal sealed class Desinstallation
{
    private const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // sans 0/O, 1/I/L
    private sealed record Etat(DateTimeOffset? DemandeLe, string? Code, DateTimeOffset? ExpireLe);

    private readonly string _fichier;
    private readonly TimeSpan _delai, _validite;
    private readonly string _mode;
    private readonly Lock _verrou = new();
    private Etat _etat;

    public Desinstallation(string fichier, TimeSpan delai, TimeSpan validite, string mode)
    {
        (_fichier, _delai, _validite, _mode) = (fichier, delai, validite, mode);
        _etat = Lire();
    }

    public VueDesinstallation Vue(DateTimeOffset maintenant)
    {
        lock (_verrou) { Avancer(maintenant); return Construire(); }
    }

    public VueDesinstallation Demander(DateTimeOffset maintenant)
    {
        lock (_verrou)
        {
            Avancer(maintenant);
            if (_etat.DemandeLe is null) { _etat = new(maintenant, null, null); Sauver(); }
            return Construire();
        }
    }

    public VueDesinstallation Annuler()
    {
        lock (_verrou) { _etat = new(null, null, null); Sauver(); return Construire(); }
    }

    public bool Verifier(string? code, DateTimeOffset maintenant)
    {
        lock (_verrou)
        {
            Avancer(maintenant);
            return _etat.Code is not null && Normaliser(code) == Normaliser(_etat.Code);
        }
    }

    /// <summary>Fin de l'attente : crée le code. Code périmé : tout revient au départ.</summary>
    private void Avancer(DateTimeOffset maintenant)
    {
        if (_etat.DemandeLe is { } demande && _etat.Code is null && maintenant >= demande + _delai)
        {
            var c = RandomNumberGenerator.GetItems<char>(Alphabet, 8);
            _etat = new(demande, $"{new string(c, 0, 4)}-{new string(c, 4, 4)}", demande + _delai + _validite);
            Sauver();
        }
        if (_etat.ExpireLe is { } expire && maintenant > expire) { _etat = new(null, null, null); Sauver(); }
    }

    private VueDesinstallation Construire() =>
        new(_mode, _etat.DemandeLe, _etat.DemandeLe + _delai, _etat.Code, _etat.ExpireLe);

    private static string Normaliser(string? code) =>
        new((code ?? "").ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

    private Etat Lire()
    {
        try { return File.Exists(_fichier) ? JsonSerializer.Deserialize<Etat>(File.ReadAllText(_fichier)) ?? new(null, null, null) : new(null, null, null); }
        catch (Exception e) when (e is JsonException or IOException) { return new(null, null, null); }
    }

    private void Sauver()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_fichier)!);
        File.WriteAllText(_fichier, JsonSerializer.Serialize(_etat));
    }
}
