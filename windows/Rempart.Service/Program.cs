using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Options;
using Microsoft.Win32;
using Rempart;
using Rempart.Dns;

// Utilisation :
//   Rempart.Service.exe                       -> lancé par Windows comme service
//   Rempart.Service.exe --console [--test|--protection] [--port 5390] [--sans-cartes] [--liste chemin]
//                                             -> essai dans une fenêtre (Ctrl+C pour arrêter)

var reglages = Reglages.Charger();
string? liste = null;
for (int i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--test": reglages.Mode = "test"; break;
        case "--protection": reglages.Mode = "protection"; break;
        case "--port": reglages.Port = int.Parse(args[++i]); break;
        case "--sans-cartes": reglages.RedirigerCartes = false; break;
        case "--liste": liste = args[++i]; break;
        case "--delai-heures": reglages.DelaiDesinstallationHeures = double.Parse(args[++i], System.Globalization.CultureInfo.InvariantCulture); break;
    }
}

var builder = Host.CreateApplicationBuilder();
builder.Services.AddWindowsService(o => o.ServiceName = "Rempart");
if (WindowsServiceHelpers.IsWindowsService())
    builder.Services.AddSingleton<IHostLifetime, LifetimeProtege>();
builder.Services.AddSingleton(reglages);
builder.Services.AddHostedService(sp => new FiltreDns(reglages, liste,
    sp.GetRequiredService<IHostApplicationLifetime>(), sp.GetRequiredService<ILogger<FiltreDns>>()));
builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
await builder.Build().RunAsync();

/// <summary>En protection, Windows ne peut pas arrêter le service par la voie normale (« Arrêter » est grisé).</summary>
internal sealed class LifetimeProtege : WindowsServiceLifetime
{
    public LifetimeProtege(IHostEnvironment env, IHostApplicationLifetime vie, ILoggerFactory journaux,
        IOptions<HostOptions> hote, IOptions<WindowsServiceLifetimeOptions> options, Reglages reglages)
        : base(env, vie, journaux, hote, options)
    {
        CanStop = reglages.ModeTest;
        CanShutdown = true;
    }
}

