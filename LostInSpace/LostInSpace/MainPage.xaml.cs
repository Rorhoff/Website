using LostInSpace.Game;

namespace LostInSpace;

public partial class MainPage : ContentPage
{
    readonly GameSession _game = new();
    readonly GamePainter _painter = new();
    bool _joyActive;
    DateTime _lastSaveUtc = DateTime.MinValue;
    IDispatcherTimer? _loop;

    public MainPage()
    {
        InitializeComponent();
        _painter.Session = _game;
        GameCanvas.Drawable = _painter;
        BuildColorSwatches();
        SetupJoystick();
    }

    void BuildColorSwatches()
    {
        ColorFlex.Children.Clear();
        foreach (var hex in GameSession.SuitColors)
        {
            var btn = new Button
            {
                BackgroundColor = Color.FromArgb(hex),
                WidthRequest = 52,
                HeightRequest = 52,
                CornerRadius = 26,
                Margin = 4,
                BorderWidth = 2,
                BorderColor = Colors.White
            };
            var h = hex;
            btn.Clicked += (_, _) =>
            {
                _game.PendingColor = h;
                BtnConfirmColor.IsEnabled = true;
                foreach (var c in ColorFlex.Children.OfType<Button>())
                    c.BorderWidth = 2;
                btn.BorderWidth = 4;
            };
            ColorFlex.Children.Add(btn);
        }
    }

    void SetupJoystick()
    {
        var pan = new PanGestureRecognizer();
        pan.PanUpdated += OnJoyPan;
        JoyZone.GestureRecognizers.Add(pan);
    }

    void OnJoyPan(object? sender, PanUpdatedEventArgs e)
    {
        if (e.StatusType == GestureStatus.Started)
            _joyActive = true;
        else if (e.StatusType == GestureStatus.Running && _joyActive)
        {
            var max = Math.Max(20, Math.Min(JoyZone.Width, JoyZone.Height) / 2 - 28);
            var dx = e.TotalX;
            var dy = e.TotalY;
            var len = Math.Sqrt(dx * dx + dy * dy);
            if (len > max && max > 0)
            {
                dx = dx / len * max;
                dy = dy / len * max;
            }
            JoyKnob.TranslationX = dx;
            JoyKnob.TranslationY = dy;
            _game.JoyX = max > 0 ? (float)(dx / max) : 0;
            _game.JoyY = max > 0 ? (float)(dy / max) : 0;
        }
        else if (e.StatusType is GestureStatus.Completed or GestureStatus.Canceled)
        {
            _joyActive = false;
            JoyKnob.TranslationX = 0;
            JoyKnob.TranslationY = 0;
            _game.JoyX = 0;
            _game.JoyY = 0;
        }
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _loop ??= Dispatcher.CreateTimer();
        _loop.Interval = TimeSpan.FromMilliseconds(16);
        _loop.Tick += GameLoop;
        _loop.Start();
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        if (_loop != null)
        {
            _loop.Stop();
            _loop.Tick -= GameLoop;
        }
    }

    void GameLoop(object? sender, EventArgs e)
    {
        var r = GameCanvas.Width;
        var h = GameCanvas.Height;
        if (r <= 0 || h <= 0) return;

        if (_game.Phase != GamePhase.Playing)
        {
            if (HudPanel.IsVisible)
                SetPlayingChrome(false);
            CraftPanel.IsVisible = false;
            _game.CraftOpen = false;
        }
        else
        {
            _game.Tick(16f, (float)r, (float)h);
            EnergyBar.Progress = _game.Energy / GameSession.EnergyMax;
            DayHud.IsVisible = _game.DaySystemOn;
            if (_game.DaySystemOn)
            {
                DayLabel.Text = $"Day {_game.DayIndex} — hunt before night";
                DayBar.Progress = _game.DayBarPercent();
            }
            CraftPanel.IsVisible = _game.CraftOpen;

            if (!string.IsNullOrEmpty(_game.PopupMessage))
            {
                ShowPopup(_game.PopupMessage!);
                _game.PopupMessage = null;
            }

            var now = DateTime.UtcNow;
            if ((now - _lastSaveUtc).TotalSeconds >= 2)
            {
                GameSaveService.Save(_game);
                _lastSaveUtc = now;
            }
        }

        GameCanvas.Invalidate();
    }

