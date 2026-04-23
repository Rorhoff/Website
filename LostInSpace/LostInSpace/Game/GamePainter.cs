using Microsoft.Maui.Graphics;

namespace LostInSpace.Game;

public sealed class GamePainter : IDrawable
{
    public GameSession? Session { get; set; }

    public void Draw(ICanvas canvas, RectF dirtyRect)
    {
        if (Session is null) return;
        var g = Session;
        if (g.Phase != GamePhase.Playing)
        {
            canvas.FillColor = Color.FromArgb("#0d0806");
            canvas.FillRectangle(dirtyRect);
            return;
        }

        var vw = dirtyRect.Width;
        var vh = dirtyRect.Height;
        var (camX, camY) = g.Camera(vw, vh);

        canvas.SaveState();
        canvas.Translate(-camX, -camY);

        // Ground (warm browns — swap for your map texture via IImage if desired)
        canvas.FillColor = Color.FromArgb("#4a3520");
        canvas.FillRectangle(0, 0, GameSession.MapW, GameSession.MapH);
        canvas.FillColor = Color.FromArgb("#3d2914");
        canvas.FillRectangle(0, 0, GameSession.MapW, GameSession.MapH * 0.35f);
        canvas.FillColor = Color.FromArgb("#2d1810");
        canvas.FillRectangle(0, GameSession.MapH * 0.65f, GameSession.MapW, GameSession.MapH * 0.35f);

        // Noise blobs
        var rnd = new Random(42);
        for (var i = 0; i < 120; i++)
        {
            var rx = rnd.Next((int)GameSession.MapW);
            var ry = rnd.Next((int)GameSession.MapH);
            canvas.FillColor = Color.FromRgba(40 + rnd.Next(40), 25 + rnd.Next(30), 15 + rnd.Next(20), 0.35f);
            canvas.FillCircle(rx, ry, 8 + rnd.Next(12));
        }

        // Horizontal rift (black crack)
        canvas.FillColor = Colors.Black;
        canvas.FillRectangle(0, GameSession.CrackY0, GameSession.MapW, GameSession.CrackY1 - GameSession.CrackY0);
        canvas.StrokeColor = Color.FromArgb("#1a1a1a");
        canvas.StrokeSize = 4;
        canvas.DrawLine(0, GameSession.CrackY0, GameSession.MapW, GameSession.CrackY0 + 12);
        canvas.DrawLine(0, GameSession.CrackY1, GameSession.MapW, GameSession.CrackY1 - 10);

        if (g.BridgeBuilt)
        {
            var bw = GameSession.MapW * 0.22f;
            var bx = GameSession.MapW / 2 - bw / 2;
            var by = (GameSession.CrackY0 + GameSession.CrackY1) / 2 - 18;
            canvas.FillColor = Color.FromArgb("#6b4423");
            canvas.FillRectangle(bx, by, bw, 36);
            canvas.StrokeColor = Color.FromArgb("#4a2c12");
            canvas.StrokeSize = 2;
            canvas.DrawRectangle(bx, by, bw, 36);
        }

        // Ship
        canvas.FillColor = Color.FromArgb("#2d3748");
        canvas.FillRectangle(GameSession.ShipX, GameSession.ShipY, GameSession.ShipW, GameSession.ShipH);
        canvas.FillColor = g.ShipRepaired ? Color.FromArgb("#48bb78") : Color.FromArgb("#e53e3e");
        canvas.FillRectangle(GameSession.ShipX + 20, GameSession.ShipY - 8, GameSession.ShipW - 40, 12);

        // Pickups
        foreach (var p in g.Pickups)
        {
            if (p.Type == "rock")
            {
                canvas.FillColor = Color.FromArgb("#718096");
                canvas.FillCircle(p.X, p.Y, 10);
            }
            else
            {
                canvas.StrokeColor = Color.FromArgb("#744210");
                canvas.StrokeSize = 4;
                canvas.DrawLine(p.X - 10, p.Y + 6, p.X + 10, p.Y - 6);
            }
        }

        // Slimes (purple blobs — swap for sprite textures if you add PNGs to Resources/Raw)
        foreach (var s in g.Slimes)
        {
            if (!s.Alive) continue;
            canvas.FillColor = Color.FromArgb("#9333ea");
            canvas.FillCircle(s.X, s.Y, 16);
            canvas.FillColor = Color.FromArgb("#c084fc");
            canvas.FillCircle(s.X - 5, s.Y - 4, 4);
            canvas.FillCircle(s.X + 6, s.Y - 2, 3);
        }

        // Start marker
        canvas.FillColor = Colors.Red;
        canvas.FillCircle(GameSession.StartX, GameSession.StartY, 5);

        // Astronaut
        var hx = g.Px + g.FacingX * (GameSession.PlayerR + 8);
        var hy = g.Py + g.FacingY * (GameSession.PlayerR + 8);
        Color suit;
        try { suit = Color.FromArgb(g.AstronautColor); }
        catch { suit = Color.FromArgb("#38bdf8"); }
        canvas.FillColor = suit;
        canvas.FillCircle(hx, hy - 10, 8);
        canvas.FillRectangle(hx - 7, hy - 4, 14, 18);

        if (g.AttackFlashMs > 0 && g.AttackBox is { } ab)
        {
            canvas.FillColor = Color.FromRgba(239, 68, 68, 0.55f);
            canvas.FillRectangle(ab.X, ab.Y, ab.Width, ab.Height);
            canvas.StrokeColor = Color.FromArgb("#dc2626");
            canvas.StrokeSize = 2;
            canvas.DrawRectangle(ab.X, ab.Y, ab.Width, ab.Height);
        }

        canvas.RestoreState();
    }
}
