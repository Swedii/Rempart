using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Logging.Abstractions;
using Rempart;
using Rempart.Dns;

namespace Rempart.Tests;

public class FiltreDnsTests
{
    // ---- Outils -----------------------------------------------------------------------------------------------
    private static byte[] Requete(string nom, ushort type = MessageDns.TypeA, ushort id = 0x1234)
    {
        var r = new List<byte> { (byte)(id >> 8), (byte)id, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0 };
        foreach (var e in nom.Split('.')) { r.Add((byte)e.Length); r.AddRange(e.Select(c => (byte)c)); }
        r.AddRange([0, (byte)(type >> 8), (byte)type, 0, 1]);
        return r.ToArray();
    }

    private static ushort Compte(byte[] m, int offset) => BinaryPrimitives.ReadUInt16BigEndian(m.AsSpan(offset));
    private static int Rcode(byte[] m) => m[3] & 0x0F;
    private static byte[] DerniersOctets(byte[] m, int n) => m[^n..];

    /// <summary>Faux serveur amont : répond 1.2.3.4 à toute requête A, en UDP et en TCP.</summary>
    private sealed class FauxAmont : IDisposable
    {
        private readonly UdpClient _udp = new(new IPEndPoint(IPAddress.Loopback, 0));
        private readonly TcpListener _tcp;
        public int Requetes;
        public IPEndPoint PointUdp => (IPEndPoint)_udp.Client.LocalEndPoint!;

        public FauxAmont()
        {
            _tcp = new TcpListener(IPAddress.Loopback, PointUdp.Port);
            _tcp.Start();
            _ = Task.Run(async () =>
            {
                while (true)
                {
                    try
                    {
                        var r = await _udp.ReceiveAsync();
                        Interlocked.Increment(ref Requetes);
                        await _udp.SendAsync(Repondre(r.Buffer), r.RemoteEndPoint);
                    }
                    catch { return; }
                }
            });
            _ = Task.Run(async () =>
            {
                while (true)
                {
                    try
                    {
                        using var c = await _tcp.AcceptTcpClientAsync();
                        var f = c.GetStream();
                        var t = new byte[2]; await f.ReadExactlyAsync(t);
                        var m = new byte[BinaryPrimitives.ReadUInt16BigEndian(t)]; await f.ReadExactlyAsync(m);
                        Interlocked.Increment(ref Requetes);
                        var rep = Repondre(m);
                        var sortie = new byte[rep.Length + 2];
                        BinaryPrimitives.WriteUInt16BigEndian(sortie, (ushort)rep.Length);
                        rep.CopyTo(sortie, 2);
                        await f.WriteAsync(sortie);
                    }
                    catch { return; }
                }
            });
        }

        private static byte[] Repondre(byte[] q)
        {
            var r = q.ToList();
            r[2] |= 0x80; r[3] = 0x80; r[7] = 1;
            r.AddRange([0xC0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 1, 2, 3, 4]);
            return r.ToArray();
        }

        public void Dispose() { _udp.Dispose(); _tcp.Stop(); }
    }

    private static async Task<byte[]> InterrogerUdp(IPEndPoint serveur, byte[] requete)
    {
        using var c = new UdpClient(serveur.AddressFamily);
        c.Connect(serveur);
        await c.SendAsync(requete);
        using var delai = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        return (await c.ReceiveAsync(delai.Token)).Buffer;
    }

    private static async Task<byte[]> InterrogerTcp(IPEndPoint serveur, byte[] requete)
    {
        using var c = new TcpClient(serveur.AddressFamily);
        await c.ConnectAsync(serveur);
        var f = c.GetStream();
        var sortie = new byte[requete.Length + 2];
        BinaryPrimitives.WriteUInt16BigEndian(sortie, (ushort)requete.Length);
        requete.CopyTo(sortie, 2);
        await f.WriteAsync(sortie);
        var t = new byte[2]; await f.ReadExactlyAsync(t);
        var m = new byte[BinaryPrimitives.ReadUInt16BigEndian(t)]; await f.ReadExactlyAsync(m);
        return m;
    }

    // ---- Lecture des requêtes ---------------------------------------------------------------------------------
    [Fact]
    public void LitLaQuestionEnMinuscules()
    {
        var q = MessageDns.LireQuestion(Requete("WWW.Exemple.COM", MessageDns.TypeAAAA));
        Assert.Equal(new QuestionDns("www.exemple.com", MessageDns.TypeAAAA, 1), q);
    }

