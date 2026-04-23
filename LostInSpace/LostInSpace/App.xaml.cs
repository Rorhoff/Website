namespace LostInSpace;

// DEV: Application root; MainPage is AppShell (single navigation host).
public partial class App : Application
{
    public App()
    {
        InitializeComponent();
        MainPage = new AppShell();
    }
}
