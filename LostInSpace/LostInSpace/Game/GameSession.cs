// DEV: Core game rules, world constants, save/load DTOs. Tune MapW/H, StartX/Y, Crack*, economy
// constants here; UI flow is driven from MainPage.xaml.cs (phase changes). Save format: SaveDto.Version.
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LostInSpace.Game;

public enum GamePhase { MainMenu, PickColor, Crash, Playing }

public enum EquippedWeapon { Hands, Stick, Club }

public sealed class Pickup
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = ""; // rock | stick
    public float X { get; set; }
    public float Y { get; set; }
}

public sealed class Slime
{
    public string Id { get; set; } = "";
    public float X { get; set; }
    public float Y { get; set; }
    public int Hp { get; set; }
    public bool Alive { get; set; } = true;
}

public sealed class SaveDto
{
    public int Version { get; set; } = 1;
    public string AstronautColor { get; set; } = "#38bdf8";
    public float Px { get; set; }
    public float Py { get; set; }
    public float FacingX { get; set; }
    public float FacingY { get; set; }
    public int Sticks { get; set; }
    public int Rocks { get; set; }
    public int Rope { get; set; }
    public int Trap { get; set; }
    public int SlimeCorpse { get; set; }
    public string Equipped { get; set; } = "hands";
    public bool ShipRepaired { get; set; }
    public bool BridgeBuilt { get; set; }
    public bool FirstKillDone { get; set; }
    public bool DaySystemOn { get; set; }
    public int DayIndex { get; set; } = 1;
    public bool KillThisDay { get; set; }
    public double Energy { get; set; } = 100;
    public long DayStartTicks { get; set; }
    public List<Pickup> Pickups { get; set; } = new();
    public List<Slime> Slimes { get; set; } = new();
}

/// <summary>Portrait-oriented world: horizontal &quot;black crack&quot; across the middle; start at bottom-right.</summary>
public sealed class GameSession
{
    public const float MapW = 2400f;
    public const float MapH = 4000f;
    public const float CrackY0 = MapH * 0.44f;
    public const float CrackY1 = MapH * 0.50f;
    public static readonly float ShipX = MapW - 260f;
    public static readonly float ShipY = MapH - 280f;
    public const float ShipW = 100f;
    public const float ShipH = 70f;
    public static readonly float StartX = MapW - 120f;
    public static readonly float StartY = MapH - 130f;
    public const float PlayerR = 14f;
    public const float InteractRange = 52f;
    public const float AttackW = 36f;
    public const float AttackH = 28f;
    public const double DayMs = 70_000;
    public const double EnergyMax = 100;
    public const int ShipRocks = 3;
    public const int ShipSticks = 3;
    public const int BridgeSticks = 5;
    public const int SlimeMaxHp = 5;

    public GamePhase Phase { get; set; } = GamePhase.MainMenu;
    public string? PendingColor { get; set; }
    public string AstronautColor { get; set; } = "#38bdf8";
    public float Px { get; set; }
    public float Py { get; set; }
    public float FacingX { get; set; }
    public float FacingY { get; set; } = 1f;
    public float JoyX { get; set; }
    public float JoyY { get; set; }

    public int Sticks { get; set; }
    public int Rocks { get; set; }
    public int Rope { get; set; }
    public int Trap { get; set; }
    public int SlimeCorpse { get; set; }
    public EquippedWeapon Equipped { get; set; } = EquippedWeapon.Hands;

    public bool ShipRepaired { get; set; }
    public bool BridgeBuilt { get; set; }
    public bool FirstKillDone { get; set; }
    public bool DaySystemOn { get; set; }
    public int DayIndex { get; set; } = 1;
    public bool KillThisDay { get; set; }
    public double Energy { get; set; } = EnergyMax;
    public DateTime DayStartUtc { get; set; } = DateTime.UtcNow;

    public List<Pickup> Pickups { get; } = new();
    public List<Slime> Slimes { get; } = new();

    public float AttackFlashMs { get; set; }
    public RectF? AttackBox { get; set; }
    public string? PopupMessage { get; set; }
    public bool CraftOpen { get; set; }

    public DateTime CrashUntilUtc { get; set; }

    public static readonly string[] SuitColors =
    {
        "#38bdf8", "#f472b6", "#4ade80", "#fbbf24", "#fb7185", "#a78bfa", "#2dd4bf", "#f97316"
    };

    public GameSession()
    {
        ResetWorldForNewGame("#38bdf8");
        Phase = GamePhase.MainMenu;
    }

