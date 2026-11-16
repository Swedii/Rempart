using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Logging;

namespace Rempart.Dns;

/// <summary>
/// Petit serveur DNS local : répond lui-même pour les domaines bloqués et transmet tout le reste, sans le modifier,
/// aux serveurs DNS d'origine (box, fournisseur d'accès). Écoute en UDP et en TCP.
/// </summary>
internal sealed class ServeurDns : IAsyncDisposable
{
    private static readonly TimeSpan DelaiAmont = TimeSpan.FromSeconds(2.5);
    private static readonly TimeSpan DelaiClientTcp = TimeSpan.FromSeconds(10);
    // Désactive l'erreur « connexion réinitialisée » que Windows remonte sur un socket UDP après un ICMP.
    private const int SIO_UDP_CONNRESET = -1744830452;

    private readonly Func<string, Decision> _decider;
    private readonly IReadOnlyList<IPEndPoint> _amont;
    private readonly ILogger _log;
    private readonly CancellationTokenSource _arret = new();
    private readonly List<UdpClient> _udp = [];
    private readonly List<TcpListener> _tcp = [];
    private readonly List<Task> _boucles = [];

    public enum Decision { Transmettre, Bloquer, NxDomain }

    public ServeurDns(Func<string, Decision> decider, IReadOnlyList<IPEndPoint> amont, ILogger log)
    {
        _decider = decider;
        _amont = amont;
        _log = log;
    }

    /// <summary>Ports réellement ouverts (utile quand on demande le port 0 dans les tests).</summary>
    public List<IPEndPoint> PointsUdp { get; } = [];
    public List<IPEndPoint> PointsTcp { get; } = [];

    public void Demarrer(IEnumerable<IPEndPoint> ecoute)
    {
        foreach (var point in ecoute)
        {
            var udp = new UdpClient(point.AddressFamily);
            udp.Client.IOControl(SIO_UDP_CONNRESET, [0, 0, 0, 0], null);
            udp.Client.Bind(point);
            _udp.Add(udp);
            PointsUdp.Add((IPEndPoint)udp.Client.LocalEndPoint!);
            _boucles.Add(Task.Run(() => BoucleUdp(udp)));

            var tcp = new TcpListener(new IPEndPoint(point.Address, point.Port == 0 ? 0 : point.Port));
            tcp.Start();
            _tcp.Add(tcp);
            PointsTcp.Add((IPEndPoint)tcp.LocalEndpoint);
            _boucles.Add(Task.Run(() => BoucleTcp(tcp)));
        }
    }

    // ---------------------------------------------------------------------------------------------------------
    internal async Task<byte[]?> Repondre(byte[] requete, bool viaTcp)
    {
        var q = MessageDns.LireQuestion(requete);
        if (q is not null)
        {
            switch (_decider(q.Nom))
            {
                case Decision.Bloquer: return MessageDns.ReponseBloquee(requete, q);
                case Decision.NxDomain: return MessageDns.ReponseBloquee(requete, q, nxdomain: true);
            }
        }
        foreach (var serveur in _amont)
        {
            try
            {
                var reponse = viaTcp ? await TransmettreTcp(serveur, requete) : await TransmettreUdp(serveur, requete);
                if (reponse is { Length: >= 12 } && reponse[0] == requete[0] && reponse[1] == requete[1]) return reponse;
            }
            catch (Exception e) when (e is SocketException or OperationCanceledException or IOException)
            {
                _log.LogDebug("Serveur amont {Serveur} muet : {Erreur}", serveur, e.Message);
            }
        }
        return q is null ? null : MessageDns.ReponseEchec(requete, q);
    }

    private async Task<byte[]> TransmettreUdp(IPEndPoint serveur, byte[] requete)
    {
        using var client = new UdpClient(serveur.AddressFamily);
        client.Connect(serveur);
        using var delai = CancellationTokenSource.CreateLinkedTokenSource(_arret.Token);
        delai.CancelAfter(DelaiAmont);
        await client.SendAsync(requete, delai.Token);
        while (true)
        {
            var r = await client.ReceiveAsync(delai.Token);
            if (r.Buffer.Length >= 2 && r.Buffer[0] == requete[0] && r.Buffer[1] == requete[1]) return r.Buffer;
        }
    }

