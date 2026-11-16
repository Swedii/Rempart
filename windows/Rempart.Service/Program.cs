using System.Net;
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
    }
}

var builder = Host.CreateApplicationBuilder();
builder.Services.AddWindowsService(o => o.ServiceName = "Rempart");
builder.Services.AddSingleton(reglages);
builder.Services.AddHostedService(sp => new FiltreDns(reglages, liste, sp.GetRequiredService<ILogger<FiltreDns>>()));
builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
await builder.Build().RunAsync();

internal sealed class FiltreDns(Reglages reglages, string? cheminListe, ILogger<FiltreDns> log) : IHostedService
{
    private ServeurDns? _serveur;
    private CartesReseau? _cartes;

    public async Task StartAsync(CancellationToken jeton)
    {
        ListeBlocage listeBlocage;
        if (reglages.ModeTest)
        {
            listeBlocage = new ListeBlocage(reglages.DomainesTest);
            log.LogInformation("MODE TEST : seuls {Domaines} sont bloqués.", string.Join(", ", reglages.DomainesTest));
        }
        else
        {
            var chemin = cheminListe ?? Reglages.CheminListe();
            listeBlocage = ListeBlocage.DepuisFichier(chemin);
            log.LogInformation("MODE PROTECTION : {Nombre} domaines bloqués ({Chemin}).", listeBlocage.Nombre, chemin);
        }

        _cartes = new CartesReseau(Path.Combine(Reglages.DossierDonnees, "dns-origine.json"), log);
        var amont = _cartes.ServeursAmont();
        log.LogInformation("Requêtes autorisées transmises à : {Amont}.", string.Join(", ", amont));

        bool modeTest = reglages.ModeTest;
        _serveur = new ServeurDns(nom =>
        {
            // Domaine « canari » de Firefox : seule une réponse NXDOMAIN coupe son DNS chiffré automatique
            // (OISD le liste aussi : il faut le traiter avant la liste, sinon il recevrait 0.0.0.0).
            if (!modeTest && nom == "use-application-dns.net") return ServeurDns.Decision.NxDomain;
            if (listeBlocage.EstBloque(nom))
            {
                if (modeTest) log.LogInformation("Bloqué : {Nom}", nom);
                return ServeurDns.Decision.Bloquer;
            }
            return ServeurDns.Decision.Transmettre;
        }, amont, log);
        _serveur.Demarrer([new IPEndPoint(IPAddress.Loopback, reglages.Port), new IPEndPoint(IPAddress.IPv6Loopback, reglages.Port)]);
        log.LogInformation("Filtre DNS à l'écoute sur 127.0.0.1 et ::1, port {Port}.", reglages.Port);

        // Les cartes ne sont redirigées qu'une fois le filtre prêt (sinon plus d'Internet).
        if (Reel)
        {
            _cartes.Rediriger(modeTest);
            _navigateurs = new Navigateurs(log);
            _navigateurs.Appliquer();
            log.LogInformation("Réglages des navigateurs posés ({Nombre}).", Navigateurs.Liste.Length);
            _surveillance = Task.Run(() => Surveiller(_arret.Token));
        }
        await Task.CompletedTask;
    }

    /// <summary>Essai dans une fenêtre sur un autre port ou sans les cartes : on ne touche à rien sur le PC.</summary>
    private bool Reel => reglages.RedirigerCartes && reglages.Port == 53;

    private Navigateurs? _navigateurs;
    private Task? _surveillance;
    private readonly CancellationTokenSource _arret = new();

    /// <summary>Toutes les 15 s : remet en place le DNS des cartes et les réglages des navigateurs s'ils ont changé.</summary>
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
        // En mode test, arrêter le service rend le PC comme avant. En protection, tout reste en place.
        if (reglages.ModeTest && Reel)
        {
            _cartes?.Restaurer();
            _navigateurs?.Retirer();
        }
        if (_serveur is not null) await _serveur.DisposeAsync();
        log.LogInformation("Filtre DNS arrêté.");
    }
}