    void ShowPopup(string msg)
    {
        PopupLabel.Text = msg;
        PopupPanel.IsVisible = true;
    }

    void OnPopupOk(object? sender, EventArgs e)
    {
        PopupPanel.IsVisible = false;
        if (_game.Phase == GamePhase.MainMenu)
        {
            SetPlayingChrome(false);
            MenuOverlay.IsVisible = true;
        }
    }

    void OnNewGame(object? sender, EventArgs e)
    {
        MenuOverlay.IsVisible = false;
        ColorOverlay.IsVisible = true;
        _game.PendingColor = null;
        BtnConfirmColor.IsEnabled = false;
        foreach (var c in ColorFlex.Children.OfType<Button>())
            c.BorderWidth = 2;
    }

    void OnLoadGame(object? sender, EventArgs e)
    {
        var data = GameSaveService.Load();
        if (data is null)
        {
            ShowPopup("No save found on this device.");
            return;
        }
        _game.ApplySave(data);
        _game.Phase = GamePhase.Playing;
        MenuOverlay.IsVisible = false;
        ColorOverlay.IsVisible = false;
        CrashOverlay.IsVisible = false;
        SetPlayingChrome(true);
        GameSaveService.Save(_game);
        _lastSaveUtc = DateTime.UtcNow;
    }

    async void OnConfirmColor(object? sender, EventArgs e)
    {
        if (string.IsNullOrEmpty(_game.PendingColor)) return;
        ColorOverlay.IsVisible = false;
        _game.ResetWorldForNewGame(_game.PendingColor!);
        CrashOverlay.IsVisible = true;
        await AnimateCrashAsync();
        CrashOverlay.IsVisible = false;
        _game.Phase = GamePhase.Playing;
        SetPlayingChrome(true);
        GameSaveService.Save(_game);
        _lastSaveUtc = DateTime.UtcNow;
    }

    async Task AnimateCrashAsync()
    {
        var rnd = new Random();
        for (var i = 0; i < 35; i++)
        {
            RootGrid.TranslationX = rnd.Next(-6, 7);
            RootGrid.TranslationY = rnd.Next(-5, 6);
            await Task.Delay(90);
        }
        RootGrid.TranslationX = 0;
        RootGrid.TranslationY = 0;
    }

    void OnColorBack(object? sender, EventArgs e)
    {
        ColorOverlay.IsVisible = false;
        MenuOverlay.IsVisible = true;
    }

    void SetPlayingChrome(bool on)
    {
        HudPanel.IsVisible = on;
        JoyZone.IsVisible = on;
        ActionButtons.IsVisible = on;
        GameCanvas.InputTransparent = !on;
    }

    void OnCraftClicked(object? sender, EventArgs e)
    {
        if (_game.Phase != GamePhase.Playing) return;
        _game.CraftOpen = !_game.CraftOpen;
        CraftPanel.IsVisible = _game.CraftOpen;
    }

    void OnActionClicked(object? sender, EventArgs e)
    {
        if (_game.Phase != GamePhase.Playing) return;
        _game.DoInteractOrAttack();
        GameSaveService.Save(_game);
        _lastSaveUtc = DateTime.UtcNow;
        if (!string.IsNullOrEmpty(_game.PopupMessage))
        {
            ShowPopup(_game.PopupMessage!);
            _game.PopupMessage = null;
        }
    }

    void OnCraftRope(object? sender, EventArgs e)
    {
        _game.CraftRope();
        CraftMaybePopup();
    }

    void OnCraftTrap(object? sender, EventArgs e)
    {
        _game.CraftTrap();
        CraftMaybePopup();
    }

    void OnCraftClub(object? sender, EventArgs e)
    {
        _game.CraftClub();
        CraftMaybePopup();
    }

    void CraftMaybePopup()
    {
        GameSaveService.Save(_game);
        _lastSaveUtc = DateTime.UtcNow;
        if (!string.IsNullOrEmpty(_game.PopupMessage))
        {
            ShowPopup(_game.PopupMessage!);
            _game.PopupMessage = null;
        }
    }

    void OnCraftClose(object? sender, EventArgs e)
    {
        _game.CraftOpen = false;
        CraftPanel.IsVisible = false;
    }
}
