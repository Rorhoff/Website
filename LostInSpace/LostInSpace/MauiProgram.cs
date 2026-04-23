namespace LostInSpace;

// DEV: MAUI app composition entry. Add fonts, handlers, or third-party init inside CreateMauiApp.
public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder
            .UseMauiApp<App>()
            .ConfigureFonts(fonts => { });

        return builder.Build();
    }
}
