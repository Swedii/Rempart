using Rempart;

namespace Rempart.Tests;

public class DesinstallationTests : IDisposable
{
    private readonly string _fichier = Path.Combine(Path.GetTempPath(), $"rempart-test-{Guid.NewGuid():N}.json");
    private static readonly DateTimeOffset T0 = new(2026, 11, 16, 20, 0, 0, TimeSpan.FromHours(1));

    // Réglages par défaut (décision du projet) : code au bout de 3 h, valable 15 min.
    private Desinstallation Nouvelle() =>
        new(_fichier, TimeSpan.FromHours(new Reglages().DelaiDesinstallationHeures),
            TimeSpan.FromMinutes(new Reglages().ValiditeCodeMinutes), "protection");

    public void Dispose() => File.Delete(_fichier);

    [Fact]
    public void LesReglagesParDefautSont3hEt15min()
    {
        Assert.Equal(3, new Reglages().DelaiDesinstallationHeures);
        Assert.Equal(15, new Reglages().ValiditeCodeMinutes);
    }

    [Fact]
    public void PasDeCodeAvant3hPuisCodeValable15Minutes()
    {
        var d = Nouvelle();
        Assert.Null(d.Vue(T0).DemandeLe);
        var v = d.Demander(T0);
        Assert.Equal(T0.AddHours(3), v.DisponibleLe);
        Assert.Equal(180, v.DelaiMinutes);
        Assert.Null(d.Vue(T0.AddMinutes(179)).Code);
        Assert.False(d.Verifier("", T0.AddMinutes(179)));
        Assert.DoesNotContain("\"Code\":\"", File.ReadAllText(_fichier));   // rien à lire en avance

        var code = d.Vue(T0.AddHours(3)).Code;
        Assert.Matches("^[A-Z2-9]{4}-[A-Z2-9]{4}$", code);
        Assert.True(d.Verifier(code, T0.AddHours(3).AddMinutes(10)));
        Assert.True(d.Verifier(code!.ToLowerInvariant().Replace("-", " "), T0.AddHours(3).AddMinutes(10)));  // saisie souple
        Assert.False(d.Verifier("AAAA-AAAA", T0.AddHours(3).AddMinutes(10)));
        Assert.Equal(T0.AddHours(3).AddMinutes(15), d.Vue(T0.AddHours(3).AddMinutes(10)).ExpireLe);

        // Périmé : tout revient au départ, il faut redemander (et attendre de nouveau 3 h).
        Assert.False(d.Verifier(code, T0.AddHours(3).AddMinutes(16)));
        Assert.Null(d.Vue(T0.AddHours(3).AddMinutes(16)).DemandeLe);
        Assert.Equal(T0.AddHours(7), d.Demander(T0.AddHours(4)).DisponibleLe);
    }

    [Fact]
    public void CodeJamaisRecupereApresLeDelaiEstDejaPerime()
    {
        // Demande le soir, retour le lendemain : le code a expiré entre-temps, il faut redemander.
        var d = Nouvelle();
        d.Demander(T0);
        Assert.Null(d.Vue(T0.AddHours(12)).DemandeLe);
    }

    [Fact]
    public void RedemanderNeRelancePasLAttente()
    {
        var d = Nouvelle();
        d.Demander(T0);
        Assert.Equal(T0.AddHours(3), d.Demander(T0.AddHours(1)).DisponibleLe);
    }

    [Fact]
    public void AnnulerEfface()
    {
        var d = Nouvelle();
        d.Demander(T0);
        var code = d.Vue(T0.AddHours(3)).Code;
        d.Annuler();
        Assert.Null(d.Vue(T0.AddHours(3).AddMinutes(1)).DemandeLe);
        Assert.False(d.Verifier(code, T0.AddHours(3).AddMinutes(1)));
    }

    [Fact]
    public void LaDemandeSurvitAUnRedemarrage()
    {
        Nouvelle().Demander(T0);
        var apres = Nouvelle();                                      // service relancé
        Assert.Equal(T0, apres.Vue(T0.AddHours(1)).DemandeLe);
        var code = apres.Vue(T0.AddHours(3)).Code;
        Assert.True(Nouvelle().Verifier(code, T0.AddHours(3).AddMinutes(5)));   // même code après un autre redémarrage
    }
}
