using System.Text;

namespace Rempart.Dns;

/// <summary>Question d'une requête DNS (nom en minuscules, sans point final).</summary>
internal sealed record QuestionDns(string Nom, ushort Type, ushort Classe);

/// <summary>Lecture minimale d'une requête DNS et fabrication des réponses de blocage.</summary>
internal static class MessageDns
{
    public const ushort TypeA = 1;
    public const ushort TypeAAAA = 28;
    public const ushort ClasseIN = 1;
    private const int TailleEntete = 12;

    /// <summary>
    /// Lit l'unique question d'une requête. Renvoie null si le message n'est pas une requête standard lisible
    /// (dans ce cas, le serveur la transmet telle quelle : dans le doute on ne bloque pas).
    /// </summary>
    public static QuestionDns? LireQuestion(ReadOnlySpan<byte> m)
    {
        if (m.Length < TailleEntete) return null;
        if ((m[2] & 0x80) != 0) return null;                 // c'est une réponse
        if (((m[2] >> 3) & 0x0F) != 0) return null;           // opcode autre que QUERY
        if ((m[4] << 8 | m[5]) != 1) return null;             // une seule question

        var nom = new StringBuilder();
        int pos = TailleEntete, fin = -1, sauts = 0;
        while (true)
        {
            if (pos >= m.Length) return null;
            int len = m[pos];
            if (len == 0) { pos++; break; }
            if ((len & 0xC0) == 0xC0)                          // pointeur de compression
            {
                if (pos + 1 >= m.Length || ++sauts > 16) return null;
                if (fin < 0) fin = pos + 2;
                pos = (len & 0x3F) << 8 | m[pos + 1];
                continue;
            }
            if ((len & 0xC0) != 0 || pos + 1 + len > m.Length) return null;
            if (nom.Length > 0) nom.Append('.');
            for (int i = 0; i < len; i++) nom.Append(char.ToLowerInvariant((char)m[pos + 1 + i]));
            if (nom.Length > 253) return null;
            pos += 1 + len;
        }
        if (fin < 0) fin = pos;
        if (fin + 4 > m.Length || nom.Length == 0) return null;
        return new QuestionDns(nom.ToString(), (ushort)(m[fin] << 8 | m[fin + 1]), (ushort)(m[fin + 2] << 8 | m[fin + 3]));
    }

    /// <summary>
    /// Réponse de blocage : 0.0.0.0 pour A, :: pour AAAA, réponse vide pour les autres types
    /// (HTTPS, SVCB, MX…) ; NXDOMAIN si demandé.
    /// </summary>
    public static byte[] ReponseBloquee(ReadOnlySpan<byte> requete, QuestionDns q, bool nxdomain = false)
    {
        bool avecAdresse = !nxdomain && q.Classe == ClasseIN && (q.Type == TypeA || q.Type == TypeAAAA);
        return Construire(requete, q, rcode: nxdomain ? 3 : 0, avecAdresse);
    }

    /// <summary>Réponse SERVFAIL (aucun serveur amont n'a répondu) : le client n'attend pas pour rien.</summary>
    public static byte[] ReponseEchec(ReadOnlySpan<byte> requete, QuestionDns q) =>
        Construire(requete, q, rcode: 2, avecAdresse: false);

    private static byte[] Construire(ReadOnlySpan<byte> requete, QuestionDns q, int rcode, bool avecAdresse)
    {
        var r = new List<byte>(64);
        r.Add(requete[0]); r.Add(requete[1]);                  // même identifiant
        r.Add((byte)(0x80 | (requete[2] & 0x79)));             // QR=1, opcode et RD recopiés
        r.Add((byte)(0x80 | rcode));                           // RA=1, RCODE
        r.AddRange([0, 1, 0, (byte)(avecAdresse ? 1 : 0), 0, 0, 0, 0]);
        EcrireNom(r, q.Nom);
        r.AddRange([(byte)(q.Type >> 8), (byte)q.Type, (byte)(q.Classe >> 8), (byte)q.Classe]);
        if (avecAdresse)
        {
            int taille = q.Type == TypeA ? 4 : 16;
            r.AddRange([0xC0, TailleEntete]);                  // nom = pointeur vers la question
            r.AddRange([(byte)(q.Type >> 8), (byte)q.Type, 0, 1]);
            r.AddRange([0, 0, 0, 60]);                         // TTL 60 s
            r.AddRange([0, (byte)taille]);
            r.AddRange(new byte[taille]);                      // 0.0.0.0 ou ::
        }
        return r.ToArray();
    }

    private static void EcrireNom(List<byte> r, string nom)
    {
        foreach (var etiquette in nom.Split('.'))
        {
            r.Add((byte)etiquette.Length);
            foreach (char c in etiquette) r.Add((byte)c);
        }
        r.Add(0);
    }
}
