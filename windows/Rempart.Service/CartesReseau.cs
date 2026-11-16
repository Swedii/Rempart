using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Win32;

namespace Rempart;

/// <summary>Réglage DNS d'origine d'une carte réseau (format partagé avec windows\scripts\remise-a-zero.ps1).</summary>
internal sealed record DnsOrigine(string InterfaceAlias, string Guid, string Mode, string[] Serveurs);

/// <summary>
/// Fait pointer les cartes réseau vers le filtre local (127.0.0.1 / ::1) et sait les remettre comme avant.
/// Le réglage d'origine est sauvegardé AVANT toute modification, une seule fois par carte.
/// </summary>
internal sealed class CartesReseau(string fichierSauvegarde, ILogger log)
{
    private static readonly string[] Boucle = ["127.0.0.1", "::1"];
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    private static IEnumerable<NetworkInterface> CartesActives() =>
        NetworkInterface.GetAllNetworkInterfaces().Where(n =>
            n.OperationalStatus == OperationalStatus.Up &&
            n.NetworkInterfaceType is not (NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) &&
            n.Supports(NetworkInterfaceComponent.IPv4));

    private static string[] LireServeurs(string guid, string valeur)
    {
        using var cle = Registry.LocalMachine.OpenSubKey(
            $@"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{guid}");
        var texte = cle?.GetValue(valeur) as string ?? "";
        return texte.Split([',', ' '], StringSplitOptions.RemoveEmptyEntries);
    }

    public List<DnsOrigine> LireSauvegarde()
    {
        if (!File.Exists(fichierSauvegarde)) return [];
        try { return JsonSerializer.Deserialize<List<DnsOrigine>>(File.ReadAllText(fichierSauvegarde)) ?? []; }
        catch (JsonException) { return []; }
    }

    /// <summary>Serveurs à qui transmettre les requêtes autorisées : DNS d'origine, puis DNS donnés par la box.</summary>
    public List<IPEndPoint> ServeursAmont()
    {
        var adresses = new List<string>();
        foreach (var o in LireSauvegarde().Where(o => o.Mode == "manuel")) adresses.AddRange(o.Serveurs);
        foreach (var carte in CartesActives())
        {
            var manuels = LireServeurs(carte.Id, "NameServer");
            if (!manuels.Any(Boucle.Contains)) adresses.AddRange(manuels);
            adresses.AddRange(LireServeurs(carte.Id, "DhcpNameServer"));
        }
        var amont = adresses.Distinct()
            .Select(a => IPAddress.TryParse(a, out var ip) ? ip : null)
            .Where(ip => ip is not null && !IPAddress.IsLoopback(ip))
            .Select(ip => new IPEndPoint(ip!, 53)).ToList();
        if (amont.Count == 0)
        {
            log.LogWarning("Aucun DNS d'origine trouvé : repli sur 1.1.1.1 et 9.9.9.9.");
            amont = [new(IPAddress.Parse("1.1.1.1"), 53), new(IPAddress.Parse("9.9.9.9"), 53)];
        }
        return amont;
    }

