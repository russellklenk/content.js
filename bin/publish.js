#! /usr/bin/env node
/*/////////////////////////////////////////////////////////////////////////////
/// @summary This command-line utility implements the content packaging and
/// publishing process. The tool loads a project from the filesystem, and for
/// each existing package and build target, archives the build output and
/// generates the final package files.
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem  = require('fs');
var Path        = require('path');
var Crypto      = require('crypto');
var Commander   = require('commander');
var ContentJS   = require('../index');

/// Constants representing the various application exit codes.
var exit_code   = {
    /// The program has exited successfully.
    SUCCESS     : 0,
    /// The program has exited with an unknown error.
    ERROR       : 1
};

/// Default application configuration values.
var defaults    = {
    /// The name of the publish configuration file to load under the project
    /// root directory.
    CONFIG_FILENAME   : 'publish.json',
    /// The staging directory defaults to 'staging' under the startup path.
    STAGING_DIRECTORY : 'staging',
    /// The publish directory defaults to 'publish' under the startup path.
    PUBLISH_DIRECTORY : 'publish',
    /// By default, publish to the development target.
    PUBLISH_TARGET    : 'dev'
};

/// Constants and global values used throughout the application module.
var application = {
    /// The name of the application module.
    NAME              : 'publish',
    /// The path from which the application was started.
    STARTUP_DIRECTORY : process.cwd(),
    /// The file extension for a project manifest file.
    MANIFEST_EXTENSION: '.manifest',
    /// The file extension for published content package files.
    PACKAGE_EXTENSION : '.package',
    /// An object defining the pre-digested command-line arguments passed to
    /// the application, not including the node or script name values.
    args              : {},
    /// The root path of the project being published.
    projectPath       : '',
    /// The path of the root publish directory.
    publishPath       : '',
    /// The path of the root staging directory.
    stagingPath       : '',
    /// The name of the current publish target.
    publishTarget     : '',
    /// The Project that represents the loaded content project.
    project           : null,
    /// The application exit code.
    exitCode          : exit_code.SUCCESS
};

/// Exits the application with an error.
/// @param exitCode One of the values of the @a exit_code enumeration.
/// @param data Optional additional data associated with the error.
function programError(exitCode, data)
{
    exitCode = exitCode || exit_code.ERROR;
    if (!application.args.silent)
    {
        switch (exitCode)
        {
            case exit_code.ERROR:
                console.error('An error occurred:');
                console.error('  '+data);
                break;
        }
    }
    process.exit(exitCode);
}

/// Generates an object specifying the default application configuration.
/// @return An object initialized with the default application configuration.
function defaultConfiguration()
{
    var appConfig      = {};
    appConfig.staging  = defaults.STAGING_DIRECTORY;
    appConfig.publish  = defaults.PUBLISH_DIRECTORY;
    appConfig.target   = defaults.PUBLISH_TARGET;
    return appConfig;
}

/// Writes an application configuration object out to a file.
/// @param config An object representing the application configuration to save.
/// @param filename The path of the configuration file to write. Defaults to
/// the file defaults.CONFIG_FILENAME in the current working directory.
/// @param silent Specify true to suppress any warning console output.
function saveConfiguration(config, filename, silent)
{
    try
    {
        config    = config   || defaultConfiguration();
        filename  = filename || defaults.CONFIG_FILENAME;
        var data  = JSON.stringify(config, null, '\t');
        Filesystem.writeFileSync(filename, data +'\n', 'utf8');
    }
    catch (error)
    {
        if (!silent) // @note: this is non-fatal
        {
            console.warn('Warning: Could not save application configuration:');
            console.warn('  with path: '+filename);
            console.warn('  exception: '+error);
            console.warn();
        }
    }
}

/// Attempts to load a configuration file containing application settings. If
/// the file cannot be loaded, the default configuration is returned.
/// @param filename The path of the configuration file to load. Defaults to
/// the file defaults.CONFIG_FILENAME in the current working directory.
/// @param silent Specify true to suppress any warning console output.
/// @return An object containing startup configuration properties.
function loadConfiguration(filename, silent)
{
    try
    {
        filename  = filename || defaults.CONFIG_FILENAME;
        var data  = Filesystem.readFileSync(filename, 'utf8');
        return JSON.parse(data);
    }
    catch (error)
    {
        if (!silent)
        {
            console.warn('Warning: Could not load application configuration:');
            console.warn('  with path: '+filename);
            console.warn('  exception: '+error);
            console.warn('The default application configuration will be used.');
            console.warn();
        }
        return defaultConfiguration();
    }
}

/// Processes any options specified on the command line. If necessary, help
/// information is displayed and the application exits.
/// @return An object whose properties are the configuration specified by the
/// command-line arguments, with suitable defaults filled in where necessary.
function processCommandLine()
{
    // parse the command line, display help, etc. if the command
    // line is invalid, commander will call process.exit() for us.
    Commander
        .version('1.0.0')
        .option('-s, --silent',         'Suppress command-line output.')
        .option('-p, --project [path]', 'Path of the project to publish. [cwd]',             String, process.cwd())
        .option('-S, --staging [path]', 'Path of the root staging directory. [cwd/staging]', String)
        .option('-O, --publish [path]', 'Path of the root publish directory. [cwd/publish]', String)
        .option('-T, --target [name]',  'Name of the target platform to publish. [dev]',     String)
        .option('-C, --save-config',    'Save the current publish configuration.')
        .parse(process.argv);

    var projectPath   = Path.resolve(Commander.project);
    var configPath    = Path.join(projectPath, defaults.CONFIG_FILENAME);
    var configData    = loadConfiguration(configPath, Commander.silent);

    // if no publish configuration exists for the project, always save
    // out the publish.json file containing the current configuration.
    if (!ContentJS.isFile(configPath))
    {
        Commander.saveConfig = true;
    }

    // fill in unspecified command-line arguments with values
    // from the publish configuration for the content project.
    // otherwise, override the config data from the command line.
    if (Commander.staging)
    {
        // the staging directory was specified on the command line.
        configData.staging = Commander.staging; // may be a relative path
        Commander.staging  = Path.resolve(projectPath, Commander.staging);
    }
    else
    {
        // the staging directory was not specified; use the saved config.
        Commander.staging  = Path.resolve(projectPath, configData.staging);
    }
    if (Commander.publish)
    {
        // the publish directory was specified on the command line.
        configData.publish = Commander.publish; // may be a relative path
        Commander.publish  = Path.resolve(projectPath, Commander.publish);
    }
    else
    {
        // the publish directory was not specified; use the saved config.
        Commander.publish  = Path.resolve(projectPath, configData.publish);
    }
    if  (Commander.target)   configData.target  = Commander.target;
    else Commander.target  = configData.target;

    // save out the current configuration if instructed to do so.
    if (Commander.saveConfig)
    {
        saveConfiguration(configData, configPath, Commander.silent);
    }

    // return an object containing our final configuration options:
    return {
        silent        : Commander.silent,
        projectRoot   : Commander.project,
        publishRoot   : Commander.publish,
        stagingRoot   : Commander.staging,
        publishTarget : Commander.target
    };
}

/// Ensures that the required directories exist, creating them if necessary,
/// and updates the publish path and staging path to the full absolute path
/// values that will be used at runtime.
function ensureDirectories()
{
    var target      = application.publishTarget;
    var projectName = application.project.projectName;
    var publishRoot = Path.join(application.publishPath, projectName, target);
    var stagingRoot = Path.join(application.stagingPath, projectName, target);

    try
    {
        ContentJS.makeTree(publishRoot);
        ContentJS.makeTree(stagingRoot);
        application.publishPath = publishRoot;
        application.stagingPath = stagingRoot;
    }
    catch (error)
    {
        programError(exit_code.ERROR, error);
    }
}

/// Builds an array of the names of all content packages that exist for a given
/// content project.
/// @return An array of string content package names.
function enumeratePackages(project)
{
    return (project ? Object.keys(project.packages) : []);
}

/// Builds an array of names of all build targets that exist for a given
/// content package.
/// @return An array of string target platform names.
function enumerateTargets(bundle)
{
    return (bundle  ? Object.keys(bundle.targets) : []);
}

/// Creates an object representing an empty project manifest. The manifest
/// maintains the publish history for the project.
/// @return An object whose 'latest' field will be populated with data from the
/// current publish attempt.
function createEmptyProjectManifest()
{
    return {
        latest       : {
            version  : 1,
            builtOn  : new Date(),
            packages : {} // map platform name to array of {name,Hash.package}
        }
    };
}

/// Compares two project manifest versions to determine if anything has
/// changed in the current version.
/// @param manifestOld The object representing the existing project manifest.
/// @param manifestNew The object representing the new project manifest.
/// @return true if the project manifest has changed or false otherwise.
function projectManifestChanged(manifestOld, manifestNew)
{
    if (!manifestOld || !manifestOld.latest)
    {
        // there is no prior project manifest,
        // so this is our first publish.
        return true;
    }

    // compare the packages for each platform in the latest
    // version of the existing manifest and the new manifest.
    // if the platforms differ, or the packages in each platform
    // differ, then the content project has changed.
    var packagesOld   = manifestOld.latest.packages;
    var packagesNew   = manifestNew.latest.packages;
    var platforms     = Object.keys(packagesNew);
    for (var i = 0, n = platforms.length; i < n; ++i)
    {
        var platformNew   = packagesNew[platforms[i]];
        var platformOld   = packagesOld[platforms[i]];
        if (platformOld === undefined)
        {
            // this platform didn't exist in the prior version.
            return true;
        }
        if (platformOld.length != platformNew.length)
        {
            // the number of packages differs.
            return true;
        }
        for (var i = 0, n = platformNew.length; i < n; ++i)
        {
            // @note: the arrays of package files are sorted,
            // so we expect platformOld[i] === platformNew[i].
            var packOld        = platformOld[i];
            var packNew        = platformNew[i];
            if (packOld.name !== packNew.name)
                return true;  // package names differ
            if (packOld.file !== packNew.file)
                return true;  // package hashes differ
        }
    }
    return false;
}

/// Constructs an updated project manifest from an old version and new version.
/// @param manifestOld The object representing the existing project manifest.
/// @param manifestNew The object representing the new project manifest.
/// @return An object representing the merged project manifest.
function updateProjectManifest(manifestOld, manifestNew)
{
    if (!manifestOld || !manifestOld.latest)
    {
        // there is no prior project manifest,
        // so manifestNew is the latest version.
        return manifestNew;
    }

    // archive the 'latest' field on manifestOld
    // and then update its 'latest' field with
    // data from the manifestNew's latest.
    var newLatest         = manifestNew.latest;
    var oldLatest         = manifestOld.latest;
    var oldVersion        = oldLatest.version;
    var propName          = 'v' +  oldVersion;
    newLatest.version     = oldVersion + 1;
    manifestOld[propName] = oldLatest;
    manifestOld.latest    = newLatest;
    return manifestOld;
}

/// Attempts to load any existing project manifest from disk.
/// @return An object representing the existing project manifest, or null if
/// no project manifest is located in the publish directory.
function loadProjectManifest()
{
    var extension    = application.MANIFEST_EXTENSION;
    var projectName  = application.project.projectName;
    var publishRoot  = application.publishPath;
    var manifestPath = Path.join(publishRoot, projectName + extension);

    try
    {
        var data     = Filesystem.readFileSync(manifestPath, 'utf8');
        var manifest = JSON.parse(data);
        Object.keys(manifest).forEach(function (version)
            {
                var record     = manifest[version];
                record.builtOn = new Date(record.builtOn);
            });
        return manifest;
    }
    catch (error)
    {
        // no existing manifest, or we can't read it.
        return null;
    }
}

/// Writes a project manifest file to disk.
/// @param manifest An object representing the project manifest.
function saveProjectManifest(manifest)
{
    var extension    = application.MANIFEST_EXTENSION;
    var projectName  = application.project.projectName;
    var publishRoot  = application.publishPath;
    var manifestPath = Path.join(publishRoot, projectName + extension);

    try
    {
        var data = JSON.stringify(manifest,    null, '\t');
        Filesystem.writeFileSync(manifestPath, data +'\n', 'utf8');
    }
    catch (error)
    {
        programError(exit_code.ERROR, error);
    }
}

/// Computes a cryptographic hash value for the contents of a file.
/// @param path The path of the file to hash.
/// @return The digest value, as a hexadecimal string.
function hashFile(path)
{
    var hash   = Crypto.createHash('sha256');
    var fdRead = Filesystem.openSync(path, 'r');
    var size   = 4096;
    var buffer = new Buffer(size);
    var num    = 1;
    var pos    = 0;
    while (num > 0)
    {
        num = Filesystem.readSync(fdRead, buffer, 0, size);
        if (num === size)
        {
            // read the full buffer's worth of data.
            hash.update(buffer, 'binary');
        }
        else if (num > 0)
        {
            // only read a portion of the buffer.
            var slice = buffer.slice(0, num);
            hash.update(slice,  'binary');
        }
    }
    Filesystem.closeSync(fdRead);
    return hash.digest('hex');
}

/// Implements the publish process for a single target resource package.
/// @param project The content Project being published.
/// @param bundle The Package being published.
/// @param target The Target being published.
/// @param manifest An object representing the in-memory project manifest. This
/// object will be updated during the publishing process.
function publishTarget(project, bundle, target, manifest)
{
    var manName  = ContentJS.PackageBuilder.MANIFEST_NAME;
    var manPath  = Path.join(target.targetPath,  manName);
    if (ContentJS.isFile(manPath) === false)
    {
        // ignore targets that don't have a package manifest.
        return;
    }

    // first tar all of the target output files.
    var platform = target.platformName;
    var tarName  = bundle.packageName + '.' + platform + '.tar';
    var tarPath  = Path.join(application.stagingPath, tarName);
    ContentJS.makeTar({
        from       : target.targetPath,
        recursive  : true,
        targetPath : tarPath
    });

    // now cryptographically hash the tar file.
    // rename the tar file to its final package name.
    var digest   = hashFile(tarPath);
    var pkgName  = digest  + application.PACKAGE_EXTENSION;
    var pkgPath  = Path.join(application.stagingPath, pkgName);
    Filesystem.renameSync(tarPath, pkgPath);

    // update the project manifest file.
    var pkgList  = (manifest.latest.packages[platform] || []);
    pkgList.push({
        name     :  bundle.packageName,
        file     :  pkgName
    });
    manifest.latest.packages[platform] = pkgList;
}

/// Implements the publish process for a content package, enumerating and
/// publishing each target resource package.
/// @param project The content Project being published.
/// @param bundle The Package being published.
/// @param manifest An object representing the in-memory project manifest. This
/// object will be updated during the publishing process.
function publishPackage(project, bundle, manifest)
{
    var targets = enumerateTargets(bundle);
    for (var i  = 0, n = targets.length; i < n; ++i)
    {
        var tgt = bundle.targetPlatform(targets[i]);
        publishTarget(project, bundle, tgt, manifest);
    }
}

/// Implements the publish process for a content project, enumerating and
/// publishing each content package.
/// @param project The content Project being published.
function publishProject(project)
{
    var manifest = createEmptyProjectManifest();
    var packages = enumeratePackages(project);

    // ensure that required directories exist and publish
    // each content package, creating and hashing tar archives.
    ensureDirectories();
    for (var i = 0, n = packages.length; i < n; ++i)
    {
        var bundle = project.contentPackage(packages[i]);
        publishPackage(project, bundle, manifest);
    }

    // sort the package lists by package name for easier comparison.
    Object.keys(manifest.latest.packages).forEach(function (platform)
        {
            manifest.latest.packages[platform].sort(function (a, b)
                {
                    return a.name.localeCompare(b.name);
                });
        });

    // load any previously existing project manifest and compare
    // it with the current manifest. if things have changed, then
    // we'll move over all of the staged files and update the manifest.
    var previous  = loadProjectManifest();
    if (projectManifestChanged(previous, manifest))
    {
        // move over all of the files in the staging directory.
        var move  = function (entry)
            {
                var filename = Path.basename(entry.absolutePath);
                var srcPath  = entry.absolutePath;
                var tgtPath  = Path.join(application.publishPath, filename);
                console.log('Moving package file:');
                console.log('  Source: '+srcPath);
                console.log('  Target: '+tgtPath);
                Filesystem.renameSync(srcPath, tgtPath);
            };
            console.log(application.stagingPath);
        ContentJS.walkTree(move, {
            from         : application.stagingPath,
            recursive    : false,
            ignoreHidden : true
        });

        // update and write out the updated project manifest file.
        manifest  = updateProjectManifest(previous, manifest);
        saveProjectManifest(manifest);
    }
}

/// Implements the entry point of the application. Command-line arguments are
/// parsed, and if necessary help information is displayed and the program
/// exits. The project is then loaded and the build process started.
function main()
{
    application.args          = processCommandLine();
    application.exitCode      = exit_code.SUCCESS;
    application.publishTarget = application.args.publishTarget;
    application.projectPath   = application.args.projectRoot;
    application.publishPath   = application.args.publishRoot;
    application.stagingPath   = application.args.stagingRoot;
    application.project       = ContentJS.loadProject(application.projectPath);
    publishProject(application.project);
}

/// Application entry point.
main();
