using Rempart;

namespace Rempart.Tests;

public class DesinstallationTests : IDisposable
{
    private readonly string _fichier = Path.Combine(Path.GetTempPath(), $"rempart-test-{Guid.NewGuid():N}.json");
    private static readonly DateTimeOffset T0 = new(2026, 11, 16, 20, 0, 0, TimeSpan.FromHours(1));

    private Desinstallation Nouvelle() =>
        new(_fichier, TimeSpan.FromHours(24), TimeSpan.FromDays(7), "protection");

    public void Dispose() => File.Delete(_fichier);

    [Fact]
    public void PasDeCodeAvant24hPuisCodeValable7Jours()
    {
        var d = Nouvelle();
        Assert.Null(d.Vue(T0).DemandeLe);
        var v = d.Demander(T0);
        Assert.Equal(T0.AddHours(24), v.DisponibleLe);
        Assert.Null(d.Vue(T0.AddHours(23.9)).Code);
        Assert.False(d.Verifier("", T0.AddHours(23.9)));
        Assert.DoesNotContain("\"Code\":\"", File.ReadAllText(_fichier).Replace("\"Code\":null", ""));  // rien à lire en avance

        var code = d.Vue(T0.AddHours(24)).Code;
        Assert.Matches("^[A-Z2-9]{4}-[A-Z2-9]{4}$", code);
        Assert.True(d.Verifier(code, T0.AddHours(30)));
        Assert.True(d.Verifier(code!.ToLowerInvariant().Replace("-", " "), T0.AddHours(30)));  // saisie souple
        Assert.False(d.Verifier("AAAA-AAAA", T0.AddHours(30)));
        Assert.Equal(T0.AddHours(24).AddDays(7), d.Vue(T0.AddHours(30)).ExpireLe);

        // Périmé : tout revient au départ, il faut redemander.
        Assert.False(d.Verifier(code, T0.AddHours(24).AddDays(7).AddMinutes(1)));
        Assert.Null(d.Vue(T0.AddDays(9)).DemandeLe);
    }

    [Fact]
    public void RedemanderNeRelancePasLAttente()
    {
        var d = Nouvelle();
        d.Demander(T0);
        Assert.Equal(T0.AddHours(24), d.Demander(T0.AddHours(10)).DisponibleLe);
    }

    [Fact]
    public void AnnulerEfface()
    {
        var d = Nouvelle();
        d.Demander(T0);
        var code = d.Vue(T0.AddHours(25)).Code;
        d.Annuler();
        Assert.Null(d.Vue(T0.AddHours(26)).DemandeLe);
        Assert.False(d.Verifier(code, T0.AddHours(26)));
    }

    [Fact]
    public void LaDemandeSurvitAUnRedemarrage()
    {
        Nouvelle().Demander(T0);
        var apres = Nouvelle();                                      // service relancé
        Assert.Equal(T0, apres.Vue(T0.AddHours(1)).DemandeLe);
        var code = apres.Vue(T0.AddHours(24)).Code;
        Assert.True(Nouvelle().Verifier(code, T0.AddHours(25)));     // même code après un autre redémarrage
    }
}
