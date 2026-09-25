using GenHTTP.Api.Content.IO;
using GenHTTP.Modules.IO;
using GenHTTP.Modules.Files;
using GenHTTP.Modules.Files.Multi;
using GenHTTP.Modules.SinglePageApplications;
using GenHTTP.Modules.SinglePageApplications.Provider;

/// <summary>
/// A folder beside the program, the way the platform gave you one.
/// </summary>
public sealed class Folder
{
    private readonly string _root;

    public Folder(string root)
    {
        _root = Path.GetFullPath(root);

        Directory.CreateDirectory(_root);
    }

    public string Root => _root;

    public bool Exists(string name) => File.Exists(Resolve(name));

    public string ReadText(string name) => File.ReadAllText(Resolve(name));

    public byte[] ReadBytes(string name) => File.ReadAllBytes(Resolve(name));

    public void WriteText(string name, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Resolve(name))!);
        File.WriteAllText(Resolve(name), content);
    }

    public void WriteBytes(string name, byte[] content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Resolve(name))!);
        File.WriteAllBytes(Resolve(name), content);
    }

    public void Delete(string name)
    {
        if (File.Exists(Resolve(name))) File.Delete(Resolve(name));
    }

    public void CreateFolder(string name) => Directory.CreateDirectory(Resolve(name));

    public string[] List()
        => Directory.Exists(_root)
         ? [.. Directory.GetFiles(_root, "*", SearchOption.AllDirectories)
                        .Select(p => p[(_root.Length + 1)..].Replace('\\', '/'))]
         : [];

    public string[] Folders()
        => Directory.Exists(_root)
         ? [.. Directory.GetDirectories(_root, "*", SearchOption.AllDirectories)
                        .Select(p => p[(_root.Length + 1)..].Replace('\\', '/'))]
         : [];

    public IResourceTree Tree() => ResourceTree.FromDirectory(_root).Build();

    public IResourceTree Tree(string folder) => ResourceTree.FromDirectory(Resolve(folder)).Build();

    public TreeAssetsBuilder Files() => Assets.From(Tree());

    public TreeAssetsBuilder Files(string folder) => Assets.From(Tree(folder));

    public SinglePageBuilder App() => SinglePageApplication.From(Tree()).ServerSideRouting();

    public SinglePageBuilder App(string folder) => SinglePageApplication.From(Tree(folder)).ServerSideRouting();

    private string Resolve(string name)
    {
        var resolved = Path.GetFullPath(Path.Combine(_root, name));

        if (!resolved.StartsWith(_root, StringComparison.Ordinal))
        {
            throw new ArgumentException("That is outside the folder.", nameof(name));
        }

        return resolved;
    }
}

/// <summary>
/// The two names a lambda could use without declaring them.
/// </summary>
public static class Lambda
{
    /// <summary>What the lambda shipped, which is the assets folder here.</summary>
    public static readonly Folder Assets = new("assets");

    /// <summary>What it writes, which is the workspace folder here.</summary>
    public static readonly Folder Workspace = new("workspace");
}