    [Fact]
    public void IgnoreLesMessagesIllisibles()
    {
        Assert.Null(MessageDns.LireQuestion([1, 2, 3]));
        var reponse = Requete("exemple.com"); reponse[2] |= 0x80;
        Assert.Null(MessageDns.LireQuestion(reponse));                     // une réponse, pas une requête
        var tronquee = Requete("exemple.com")[..20];
        Assert.Null(MessageDns.LireQuestion(tronquee));
        var boucle = Requete("a")[..12].Concat(new byte[] { 0xC0, 12, 0, 1, 0, 1 }).ToArray();
        Assert.Null(MessageDns.LireQuestion(boucle));                      // pointeur qui boucle sur lui-même
    }

    [Fact]
    public void ReponseBloqueeDonne0000PourA()
    {
        var req = Requete("bloque.com");
        var rep = MessageDns.ReponseBloquee(req, MessageDns.LireQuestion(req)!);
        Assert.Equal(0x12, rep[0]); Assert.Equal(0x34, rep[1]);
        Assert.True((rep[2] & 0x80) != 0);
        Assert.Equal(0, Rcode(rep));
        Assert.Equal(1, Compte(rep, 6));
        Assert.Equal(new byte[] { 0, 4, 0, 0, 0, 0 }, DerniersOctets(rep, 6));
        Assert.Equal("bloque.com", MessageDns.LireQuestion(req)!.Nom);
    }

    [Fact]
    public void ReponseBloqueeDonneDeuxPointsPourAAAAEtVidePourLesAutresTypes()
    {
        var req6 = Requete("bloque.com", MessageDns.TypeAAAA);
        var rep6 = MessageDns.ReponseBloquee(req6, MessageDns.LireQuestion(req6)!);
        Assert.Equal(new byte[18].AsSpan(2).ToArray().Prepend((byte)16).Prepend((byte)0).ToArray(), DerniersOctets(rep6, 18));

        var reqHttps = Requete("bloque.com", 65);
        var repHttps = MessageDns.ReponseBloquee(reqHttps, MessageDns.LireQuestion(reqHttps)!);
        Assert.Equal(0, Compte(repHttps, 6));
        Assert.Equal(0, Rcode(repHttps));

        var repNx = MessageDns.ReponseBloquee(reqHttps, MessageDns.LireQuestion(reqHttps)!, nxdomain: true);
        Assert.Equal(3, Rcode(repNx));
    }

    // ---- Liste ------------------------------------------------------------------------------------------------
    [Fact]
    public void BloqueLeDomaineEtSesSousDomainesSeulement()
    {
        var liste = new ListeBlocage(["exemple.com", "Majuscules.NET", "# commentaire", ""]);
        Assert.True(liste.EstBloque("exemple.com"));
        Assert.True(liste.EstBloque("www.exemple.com."));
        Assert.True(liste.EstBloque("a.b.EXEMPLE.com"));
        Assert.True(liste.EstBloque("majuscules.net"));
        Assert.False(liste.EstBloque("autreexemple.com"));               // pas un sous-domaine
        Assert.False(liste.EstBloque("exemple.com.fr"));
        Assert.False(liste.EstBloque("com"));
        Assert.Equal(2, liste.Nombre);
    }