internal sealed class FiltreDns(Reglages reglages, string? cheminListe, IHostApplicationLifetime vie, ILogger<FiltreDns> log)
    : IHostedService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private ServeurDns? _serveur;
    private CartesReseau? _cartes;
    private Navigateurs? _navigateurs;
    private Desinstallation? _desinstallation;
    private CanalCommande? _canal;
    private Task? _surveillance;
    private readonly CancellationTokenSource _arret = new();
    private volatile bool _desinstallationAutorisee;

    /// <summary>Essai dans une fenêtre sur un autre port ou sans les cartes : on ne touche à rien sur le PC.</summary>
    private bool Reel => reglages.RedirigerCartes && reglages.Port == 53;
    private bool EnService => WindowsServiceHelpers.IsWindowsService();

    public async Task StartAsync(CancellationToken jeton)
    {
        ListeBlocage listeBlocage;
        if (reglages.ListeTest)
        {
            listeBlocage = new ListeBlocage(reglages.DomainesTest);
            log.LogInformation("MODE {Mode}, LISTE DE TEST : seuls {Domaines} sont bloqués.",
                reglages.Mode.ToUpperInvariant(), string.Join(", ", reglages.DomainesTest));
        }
        else
        {
            var chemin = cheminListe ?? Reglages.CheminListe();
            listeBlocage = ListeBlocage.DepuisFichier(chemin);
            log.LogInformation("MODE {Mode} : {Nombre} domaines bloqués ({Chemin}).",
                reglages.Mode.ToUpperInvariant(), listeBlocage.Nombre, chemin);
        }

        _cartes = new CartesReseau(Path.Combine(Reglages.DossierDonnees, "dns-origine.json"), log);
        var amont = _cartes.ServeursAmont();
        log.LogInformation("Requêtes autorisées transmises à : {Amont}.", string.Join(", ", amont));

        bool modeTest = reglages.ModeTest, listeTest = reglages.ListeTest;
        _serveur = new ServeurDns(nom =>
        {
            // Domaine « canari » de Firefox : seule une réponse NXDOMAIN coupe son DNS chiffré automatique
            // (OISD le liste aussi : il faut le traiter avant la liste, sinon il recevrait 0.0.0.0).
            if (!modeTest && nom == "use-application-dns.net") return ServeurDns.Decision.NxDomain;
            if (listeBlocage.EstBloque(nom))
            {
                if (listeTest) log.LogInformation("Bloqué : {Nom}", nom);
                return ServeurDns.Decision.Bloquer;
            }
            return ServeurDns.Decision.Transmettre;
        }, amont, log);
        _serveur.Demarrer([new IPEndPoint(IPAddress.Loopback, reglages.Port), new IPEndPoint(IPAddress.IPv6Loopback, reglages.Port)]);
        log.LogInformation("Filtre DNS à l'écoute sur 127.0.0.1 et ::1, port {Port}.", reglages.Port);

        _desinstallation = new Desinstallation(Path.Combine(Reglages.DossierDonnees, "desinstallation.json"),
            TimeSpan.FromHours(reglages.DelaiDesinstallationHeures), TimeSpan.FromMinutes(reglages.ValiditeCodeMinutes),
            modeTest ? "test" : "protection");
        _canal = new CanalCommande(TraiterCommande, log);
        _canal.Demarrer();

        // Les cartes ne sont redirigées qu'une fois le filtre prêt (sinon plus d'Internet).
        if (Reel)
        {
            _cartes.Rediriger(modeTest);
            _navigateurs = new Navigateurs(log);
            _navigateurs.Appliquer();
            log.LogInformation("Réglages des navigateurs posés ({Nombre}).", Navigateurs.Liste.Length);
            if (!modeTest && EnService) ProtegerService();
            _surveillance = Task.Run(() => Surveiller(_arret.Token));
        }
        await Task.CompletedTask;
    }

    // ---- Commandes de l'application et du désinstalleur ------------------------------------------------------
    private string TraiterCommande(string ligne)
    {
        var morceaux = ligne.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        var maintenant = DateTimeOffset.Now;
        var d = _desinstallation!;
        switch (morceaux.FirstOrDefault()?.ToLowerInvariant())
        {
            case "etat": return JsonSerializer.Serialize(d.Vue(maintenant), Json);
            case "demander":
                log.LogInformation("Désinstallation demandée.");
                return JsonSerializer.Serialize(d.Demander(maintenant), Json);
            case "annuler":
                log.LogInformation("Demande de désinstallation annulée.");
                return JsonSerializer.Serialize(d.Annuler(), Json);
            case "desinstaller":
                var code = morceaux.Length > 1 ? morceaux[1] : null;
                if (!reglages.ModeTest && !d.Verifier(code, maintenant))
                    return JsonSerializer.Serialize(new { ok = false, erreur = "code" }, Json);
                AutoriserDesinstallation();
                return JsonSerializer.Serialize(new { ok = true }, Json);
            default: return JsonSerializer.Serialize(new { ok = false, erreur = "commande" }, Json);
        }
    }

    /// <summary>Code valide : tout est remis comme avant, puis le service s'arrête lui-même.</summary>
    private void AutoriserDesinstallation()
    {
        if (_desinstallationAutorisee) return;
        _desinstallationAutorisee = true;
        log.LogWarning("Désinstallation autorisée : protections retirées.");
        _arret.Cancel();
        try { _surveillance?.Wait(TimeSpan.FromSeconds(10)); } catch (AggregateException) { }   // tour en cours
        if (EnService)
        {
            Sc("failure Rempart reset= 0 actions= \"\"");
            Sc("config Rempart start= demand");
        }
        if (Reel)
        {
            _cartes?.Restaurer();
            _navigateurs?.Retirer();
        }
        _ = Task.Run(async () => { await Task.Delay(1500); vie.StopApplication(); });
    }

    /// <summary>Démarrage automatique et relance par Windows si le processus est tué.</summary>
    private void ProtegerService()
    {
        Sc("config Rempart start= auto");
        Sc("failure Rempart reset= 86400 actions= restart/3000/restart/3000/restart/10000");
    }

    private void Sc(string arguments)
    {
        // Passé par cmd pour que les guillemets vides de « actions= "" » arrivent tels quels.
        using var p = Process.Start(new ProcessStartInfo("cmd.exe", $"/c sc.exe {arguments}")
            { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true })!;
        p.StandardOutput.ReadToEnd();
        p.WaitForExit(10000);
        if (p.ExitCode != 0) log.LogWarning("sc {Arguments} : code {Code}", arguments, p.ExitCode);
    }

    // ---- Surveillance -----------------------------------------------------------------------------------------
    /// <summary>Toutes les 15 s : remet en place le DNS des cartes, les réglages des navigateurs et le démarrage automatique.</summary>
    private async Task Surveiller(CancellationToken jeton)
    {
        using var minuterie = new PeriodicTimer(TimeSpan.FromSeconds(15));
        try
        {
            while (await minuterie.WaitForNextTickAsync(jeton))
            {
                try
                {
                    if (_cartes!.DoitEtreRedirige(reglages.ModeTest))
                    {
                        log.LogWarning("DNS d'une carte réseau modifié : filtre remis en place.");
                        _cartes.Rediriger(reglages.ModeTest);
                    }
                    _navigateurs!.Appliquer();
                    if (!reglages.ModeTest && EnService)
                    {
                        using var cle = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\Rempart");
                        if (cle?.GetValue("Start") is not 2)
                        {
                            log.LogWarning("Démarrage automatique du service modifié : remis en place.");
                            ProtegerService();
                        }
                    }
                }
                catch (Exception e) { log.LogError(e, "Surveillance : erreur"); }
            }
        }
        catch (OperationCanceledException) { }
    }

    public async Task StopAsync(CancellationToken jeton)
    {
        _arret.Cancel();
        if (_surveillance is not null) await _surveillance;
        // En mode test, arrêter le service rend le PC comme avant. En protection, tout reste en place
        // (sauf désinstallation autorisée, déjà nettoyée).
        if (reglages.ModeTest && Reel && !_desinstallationAutorisee)
        {
            _cartes?.Restaurer();
            _navigateurs?.Retirer();
        }
        if (_canal is not null) await _canal.DisposeAsync();
        if (_serveur is not null) await _serveur.DisposeAsync();
        log.LogInformation("Filtre DNS arrêté.");
    }
}