    public void ResetWorldForNewGame(string color)
    {
        AstronautColor = color;
        Px = StartX;
        Py = StartY;
        FacingX = 0;
        FacingY = 1f;
        Sticks = Rocks = Rope = Trap = SlimeCorpse = 0;
        Equipped = EquippedWeapon.Hands;
        ShipRepaired = BridgeBuilt = FirstKillDone = DaySystemOn = false;
        DayIndex = 1;
        KillThisDay = false;
        Energy = EnergyMax;
        DayStartUtc = DateTime.UtcNow;
        Pickups.Clear();
        Slimes.Clear();
        PlaceStarterPickups();
        SpawnSlimes();
    }

    void PlaceStarterPickups()
    {
        for (var i = 0; i < ShipRocks; i++)
        {
            var a = i * 1.1f;
            Pickups.Add(new Pickup
            {
                Id = "r" + i,
                Type = "rock",
                X = ShipX + MathF.Cos(a) * (40 + i * 22),
                Y = ShipY + MathF.Sin(a) * (40 + i * 22)
            });
        }
        for (var i = 0; i < ShipSticks; i++)
        {
            var a = i * 1.4f + 0.5f;
            Pickups.Add(new Pickup
            {
                Id = "s" + i,
                Type = "stick",
                X = ShipX - 70 + MathF.Cos(a) * (35 + i * 18),
                Y = ShipY + 50 + MathF.Sin(a) * (35 + i * 18)
            });
        }
    }

    public void SpawnExplorationSticks()
    {
        var rnd = new Random();
        var placed = 0;
        while (placed < BridgeSticks + 4)
        {
            var x = 100 + (float)rnd.NextDouble() * (MapW - 200);
            var y = (float)(CrackY1 + 80 + rnd.NextDouble() * (MapH - CrackY1 - 200));
            if (Hypot(x - ShipX, y - ShipY) < 180) continue;
            Pickups.Add(new Pickup { Id = "e" + placed, Type = "stick", X = x, Y = y });
            placed++;
        }
    }

    void SpawnSlimes()
    {
        var rnd = new Random();
        for (var i = 0; i < 8; i++)
        {
            var x = 80 + (float)rnd.NextDouble() * (MapW - 160);
            var y = 120 + (float)rnd.NextDouble() * (CrackY0 - 200);
            if (y < 80) continue;
            Slimes.Add(new Slime { Id = "sl" + i, X = x, Y = y, Hp = SlimeMaxHp, Alive = true });
        }
    }

    static float Hypot(float dx, float dy) => MathF.Sqrt(dx * dx + dy * dy);

    public bool InCrackBand(float y) => y >= CrackY0 && y <= CrackY1;

    public bool BlockedAt(float nx, float ny)
    {
        if (nx < PlayerR || nx > MapW - PlayerR || ny < PlayerR || ny > MapH - PlayerR) return true;
        if (!BridgeBuilt && InCrackBand(ny)) return true;
        return false;
    }

    int WeaponDamage() => Equipped switch
    {
        EquippedWeapon.Club => 5,
        EquippedWeapon.Stick => 2,
        _ => 1
    };

    public void Tick(float dtMs, float viewW, float viewH)
    {
        if (Phase != GamePhase.Playing) return;

        var sp = 2.2f * (dtMs / 16f);
        var mx = JoyX * sp;
        var my = JoyY * sp;
        if (Hypot(mx, my) > 0.05f)
        {
            FacingX = JoyX;
            FacingY = JoyY;
        }
        var npx = Px + mx;
        var npy = Py + my;
        if (!BlockedAt(npx, Py)) Px = npx;
        if (!BlockedAt(Px, npy)) Py = npy;

        if (Hypot(mx, my) > 0.04f)
            Energy = Math.Max(0, Energy - 0.018 * Hypot(mx, my));

        if (DaySystemOn)
        {
            var elapsed = (DateTime.UtcNow - DayStartUtc).TotalMilliseconds;
            if (elapsed >= DayMs)
            {
                if (!KillThisDay)
                {
                    PopupMessage = "You didn't hunt in time. Game over.";
                    Phase = GamePhase.MainMenu;
                    GameSaveService.DeleteSave();
                    return;
                }
                DayIndex++;
                KillThisDay = false;
                DayStartUtc = DateTime.UtcNow;
            }
        }

        if (AttackFlashMs > 0) AttackFlashMs = Math.Max(0, AttackFlashMs - dtMs);

        if (Energy <= 0)
        {
            PopupMessage = "Out of energy. Game over.";
            Phase = GamePhase.MainMenu;
            GameSaveService.DeleteSave();
        }
    }

