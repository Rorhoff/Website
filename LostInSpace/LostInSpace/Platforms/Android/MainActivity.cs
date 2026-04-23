using Android.App;
using Android.Content.PM;

namespace LostInSpace;

// DEV: Android entry activity; theme/orientation flags follow MAUI template — adjust for fullscreen/immersive if needed.
[Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true,
    ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
public class MainActivity : MauiAppCompatActivity
{
}
