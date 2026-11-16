using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Extensions.Logging;

namespace Rempart;

/// <summary>
/// Canal local (tube nommé « Rempart ») entre le service et l'application / le désinstalleur.
/// Une ligne de commande en entrée, une ligne JSON en sortie. Ouvert aux utilisateurs connectés du PC seulement.
/// </summary>
internal sealed class CanalCommande(Func<string, string> traiter, ILogger log) : IAsyncDisposable
{
    public const string Nom = "Rempart";
    private readonly CancellationTokenSource _arret = new();
    private Task? _boucle;

    public void Demarrer() => _boucle = Task.Run(Boucle);

    private async Task Boucle()
    {
        var securite = new PipeSecurity();
        securite.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
            PipeAccessRights.ReadWrite, AccessControlType.Allow));
        securite.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        securite.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            PipeAccessRights.FullControl, AccessControlType.Allow));

        while (!_arret.IsCancellationRequested)
        {
            try
            {
                await using var tube = NamedPipeServerStreamAcl.Create(Nom, PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, securite);
                await tube.WaitForConnectionAsync(_arret.Token);
                using var delai = CancellationTokenSource.CreateLinkedTokenSource(_arret.Token);
                delai.CancelAfter(TimeSpan.FromSeconds(10));
                using var lecteur = new StreamReader(tube, leaveOpen: true);
                await using var ecrivain = new StreamWriter(tube, leaveOpen: true) { AutoFlush = true };
                var demande = await lecteur.ReadLineAsync(delai.Token) ?? "";
                await ecrivain.WriteLineAsync(traiter(demande.Trim()).AsMemory(), delai.Token);
            }
            catch (OperationCanceledException) when (_arret.IsCancellationRequested) { return; }
            catch (Exception e) { log.LogWarning("Canal de commande : {Erreur}", e.Message); await Task.Delay(500); }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _arret.Cancel();
        if (_boucle is not null) try { await _boucle.WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
    }
}
