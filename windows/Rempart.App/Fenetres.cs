namespace Rempart.App;

internal static class Style
{
    public static readonly Font Texte = new("Segoe UI", 10f);
    public static readonly Font Titre = new("Segoe UI Semibold", 15f);
    public static readonly Font Code = new("Consolas", 22f, FontStyle.Bold);
    public static readonly Color Vert = Color.FromArgb(22, 128, 61);
    public static readonly Color Orange = Color.FromArgb(180, 95, 6);
    public static readonly Color Rouge = Color.FromArgb(185, 28, 28);
    public static readonly Color Gris = Color.FromArgb(90, 90, 90);

    public static Label Etiquette(Font? police = null, Color? couleur = null) => new()
    {
        AutoSize = true, MaximumSize = new Size(440, 0), Font = police ?? Texte,
        ForeColor = couleur ?? SystemColors.ControlText, Margin = new Padding(0, 0, 0, 10),
    };

    public static Button Bouton(string texte) => new()
    {
        Text = texte, AutoSize = true, Font = Texte, Padding = new Padding(10, 4, 10, 4), Margin = new Padding(0, 0, 10, 0),
    };
}

/// <summary>Fenêtre principale : état de la protection et demande de désinstallation.</summary>
internal sealed class FenetrePrincipale : Form
{
    private readonly Label _etat = Style.Etiquette(Style.Texte);
    private readonly Label _explication = Style.Etiquette();
    private readonly Label _code = Style.Etiquette(Style.Code);
    private readonly Label _detail = Style.Etiquette(couleur: Style.Gris);
    private readonly Button _demander = Style.Bouton(T.S("Demander la désinstallation", "Request uninstall"));
    private readonly Button _annuler = Style.Bouton(T.S("Annuler la demande", "Cancel the request"));
    private readonly Button _copier = Style.Bouton(T.S("Copier le code", "Copy code"));
    private readonly System.Windows.Forms.Timer _minuterie = new() { Interval = 20_000 };

    public FenetrePrincipale()
    {
        Text = "Rempart";
        Font = Style.Texte;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        BackColor = Color.White;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var titre = Style.Etiquette(Style.Titre);
        titre.Text = "Rempart";
        var section = Style.Etiquette(new Font("Segoe UI Semibold", 11f));
        section.Text = T.S("Désinstallation", "Uninstall");
        section.Margin = new Padding(0, 14, 0, 6);

        var boutons = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 4, 0, 0) };
        boutons.Controls.AddRange([_demander, _copier, _annuler]);

        var colonne = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true,
            Padding = new Padding(24, 18, 24, 22), MinimumSize = new Size(500, 0),
        };
        colonne.Controls.AddRange([titre, _etat, section, _explication, _code, _detail, boutons]);
        Controls.Add(colonne);

        _demander.Click += (_, _) => Actualiser(Service.Lire("demander"));
        _annuler.Click += (_, _) => Actualiser(Service.Lire("annuler"));
        _copier.Click += (_, _) => { if (_code.Text.Length > 0) Clipboard.SetText(_code.Text); };
        _minuterie.Tick += (_, _) => Actualiser(Service.Lire());
        _minuterie.Start();
        Actualiser(Service.Lire());
    }

    private void Actualiser(Etat? e)
    {
        SuspendLayout();
        _code.Visible = _copier.Visible = _annuler.Visible = _demander.Visible = _detail.Visible = false;
        _code.Text = "";
        if (e is null)
        {
            _etat.Text = T.S("● Le service Rempart ne répond pas : la protection n'est pas active.",
                             "● The Rempart service is not responding: protection is not active.");
            _etat.ForeColor = Style.Rouge;
            _explication.Text = T.S("Redémarrez le PC. Si le problème continue, réinstallez Rempart.",
                                    "Restart the PC. If the problem persists, reinstall Rempart.");
            ResumeLayout(); return;
        }

        bool test = e.Mode == "test";
        _etat.Text = test ? T.S("● Mode test : rien de réel n'est bloqué.", "● Test mode: nothing real is blocked.")
                          : T.S("● Protection active sur tout le PC.", "● Protection active on the whole PC.");
        _etat.ForeColor = test ? Style.Orange : Style.Vert;

        var maintenant = DateTimeOffset.Now;
        if (e.DemandeLe is null)
        {
            _explication.Text = T.S(
                "Pour désinstaller Rempart, demandez un code. Il s'affichera ici au bout de 24 heures. " +
                "Vous pourrez annuler la demande à tout moment.",
                "To uninstall Rempart, request a code. It will appear here after 24 hours. " +
                "You can cancel the request at any time.");
            _demander.Visible = true;
        }
        else if (e.Code is null)
        {
            var reste = (e.DisponibleLe ?? maintenant) - maintenant;
            _explication.Text = T.S(
                $"Demande enregistrée. Le code s'affichera ici le {T.Date(e.DisponibleLe!.Value)} (dans {T.Duree(reste)}).",
                $"Request recorded. The code will appear here on {T.Date(e.DisponibleLe!.Value)} (in {T.Duree(reste)}).");
            _detail.Text = T.S("Rien ne vous oblige à aller au bout : annulez si l'envie est passée.",
                               "Nothing forces you to go through with it: cancel if the urge has passed.");
            _detail.Visible = _annuler.Visible = true;
        }
        else
        {
            _explication.Text = T.S("Votre code de désinstallation :", "Your uninstall code:");
            _code.Text = e.Code;
            _detail.Text = T.S(
                $"Valable jusqu'au {T.Date(e.ExpireLe!.Value)}. Désinstallez Rempart depuis Paramètres > Applications : " +
                "le code vous sera demandé.",
                $"Valid until {T.Date(e.ExpireLe!.Value)}. Uninstall Rempart from Settings > Apps: you will be asked for the code.");
            _code.Visible = _detail.Visible = _copier.Visible = _annuler.Visible = true;
        }
        ResumeLayout();
    }
}

