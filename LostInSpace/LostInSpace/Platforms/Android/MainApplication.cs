using Android.App;
using Android.Runtime;

namespace LostInSpace;

// DEV: Android Application subclass — CreateMauiApp bootstraps the MAUI host.
[Application]
public class MainApplication : MauiApplication
{
    public MainApplication(IntPtr handle, JniHandleOwnership ownership) : base(handle, ownership) { }

    protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}