    public (float camX, float camY) Camera(float viewW, float viewH)
    {
        var camX = Math.Clamp(Px - viewW / 2, 0, Math.Max(0, MapW - viewW));
        var camY = Math.Clamp(Py - viewH / 2, 0, Math.Max(0, MapH - viewH));
        return (camX, camY);
    }

    public bool TryPickup()
    {
        Pickup? best = null;
        var bd = InteractRange + 1f;
        foreach (var p in Pickups)
        {
            var d = Hypot(Px - p.X, Py - p.Y);
            if (d < bd)
            {
                bd = d;
                best = p;
            }
        }
        if (best is null || bd > InteractRange) return false;
        if (best.Type == "rock") Rocks++;
        else if (best.Type == "stick")
        {
            Sticks++;
            if (Equipped == EquippedWeapon.Hands) Equipped = EquippedWeapon.Stick;
        }
        Pickups.Remove(best);
        return true;
    }

    public string? TryShipInteract()
    {
        var cx = ShipX + ShipW / 2;
        var cy = ShipY + ShipH / 2;
        if (Hypot(Px - cx, Py - cy) > InteractRange + 28) return null;

        if (!ShipRepaired)
        {
            if (Rocks >= ShipRocks && Sticks >= ShipSticks)
            {
                Rocks -= ShipRocks;
                Sticks -= ShipSticks;
                ShipRepaired = true;
                SpawnExplorationSticks();
                return "Ship repaired! Gather sticks and build a bridge at the dark rift.";
            }
            return $"Need {ShipRocks} rocks and {ShipSticks} sticks at the ship.";
        }
        if (SlimeCorpse > 0)
        {
            SlimeCorpse--;
            Energy = Math.Min(EnergyMax, Energy + 45);
            return "Cooked slime meal. Energy restored.";
        }
        return "Ship is ready. Bring slime remains to cook.";
    }

    public string? TryBridge()
    {
        if (!ShipRepaired || BridgeBuilt) return null;
        var bx = MapW / 2;
        var by = (CrackY0 + CrackY1) / 2;
        if (Hypot(Px - bx, Py - by) > InteractRange + 60) return null;
        if (Sticks >= BridgeSticks)
        {
            Sticks -= BridgeSticks;
            BridgeBuilt = true;
            return "Bridge built! Cross the rift to hunt slimes.";
        }
        return $"Need {BridgeSticks} sticks at the rift to build the bridge.";
    }

    public void DoInteractOrAttack()
    {
        if (Energy < 3) return;
        var shipMsg = TryShipInteract();
        if (shipMsg != null)
        {
            PopupMessage = shipMsg;
            return;
        }
        var bridgeMsg = TryBridge();
        if (bridgeMsg != null)
        {
            PopupMessage = bridgeMsg;
            return;
        }
        if (TryPickup()) return;

        Energy -= 4;
        var len = Hypot(FacingX, FacingY);
        var fx = len > 0.01f ? FacingX / len : 0;
        var fy = len > 0.01f ? FacingY / len : 1f;
        var cx = Px + fx * (PlayerR + 28f);
        var cy = Py + fy * (PlayerR + 28f);
        float bx, by;
        if (MathF.Abs(fx) > MathF.Abs(fy))
        {
            bx = cx + fx * 8 - (fx > 0 ? AttackW : 0);
            by = cy - AttackH / 2;
        }
        else
        {
            bx = cx - AttackW / 2;
            by = cy + fy * 8 - (fy > 0 ? AttackH : 0);
        }
        AttackBox = new RectF(bx, by, AttackW, AttackH);
        AttackFlashMs = 220;

        var dmg = WeaponDamage();
        foreach (var s in Slimes)
        {
            if (!s.Alive) continue;
            if (!CircleRectHit(s.X, s.Y, 14f, bx, by, AttackW, AttackH)) continue;
            s.Hp -= dmg;
            if (s.Hp <= 0)
            {
                s.Alive = false;
                SlimeCorpse++;
                if (!FirstKillDone)
                {
                    FirstKillDone = true;
                    DaySystemOn = true;
                    DayStartUtc = DateTime.UtcNow;
                    KillThisDay = true;
                    PopupMessage = "Its getting dark! I better head back!";
                }
                else KillThisDay = true;
            }
            break;
        }
    }

