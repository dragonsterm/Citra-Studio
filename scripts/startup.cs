using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;

internal sealed class StartupWindow : Form
{
    private static readonly Color Surface = Color.FromArgb(33, 33, 40);
    private static readonly Color Dot = Color.FromArgb(185, 191, 255);
    private const int SpinnerY = 139;
    private const int Radius = 25;
    private readonly Process launcher;
    private readonly string readyFile;
    private readonly Stopwatch animation = new Stopwatch();
    private readonly Timer frames = new Timer { Interval = 16 };
    private readonly Font statusFont = new Font("Segoe UI", 11);
    private long nextReadyCheck;

    private StartupWindow(Process launcher, string readyFile)
    {
        this.launcher = launcher;
        this.readyFile = readyFile;
        Text = "Starting Citra Studio";
        AccessibleName = Text;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        BackColor = Surface;
        ClientSize = new Size(296, 328);

        StartPosition = FormStartPosition.Manual;
        Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);
        using (var outline = new GraphicsPath())
        {
            const int corner = 20;
            outline.AddArc(0, 0, corner, corner, 180, 90);
            outline.AddArc(Width - corner, 0, corner, corner, 270, 90);
            outline.AddArc(Width - corner, Height - corner, corner, corner, 0, 90);
            outline.AddArc(0, Height - corner, corner, corner, 90, 90);
            outline.CloseFigure();
            Region = new Region(outline);
        }

        frames.Tick += OnFrame;
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        animation.Start();
        frames.Start();
    }

    private void OnFrame(object sender, EventArgs e)
    {
        if (animation.ElapsedMilliseconds >= nextReadyCheck)
        {
            if (File.Exists(readyFile) || launcher.HasExited)
            {
                Close();
                return;
            }
            nextReadyCheck = animation.ElapsedMilliseconds + 48;
        }
        Invalidate(new Rectangle(ClientSize.Width / 2 - 32, SpinnerY - 32, 64, 64));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        float center = ClientSize.Width / 2f;
        double cycle = animation.Elapsed.TotalSeconds / 1.8;
        for (int index = 5; index >= 0; index--)
        {
            // The dots bunch up in the slow part of the orbit and spread out as they accelerate.
            double turn = cycle - index * 0.075;
            double angle = 2 * Math.PI * (turn - 0.082 * Math.Sin(2 * Math.PI * turn) - 0.25);
            float x = center + Radius * (float)Math.Cos(angle);
            float y = SpinnerY + Radius * (float)Math.Sin(angle);
            using (var brush = new SolidBrush(Color.FromArgb(255 - 22 * index, Dot)))
                graphics.FillEllipse(brush, x - 2.7f, y - 2.7f, 5.4f, 5.4f);
        }

        TextRenderer.DrawText(graphics, "Starting Citra Studio\u2026", statusFont,
            new Rectangle(0, 195, ClientSize.Width, 26), Color.FromArgb(243, 243, 249),
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            frames.Dispose();
            statusFont.Dispose();
        }
        base.Dispose(disposing);
    }

    [STAThread]
    private static void Main(string[] args)
    {
        int parentId;
        if (args.Length != 2 || !int.TryParse(args[0], out parentId))
            return;

        string readyFile = Path.Combine(args[1], "citra-ready");
        try
        {
            using (Process launcher = Process.GetProcessById(parentId))
            {
                if (launcher.HasExited || File.Exists(readyFile))
                    return;
                Application.EnableVisualStyles();
                using (var window = new StartupWindow(launcher, readyFile))
                    Application.Run(window);
            }
        }
        catch (ArgumentException)
        {
            // The portable launcher can finish before the splash process starts.
        }
    }
}
