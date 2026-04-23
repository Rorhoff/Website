using Foundation;

namespace LostInSpace;

// DEV: iOS app delegate; CreateMauiApp wires DI — same as MauiProgram.
[Register("AppDelegate")]
public class AppDelegate : MauiUIApplicationDelegate
{
    protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}