    private async Task<byte[]> TransmettreTcp(IPEndPoint serveur, byte[] requete)
    {
        using var delai = CancellationTokenSource.CreateLinkedTokenSource(_arret.Token);
        delai.CancelAfter(DelaiAmont * 2);
        using var client = new TcpClient(serveur.AddressFamily);
        await client.ConnectAsync(serveur, delai.Token);
        var flux = client.GetStream();
        await EcrireTcp(flux, requete, delai.Token);
        return await LireTcp(flux, delai.Token) ?? throw new IOException("réponse TCP vide");
    }

    // ---------------------------------------------------------------------------------------------------------
    private async Task BoucleUdp(UdpClient udp)
    {
        while (!_arret.IsCancellationRequested)
        {
            UdpReceiveResult recu;
            try { recu = await udp.ReceiveAsync(_arret.Token); }
            catch (OperationCanceledException) { return; }
            catch (ObjectDisposedException) { return; }
            catch (SocketException e) { _log.LogDebug("UDP : {Erreur}", e.Message); continue; }

            _ = Task.Run(async () =>
            {
                try
                {
                    var reponse = await Repondre(recu.Buffer, viaTcp: false);
                    if (reponse is not null) await udp.SendAsync(reponse, recu.RemoteEndPoint, _arret.Token);
                }
                catch (Exception e) { _log.LogDebug("UDP : {Erreur}", e.Message); }
            });
        }
    }

    private async Task BoucleTcp(TcpListener ecoute)
    {
        while (!_arret.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await ecoute.AcceptTcpClientAsync(_arret.Token); }
            catch (OperationCanceledException) { return; }
            catch (ObjectDisposedException) { return; }
            catch (SocketException e) { _log.LogDebug("TCP : {Erreur}", e.Message); continue; }
            _ = Task.Run(() => ServirClientTcp(client));
        }
    }

    private async Task ServirClientTcp(TcpClient client)
    {
        using (client)
        {
            try
            {
                var flux = client.GetStream();
                while (!_arret.IsCancellationRequested)
                {
                    using var delai = CancellationTokenSource.CreateLinkedTokenSource(_arret.Token);
                    delai.CancelAfter(DelaiClientTcp);
                    var requete = await LireTcp(flux, delai.Token);
                    if (requete is null) return;
                    var reponse = await Repondre(requete, viaTcp: true);
                    if (reponse is null) return;
                    await EcrireTcp(flux, reponse, delai.Token);
                }
            }
            catch (Exception e) when (e is IOException or OperationCanceledException or SocketException) { }
        }
    }

    private static async Task<byte[]?> LireTcp(Stream flux, CancellationToken jeton)
    {
        var tailleOctets = new byte[2];
        try { await flux.ReadExactlyAsync(tailleOctets, jeton); }
        catch (EndOfStreamException) { return null; }
        int taille = BinaryPrimitives.ReadUInt16BigEndian(tailleOctets);
        if (taille == 0) return null;
        var message = new byte[taille];
        await flux.ReadExactlyAsync(message, jeton);
        return message;
    }

    private static async Task EcrireTcp(Stream flux, byte[] message, CancellationToken jeton)
    {
        var tampon = new byte[message.Length + 2];
        BinaryPrimitives.WriteUInt16BigEndian(tampon, (ushort)message.Length);
        message.CopyTo(tampon, 2);
        await flux.WriteAsync(tampon, jeton);
    }

    public async ValueTask DisposeAsync()
    {
        _arret.Cancel();
        foreach (var u in _udp) u.Dispose();
        foreach (var t in _tcp) t.Stop();
        try { await Task.WhenAll(_boucles).WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
        _arret.Dispose();
    }
}