    [Fact]
    public void LaVraieListeSeCharge()
    {
        var chemin = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "data", "blocklist.txt"));
        if (!File.Exists(chemin)) return;                                  // liste générée absente : rien à vérifier
        var liste = ListeBlocage.DepuisFichier(chemin);
        Assert.True(liste.Nombre > 100_000);
        foreach (var legitime in new[] { "google.com", "wikipedia.org", "service-public.fr", "doctissimo.fr", "github.io" })
            Assert.False(liste.EstBloque(legitime), legitime);
    }

    // ---- Remise à zéro ----------------------------------------------------------------------------------------
    [Fact]
    public void LaRemiseAZeroConnaitChaqueReglagePose()
    {
        var script = File.ReadAllText(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
            "..", "..", "..", "..", "scripts", "remise-a-zero.ps1")));
        var sousCles = System.Text.RegularExpressions.Regex.Match(script, @"\$SousClesNavigateurs = @\((.*?)\)",
            System.Text.RegularExpressions.RegexOptions.Singleline).Groups[1].Value;
        foreach (var r in Navigateurs.Liste)
        {
            bool sousCleRetiree = sousCles.Contains($"'HKLM:\\{r.Cle}'");
            Assert.True(sousCleRetiree || (script.Contains($"'HKLM:\\{r.Cle}'") && script.Contains($"'{r.Nom}'")),
                $"remise-a-zero.ps1 ne retire pas {r.Cle}\\{r.Nom}");
        }
        foreach (var chemin in Navigateurs.ListesForcees)
            Assert.Contains($"'HKLM:\\{chemin}'", script);
        var ids = System.Text.RegularExpressions.Regex.Match(script, @"\$IdsExtension\s*=\s*@\((.*?)\)").Groups[1].Value;
        Assert.Contains($"'{Navigateurs.IdExtension}'", ids);
    }

    [Fact]
    public void ListeForceeGardeLesAutresEtNeLaissePasDeTrou()
    {
        var autre = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;https://exemple.invalid/crx";
        var rempart = Navigateurs.EntreeExtension;

        // Vide : Rempart en 1. Déjà bien inscrit : rien à faire.
        Assert.Equal([rempart], Navigateurs.ListeForceeVoulue([], avecRempart: true));
        Assert.Null(Navigateurs.ListeForceeVoulue([(1, autre), (2, rempart)], avecRempart: true));
        // Un autre logiciel occupe le 1 : Rempart se range après lui.
        Assert.Equal([autre, rempart], Navigateurs.ListeForceeVoulue([(1, autre)], avecRempart: true));
        // Adresse de mise à jour sabotée ou doublon : remis proprement.
        Assert.Equal([autre, rempart], Navigateurs.ListeForceeVoulue(
            [(1, Navigateurs.IdExtension + ";https://faux.invalid"), (2, autre)], avecRempart: true));
        Assert.Equal([rempart], Navigateurs.ListeForceeVoulue([(1, rempart), (2, rempart)], avecRempart: true));
        // Trou dans la numérotation : renuméroté.
        Assert.Equal([autre, rempart], Navigateurs.ListeForceeVoulue([(1, autre), (3, rempart)], avecRempart: true));
        // Retrait : seule l'entrée de Rempart part, sans laisser de trou.
        Assert.Equal([autre], Navigateurs.ListeForceeVoulue([(1, rempart), (2, autre)], avecRempart: false));
        Assert.Null(Navigateurs.ListeForceeVoulue([(1, autre)], avecRempart: false));
    }

    // ---- Serveur complet --------------------------------------------------------------------------------------
    private static ServeurDns.Decision Decider(string nom) => nom switch
    {
        "bloque.com" or "www.bloque.com" => ServeurDns.Decision.Bloquer,
        "use-application-dns.net" => ServeurDns.Decision.NxDomain,
        _ => ServeurDns.Decision.Transmettre,
    };

    [Fact]
    public async Task BloqueEtTransmetEnUdpEtTcp()
    {
        using var amont = new FauxAmont();
        await using var serveur = new ServeurDns(Decider, [amont.PointUdp], NullLogger.Instance);
        serveur.Demarrer([new IPEndPoint(IPAddress.Loopback, 0)]);

        var bloque = await InterrogerUdp(serveur.PointsUdp[0], Requete("www.bloque.com"));
        Assert.Equal(new byte[] { 0, 0, 0, 0 }, DerniersOctets(bloque, 4));
        Assert.Equal(0, amont.Requetes);                                   // un domaine bloqué ne sort jamais

        var autorise = await InterrogerUdp(serveur.PointsUdp[0], Requete("wikipedia.org", id: 0x4242));
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, DerniersOctets(autorise, 4));
        Assert.Equal(0x42, autorise[0]);

        var parTcp = await InterrogerTcp(serveur.PointsTcp[0], Requete("wikipedia.org"));
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, DerniersOctets(parTcp, 4));
        var bloqueTcp = await InterrogerTcp(serveur.PointsTcp[0], Requete("bloque.com"));
        Assert.Equal(new byte[] { 0, 0, 0, 0 }, DerniersOctets(bloqueTcp, 4));

        var canari = await InterrogerUdp(serveur.PointsUdp[0], Requete("use-application-dns.net"));
        Assert.Equal(3, Rcode(canari));
        Assert.Equal(2, amont.Requetes);
    }

    [Fact]
    public async Task RepondEchecSiAucunAmontNeRepond()
    {
        // Port fermé : aucun serveur amont ne répond.
        var muet = new IPEndPoint(IPAddress.Loopback, 9);
        await using var serveur = new ServeurDns(Decider, [muet], NullLogger.Instance);
        serveur.Demarrer([new IPEndPoint(IPAddress.Loopback, 0)]);
        var rep = await InterrogerUdp(serveur.PointsUdp[0], Requete("wikipedia.org"));
        Assert.Equal(2, Rcode(rep));
        Assert.Equal(0x12, rep[0]);
    }
}