/// <summary>Saisie du code pendant la désinstallation. Renvoie 0 si la désinstallation est autorisée.</summary>
internal sealed class FenetreCode : Form
{
    private readonly TextBox _saisie = new() { Font = Style.Code, Width = 260, CharacterCasing = CharacterCasing.Upper, MaxLength = 12 };
    private readonly Label _erreur = Style.Etiquette(couleur: Style.Rouge);

    public static int Autoriser()
    {
        var etat = Service.Lire();
        if (etat is null) return 0;                      // service absent ou arrêté : rien à protéger
        if (etat.Mode == "test") return Service.Desinstaller("")?.Ok == true ? 0 : 1;
        using var f = new FenetreCode();
        return f.ShowDialog() == DialogResult.OK ? 0 : 1;
    }

    private FenetreCode()
    {
        Text = T.S("Désinstaller Rempart", "Uninstall Rempart");
        Font = Style.Texte;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        BackColor = Color.White;
        TopMost = true;

        var texte = Style.Etiquette();
        texte.Text = T.S(
            "Entrez le code de désinstallation. Pour l'obtenir : ouvrez l'application Rempart, demandez la " +
            "désinstallation, puis revenez 24 heures plus tard.",
            "Enter the uninstall code. To get it: open the Rempart app, request uninstall, then come back 24 hours later.");
        var ok = Style.Bouton(T.S("Désinstaller", "Uninstall"));
        var annuler = Style.Bouton(T.S("Annuler", "Cancel"));
        annuler.DialogResult = DialogResult.Cancel;
        CancelButton = annuler;
        AcceptButton = ok;
        var ouvrir = Style.Bouton(T.S("Ouvrir Rempart", "Open Rempart"));
        ouvrir.Click += (_, _) => System.Diagnostics.Process.Start(Application.ExecutablePath);

        var boutons = new FlowLayoutPanel { AutoSize = true };
        boutons.Controls.AddRange([ok, annuler, ouvrir]);
        var colonne = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, Padding = new Padding(24, 18, 24, 20),
        };
        _saisie.Margin = new Padding(0, 0, 0, 8);
        colonne.Controls.AddRange([texte, _saisie, _erreur, boutons]);
        Controls.Add(colonne);

        ok.Click += (_, _) =>
        {
            var r = Service.Desinstaller(_saisie.Text);
            if (r is null || r.Ok) { DialogResult = DialogResult.OK; return; }
            _erreur.Text = T.S("Code incorrect ou périmé.", "Incorrect or expired code.");
            _saisie.SelectAll();
        };
    }
}
