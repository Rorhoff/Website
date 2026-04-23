using UIKit;

namespace LostInSpace;

// DEV: iOS process entry; hands off to AppDelegate for MAUI startup.
public class Program
{
    static void Main(string[] args) => UIApplication.Main(args, null, typeof(AppDelegate));
}