    static bool CircleRectHit(float cx, float cy, float r, float rx, float ry, float rw, float rh)
    {
        var nx = Math.Clamp(cx, rx, rx + rw);
        var ny = Math.Clamp(cy, ry, ry + rh);
        var dx = cx - nx;
        var dy = cy - ny;
        return dx * dx + dy * dy <= r * r;
    }

    public void CraftRope()
    {
        if (Sticks < 2) { PopupMessage = "Need 2 sticks."; return; }
        Sticks -= 2;
        Rope++;
        CraftOpen = false;
    }

    public void CraftTrap()
    {
        if (Sticks < 2 || Rope < 1) { PopupMessage = "Need 2 sticks and 1 rope."; return; }
        Sticks -= 2;
        Rope--;
        Trap++;
        CraftOpen = false;
    }

    public void CraftClub()
    {
        if (Sticks < 2 || Rocks < 1) { PopupMessage = "Need 2 sticks and 1 rock."; return; }
        Sticks -= 2;
        Rocks--;
        Equipped = EquippedWeapon.Club;
        CraftOpen = false;
    }

    public double DayBarPercent()
    {
        if (!DaySystemOn) return 1;
        var elapsed = (DateTime.UtcNow - DayStartUtc).TotalMilliseconds;
        return Math.Max(0, 1 - elapsed / DayMs);
    }

    public SaveDto ToSave() => new()
    {
        AstronautColor = AstronautColor,
        Px = Px,
        Py = Py,
        FacingX = FacingX,
        FacingY = FacingY,
        Sticks = Sticks,
        Rocks = Rocks,
        Rope = Rope,
        Trap = Trap,
        SlimeCorpse = SlimeCorpse,
        Equipped = Equipped.ToString().ToLowerInvariant(),
        ShipRepaired = ShipRepaired,
        BridgeBuilt = BridgeBuilt,
        FirstKillDone = FirstKillDone,
        DaySystemOn = DaySystemOn,
        DayIndex = DayIndex,
        KillThisDay = KillThisDay,
        Energy = Energy,
        DayStartTicks = DayStartUtc.Ticks,
        Pickups = Pickups.Select(p => new Pickup { Id = p.Id, Type = p.Type, X = p.X, Y = p.Y }).ToList(),
        Slimes = Slimes.Select(s => new Slime { Id = s.Id, X = s.X, Y = s.Y, Hp = s.Hp, Alive = s.Alive }).ToList()
    };

    public void ApplySave(SaveDto d)
    {
        AstronautColor = d.AstronautColor;
        Px = d.Px;
        Py = d.Py;
        FacingX = d.FacingX;
        FacingY = d.FacingY;
        Sticks = d.Sticks;
        Rocks = d.Rocks;
        Rope = d.Rope;
        Trap = d.Trap;
        SlimeCorpse = d.SlimeCorpse;
        Equipped = Enum.TryParse<EquippedWeapon>(d.Equipped, true, out var e) ? e : EquippedWeapon.Hands;
        ShipRepaired = d.ShipRepaired;
        BridgeBuilt = d.BridgeBuilt;
        FirstKillDone = d.FirstKillDone;
        DaySystemOn = d.DaySystemOn;
        DayIndex = d.DayIndex;
        KillThisDay = d.KillThisDay;
        Energy = d.Energy;
        DayStartUtc = d.DayStartTicks > 0 ? new DateTime(d.DayStartTicks, DateTimeKind.Utc) : DateTime.UtcNow;
        Pickups.Clear();
        foreach (var p in d.Pickups) Pickups.Add(p);
        Slimes.Clear();
        foreach (var s in d.Slimes) Slimes.Add(s);
    }
}

public static class GameSaveService
{
    const string FileName = "lost_in_space_save.json";
    static string Path => System.IO.Path.Combine(FileSystem.AppDataDirectory, FileName);

    static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static void Save(GameSession g)
    {
        try
        {
            var json = JsonSerializer.Serialize(g.ToSave(), JsonOpts);
            File.WriteAllText(Path, json);
        }
        catch { /* ignore */ }
    }

    public static SaveDto? Load()
    {
        try
        {
            if (!File.Exists(Path)) return null;
            return JsonSerializer.Deserialize<SaveDto>(File.ReadAllText(Path), JsonOpts);
        }
        catch { return null; }
    }

    public static void DeleteSave()
    {
        try
        {
            if (File.Exists(Path)) File.Delete(Path);
        }
        catch { /* ignore */ }
    }
}
