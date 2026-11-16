using System.Collections.Frozen;

namespace Rempart;

/// <summary>
/// Domaines bloqués. Même règle que l'extension (requestDomains) : un nom est bloqué si lui-même ou l'un de ses
/// parents est dans la liste (« www.exemple.com » et « cdn.exemple.com » sont bloqués si « exemple.com » l'est).
/// </summary>
internal sealed class ListeBlocage
{
    private readonly FrozenSet<string> _domaines;

    public ListeBlocage(IEnumerable<string> domaines) =>
        _domaines = domaines.Select(Normaliser).Where(d => d.Length > 0 && !d.StartsWith('#')).ToFrozenSet(StringComparer.Ordinal);

    public int Nombre => _domaines.Count;

    public static ListeBlocage DepuisFichier(string chemin) => new(File.ReadLines(chemin));

    public bool EstBloque(string nom)
    {
        nom = Normaliser(nom);
        while (nom.Length > 0)
        {
            if (_domaines.Contains(nom)) return true;
            int point = nom.IndexOf('.');
            if (point < 0) return false;
            nom = nom[(point + 1)..];
        }
        return false;
    }

    private static string Normaliser(string d) => d.Trim().TrimEnd('.').ToLowerInvariant();
}