    /// <summary>
    /// Fait pointer chaque carte active vers le filtre local. En mode test, le DNS d'origine reste en secours :
    /// si le service tombe, Internet continue de marcher (sans filtre).
    /// </summary>
    public void Rediriger(bool modeTest)
    {
        var sauvegarde = LireSauvegarde();
        foreach (var carte in CartesActives())
        {
            if (sauvegarde.All(o => o.Guid != carte.Id))
            {
                var manuels = LireServeurs(carte.Id, "NameServer");
                if (!manuels.Any(Boucle.Contains))
                    sauvegarde.Add(new(carte.Name, carte.Id, manuels.Length > 0 ? "manuel" : "auto", manuels));
            }
        }
        Directory.CreateDirectory(Path.GetDirectoryName(fichierSauvegarde)!);
        File.WriteAllText(fichierSauvegarde, JsonSerializer.Serialize(sauvegarde, Json));

        var secours = modeTest ? ServeursAmont().Where(s => s.AddressFamily == AddressFamily.InterNetwork).ToList() : [];
        foreach (var carte in CartesActives())
        {
            var ip = carte.GetIPProperties();
            int index4 = ip.GetIPv4Properties().Index;
            Netsh($"interface ipv4 set dnsservers name={index4} source=static address=127.0.0.1 register=primary validate=no");
            int rang = 2;
            foreach (var s in secours)
                Netsh($"interface ipv4 add dnsservers name={index4} address={s.Address} index={rang++} validate=no");
            if (carte.Supports(NetworkInterfaceComponent.IPv6))
            {
                int index6 = ip.GetIPv6Properties().Index;
                Netsh($"interface ipv6 set dnsservers name={index6} source=static address=::1 register=primary validate=no");
            }
            log.LogInformation("Carte « {Carte} » redirigée vers le filtre local{Secours}.", carte.Name,
                secours.Count > 0 ? $" (secours : {string.Join(", ", secours.Select(s => s.Address))})" : "");
        }
        Netsh("interface ip delete destinationcache");
        Process.Start(new ProcessStartInfo("ipconfig", "/flushdns") { CreateNoWindow = true, UseShellExecute = false })?.WaitForExit(5000);
    }

    /// <summary>
    /// Surveillance : vrai si une carte active ne pointe plus vers le filtre (DNS changé à la main, nouvelle carte
    /// Wi-Fi…). En protection, le filtre doit être le SEUL serveur ; en test, la box reste en secours.
    /// </summary>
    public bool DoitEtreRedirige(bool modeTest)
    {
        foreach (var carte in CartesActives())
        {
            var v4 = LireServeurs(carte.Id, "NameServer");
            if (v4.Length == 0 || v4[0] != "127.0.0.1" || (!modeTest && v4.Length > 1)) return true;
            if (carte.Supports(NetworkInterfaceComponent.IPv6))
            {
                using var cle6 = Registry.LocalMachine.OpenSubKey(
                    $@"SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces\{carte.Id}");
                var v6 = (cle6?.GetValue("NameServer") as string ?? "").Split([',', ' '], StringSplitOptions.RemoveEmptyEntries);
                if (v6 is not ["::1"]) return true;
            }
        }
        return false;
    }

    /// <summary>Remet chaque carte sauvegardée comme avant, puis efface la sauvegarde.</summary>
    public void Restaurer()
    {
        var sauvegarde = LireSauvegarde();
        foreach (var carte in CartesActives())
        {
            var o = sauvegarde.FirstOrDefault(s => s.Guid == carte.Id);
            var ip = carte.GetIPProperties();
            int index4 = ip.GetIPv4Properties().Index;
            if (o is { Mode: "manuel", Serveurs.Length: > 0 })
            {
                Netsh($"interface ipv4 set dnsservers name={index4} source=static address={o.Serveurs[0]} register=primary validate=no");
                for (int i = 1; i < o.Serveurs.Length; i++)
                    Netsh($"interface ipv4 add dnsservers name={index4} address={o.Serveurs[i]} index={i + 1} validate=no");
            }
            else Netsh($"interface ipv4 set dnsservers name={index4} source=dhcp");
            if (carte.Supports(NetworkInterfaceComponent.IPv6))
                Netsh($"interface ipv6 set dnsservers name={ip.GetIPv6Properties().Index} source=dhcp");
            log.LogInformation("Carte « {Carte} » remise comme avant.", carte.Name);
        }
        File.Delete(fichierSauvegarde);
        Process.Start(new ProcessStartInfo("ipconfig", "/flushdns") { CreateNoWindow = true, UseShellExecute = false })?.WaitForExit(5000);
    }

    private void Netsh(string arguments)
    {
        using var p = Process.Start(new ProcessStartInfo("netsh", arguments)
        {
            CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
        })!;
        var sortie = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
        p.WaitForExit(10000);
        if (p.ExitCode != 0) log.LogWarning("netsh {Arguments} : code {Code} {Sortie}", arguments, p.ExitCode, sortie.Trim());
    }
}
