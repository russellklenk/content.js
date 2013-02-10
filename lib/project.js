/*/////////////////////////////////////////////////////////////////////////////
/// @summary Defines some functions for working with projects, which consist
/// of content processors, packages, database information and a content
/// pipeline definition.
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem = require('fs');
var Events     = require('events');
var Path       = require('path');
var Util       = require('util');
var Compiler   = require('./compiler');
var Database   = require('./database');
var FSUtil     = require('./fsutility');

/// Loads a content pipeline definition from the filesystem.
/// @param path The path of the file containing the JSON pipeline definition.
/// @return An object representing the pipeline definition.
function loadPipelineDefinition(path)
{
    try
    {
        var json = Filesystem.readFileSync(path, 'utf8');
        return JSON.parse(json);
    }
    catch (err)
    {
        // return an empty object.
        return {};
    }
}

/// Saves a content pipeline definition to the filesystem.
/// @param path The path to which the JSON pipeline definition will be written.
/// @param data An object defining the content pipeline configuration.
function savePipelineDefinition(path, data)
{
    try
    {
        var json = JSON.stringify(data, null, '\t');
        Filesystem.writeFileSync(path, json, 'utf8');
    }
    catch (err)
    {
        /* empty */
    }
}

/// Loads a list of recognized platform identifiers from the filesystem.
/// @param path The path of the file containing the array of plaform names.
/// @return An array of strings specifying the recognized platform names.
function loadPlatformList(path)
{
    try
    {
        var json = Filesystem.readFileSync(path, 'utf8');
        return JSON.parse(json);
    }
    catch (err)
    {
        // return an empty array.
        return [];
    }
}

/// Saves a platform list to the filesystem.
/// @param path The path to which the JSON platform list will be written.
/// @param data An array of strings specifying the recognized platform names.
function savePlatformList(path, data)
{
    try
    {
        var json = JSON.stringify(data, null, '\t');
        return JSON.parse(json);
    }
    catch (err)
    {
        /* empty */
    }
}

/// Constructor function for the Target type, which represents the output
/// location for content files for a particular target platform. Instances of
/// this type are typically created using Target.create().
/// @return A reference to the new Target instance.
var Target = function ()
{
    if (!(this instanceof Target))
    {
        return new Target();
    }
    this.sourceDb     = null; // the in-memory source database
    this.targetDb     = null; // the in-memory target database
    this.rootPath     = '';   // absolute path of project packages directory
    this.sourcePath   = '';   // absolute path of package source content
    this.targetPath   = '';   // absolute path of package target content
    this.packageName  = '';   // the name of the parent package
    this.platformName = '';   // the name of the target platform
    this.sourceDbPath = '';   // absolute path of source database file
    this.targetDbPath = '';   // absolute path of target database file
    return this;
};

/// The name of the generic platform is just an empty string.
Target.GENERIC_PLATFORM    = 'generic';

/// The directory extension used for target packages.
Target.TARGET_EXTENSION    = '.target';

/// The file extension used for target databases.
Target.TARGET_DB_EXTENSION = '.target.json';

/// The file extension used for source databases.
Target.SOURCE_DB_EXTENSION = '.source.json';

/// Loads and caches the data representing the output location and metadata for
/// content files built for a specific target platform.
/// @param args An object specifying information about the environment.
/// @param args.packageName The name of the parent content package.
/// @param args.packageRoot The absolute path of the packages directory.
/// @param args.databaseRoot The absolute path of the database directory.
/// @param args.sourceRoot The absolute path of the package source directory.
/// @param args.platformName The name of the target platform.
/// @return A new Target instance. All of the necessary directories and files
/// are created on the filesystem, and any required data has been loaded.
Target.create = function (args)
{
    if (args.platformName.length === 0)
        args.platformName = Target.GENERIC_PLATFORM;

    var sdbExt          = Target.SOURCE_DB_EXTENSION;
    var tdbExt          = Target.TARGET_DB_EXTENSION;
    var dirExt          = Target.TARGET_EXTENSION;
    var targetName      = args.packageName + '.' + args.platformName + dirExt;
    var sourceDbName    = args.packageName + '.' + args.platformName + sdbExt;
    var targetDbName    = args.packageName + '.' + args.platformName + tdbExt;
    var targetPath      = Path.join(args.packageRoot,  targetName);
    var targetDbPath    = Path.join(args.databaseRoot, targetDbName);
    var sourceDbPath    = Path.join(args.databaseRoot, sourceDbName);

    var sdb             = Database.loadSourceDatabase(sourceDbPath);
    sdb.bundleName      = args.packageName;
    sdb.resourceRoot    = args.sourceRoot;

    var tdb             = Database.loadTargetDatabase(targetDbPath);
    tdb.platform        = args.platformName;
    tdb.bundleName      = args.packageName;
    tdb.resourceRoot    = targetPath;

    var target          = new Target();
    target.sourceDb     = sdb;
    target.targetDb     = tdb;
    target.rootPath     = args.packageRoot;
    target.sourcePath   = args.sourceRoot;
    target.targetPath   = targetPath;
    target.packageName  = args.packageName;
    target.platformName = args.platformName;
    target.sourceDbPath = sourceDbPath;
    target.targetDbPath = targetDbPath;

    // ensure that the required directories exist:
    FSUtil.makeTree(targetPath);
    return target;
};

/// Constructs the target path associated with a given resource name.
/// @param resourceName The resource name of the content item.
/// @return The absolute path of the target file, without any extension.
Target.prototype.targetPathFor = function (resourceName)
{
    var       ch = 0;
    var     hash = 0; // stb_hash FTW
    resourceName = resourceName || '';
    for (var   i = 0, n = resourceName.length; i < n; ++i)
    {
        ch       = resourceName.charCodeAt(i);
        hash     = (hash << 7) + (hash >> 25) + ch;
    }
    return Path.join(this.targetPath, hash.toString(16));
};

/// Constructor function for the Package type, which represents a logical
/// group of content. Instances of this type are typically created using the
/// Package.create() function.
/// @return A reference to the new Package instance.
var Package = function ()
{
    if (!(this instanceof Package))
    {
        return new Package();
    }
    this.databaseRoot = '';   // absolute path of project database directory
    this.packageRoot  = '';   // absolute path of project packages directory
    this.sourcePath   = '';   // absolute path of package source content
    this.projectName  = '';   // the name of the parent project
    this.packageName  = '';   // the name of the content package
    this.targets      = {};   // map target platform name to Target object
    return this;
};

/// The directory extension used for source packages.
Package.SOURCE_EXTENSION    = '.source';

/// Loads and caches the data representing the source location, output
/// locations and metadata for a logical grouping of content.
/// @param args An object specifying information about the environment.
/// @param args.projectName The name of the parent project.
/// @param args.packageName The name of the content package.
/// @param args.packageRoot The absolute path of the packages directory.
/// @param args.databaseRoot The absolute path of the database directory.
/// @return A new Package instance. All of the necessary directories and files
/// are created on the filesystem, and any required data has been loaded.
Package.create = function (args)
{
    var dirExt          = Package.SOURCE_EXTENSION;
    var sourceName      = args.packageName + dirExt;
    var sourcePath      = Path.join(args.packageRoot, sourceName);

    var bundle          = new Package();
    bundle.databaseRoot = args.databaseRoot;
    bundle.packageRoot  = args.packageRoot;
    bundle.sourcePath   = sourcePath;
    bundle.projectName  = args.projectName;
    bundle.packageName  = args.packageName;

    // ensure that the required directories exist:
    FSUtil.makeTree(sourcePath);
    return bundle;
};

/// Retrieves the data associated with a particular target platform for this
/// content package. The target platform record is created if it doesn't exist.
/// @param platformName The name of the target platform.
/// @return The Target record for the specified platform name.
Package.prototype.targetPlatform = function (platformName)
{
    // map an empty string to the generic platform.
    if (platformName.length === 0)
        platformName = Target.GENERIC_PLATFORM;

    // return the existing target, if it exists.
    var target   = this.targets[platformName];
    if (target !== undefined)
        return target;

    // the target doesn't exist, so create it.
    target = Target.create({
        packageName  : this.packageName,
        packageRoot  : this.packageRoot,
        databaseRoot : this.databaseRoot,
        sourceRoot   : this.sourcePath,
        platformName : platformName
    });
    this.targets[platformName] = target;
    return target;
};

/// Scans the filesystem and creates Target platform records for any target
/// directories it finds belonging to the content package.
/// @return The Package instance.
Package.prototype.cacheTargets = function ()
{
    var self       = this;
    var checkEntry = function (entry)
        {
            if (entry.stat.isDirectory())
            {
                var ext   = Path.extname(entry.name);
                if (ext === Target.TARGET_EXTENSION)
                {
                    var p = Target.GENERIC_PLATFORM;        // platform name
                    var b = Path.basename(entry.name, ext); // chop '.target'
                    var x = b.lastIndexOf('.');
                    if (x > 0)
                    {
                        p = b.substring(x + 1);             // platform name
                        b = b.substring(0,  x);             // package name
                    }
                    if (b === self.packageName)
                    {
                        self.targetPlatform(p);             // cache Target
                    }
                }
            }
        };
    FSUtil.walkTree(checkEntry, {
        from        : this.packageRoot,
        recursive   : false,
        ignoreHidden: true
    });
    return self;
};

/// Constructor function for the Project type, which stores paths associated
/// a content project on the filesystem. Instances of this type are typically
/// created using the Project.create() function.
/// @return The new Project instance.
var Project = function ()
{
    if (!(this instanceof Project))
    {
        return new Project();
    }
    this.projectName   = ''; // the name of the project
    this.rootPath      = ''; // absolute path of the whole project
    this.packageRoot   = ''; // absolute path of project content directory
    this.databaseRoot  = ''; // absolute path of project database directory
    this.processorRoot = ''; // absolute path of project processors directory
    this.platformPath  = ''; // absolute path of the platform definition file
    this.pipelinePath  = ''; // absolute path of pipeline definition file
    this.platforms     = []; // array of recognized platform names
    this.pipeline      = {}; // map resource type => compiler source object
    this.packages      = {}; // map package name => Package instance
    return this;
};

/// A string specifying the name of the root directory for content processors.
Project.PROCESSORS_DIRECTORY = 'processors';

/// A string specifying the name of the root directory for content packages.
Project.PACKAGES_DIRECTORY   = 'packages';

/// A string specifying the name of the root directory for database files.
Project.DATABASE_DIRECTORY   = 'database';

/// A string specifying the name of the pipeline configuration file.
Project.PIPELINE_FILE        = 'pipeline.json';

/// The name of the file containing the list of recognized target platforms.
Project.PLATFORM_FILE        = 'platform.json';

/// Loads and caches the data associated with a content project, which acts as
/// a container for content packages.
/// @param args An object specifying information about the environment.
/// @param args.projectName The name of the parent project.
/// @param args.projectRoot The absolute path of the directory in which the
/// project will be created.
/// @return A new Project instance. All of the necessary directories and files
/// are created on the filesystem, and any required data has been loaded.
Project.create = function (args)
{
    args             = args || {
        projectName  : 'unnamed',
        projectRoot  : process.cwd()
    };
    args.projectName = args.projectName || 'unnamed';
    args.projectRoot = Path.resolve(args.projectRoot || process.cwd());

    var rootPath     = Path.join(args.projectRoot, args.projectName);
    var procPath     = Path.join(rootPath, Project.PROCESSORS_DIRECTORY);
    var packPath     = Path.join(rootPath, Project.PACKAGES_DIRECTORY);
    var dataPath     = Path.join(rootPath, Project.DATABASE_DIRECTORY);
    var pipePath     = Path.join(rootPath, Project.PIPELINE_FILE);
    var platPath     = Path.join(rootPath, Project.PLATFORM_FILE);

    // ensure that the required directories exist:
    FSUtil.makeTree(rootPath);
    FSUtil.makeTree(dataPath);
    FSUtil.makeTree(procPath);
    FSUtil.makeTree(packPath);

    // load the project files and initialize the instance:
    var project           = new Project();
    project.projectName   = args.projectName;
    project.rootPath      = rootPath;
    project.packageRoot   = packPath;
    project.databaseRoot  = dataPath;
    project.processorRoot = procPath;
    project.pipelinePath  = pipePath;
    project.platformPath  = platPath;
    project.platforms     = loadPlatformList(platPath);
    project.pipeline      = loadPipelineDefinition(pipePath);

    // ensure that the required flles exist:
    if (!FSUtil.isFile(platPath))
    {
        // create an empty platform definition file.
        savePlatformList(platPath, project.platforms);
    }
    if (!FSUtil.isFile(pipePath))
    {
        // create an empty pipeline definition file.
        savePipelineDefinition(pipePath, project.pipeline);
    }
    return project;
};

/// Retrieves the data associated with a particular content package for this
/// project. The content package record is created if it doesn't exist.
/// @param packageName The name of the content package.
/// @return The Package record representing the specified content package.
Project.prototype.contentPackage = function (packageName)
{
    // return the existing package, if it exists.
    var bundle   = this.packages[packageName];
    if (bundle !== undefined)
        return bundle;

    // the package doesn't exist, so create it.
    bundle = Package.create({
        projectName  : this.projectName,
        packageName  : packageName,
        packageRoot  : this.packageRoot,
        databaseRoot : this.databaseRoot
    });
    this.packages[packageName] = bundle;
    return bundle;
};

/// Scans the filesystem and creates Package records for any source content
/// directories it finds belonging to the content project.
/// @return The Project instance.
Project.prototype.cachePackages = function ()
{
    var self       = this;
    var checkEntry = function (entry)
        {
            if (entry.stat.isDirectory())
            {
                var ext   = Path.extname(entry.name);
                if (ext === Package.SOURCE_EXTENSION)
                {
                    var n = Path.basename(entry.name, ext); // chop '.source'
                    var p = self.contentPackage(n);         // cache Package
                    p.cacheTargets();                       // cache Targets
                }
            }
        };
    FSUtil.walkTree(checkEntry, {
        from        : this.packageRoot,
        recursive   : false,
        ignoreHidden: true
    });
    return self;
};

/// Constructor function for a type that implements the build process for a
/// single content package and target platform combination.
/// @param args An object specifying build environment.
/// @param args.project A reference to the Project being built.
/// @param args.bundle A reference to the Package being built.
/// @param args.target A reference to the Target representing the build target.
/// @param args.platforms An array of recognized platform names.
/// @param args.compilers The CompilerCache representing the current definition
/// of the content pipeline.
/// @return A reference to the new TargetBuilder instance.
var TargetBuilder  = function (args)
{
    if (!(this instanceof TargetBuilder))
    {
        return new TargetBuilder(args);
    }
    this.project     = args.project;   // the parent Project
    this.bundle      = args.bundle;    // the Package being built
    this.target      = args.target;    // the current built Target
    this.platforms   = args.platforms; // recognized platform names
    this.compilers   = args.compilers; // the CompilerCache used to build
    this.sourceFiles = {};             // map resource name to build info
    this.compilers.on('started',  this.handleFileStarted.bind(this));
    this.compilers.on('skipped',  this.handleFileSkipped.bind(this));
    this.compilers.on('complete', this.handleFileComplete.bind(this));
    return this;
};
Util.inherits(TargetBuilder, Events.EventEmitter);

/// Performs a quick check to determine if a source file has been modified by
/// checking the modification time and file size.
/// @param entry The source database entry representing the last-known
/// information about the source file.
/// @param stat A fs.Stats instance specifying information  about the current
/// state of the source file.
/// @return true if the source file has been modified.
TargetBuilder.prototype.sourceFileModified = function (entry, stat)
{
    var tmp   = entry.writeTime.getTime();
    var tmc   = stat.mtime.getTime();
    if (tmc !== tmp) return true;
    var szp   = entry.fileSize;
    var szc   = stat.size;
    if (szc !== szp) return true;
    return false;
};

/// Determines whether any of the dependencies of a given source file have been
/// modified by examining modification time and file size.
/// @param entry The source database entry to check.
/// @return true if any source files in the dependency chain are modified.
TargetBuilder.prototype.dependenciesModified = function (entry)
{
    try
    {
        // check the source file represented by entry to see if it is modified.
        var target = this.target;
        var db     = target.sourceDb;
        var root   = target.rootPath;
        var abs    = Path.join(root, entry.relativePath);
        var stat   = Filesystem.statSync(abs);
        if (this.sourceFileModified(entry, stat))
            return true;

        // now check all of the dependencies to see if they've been modified.
        for (var i = 0, n = entry.dependencies.length; i < n; ++i)
        {
            var  d = db.dependency(entry, root, i);
            var  e = db.query(root, d);
            if (!e || e.dependenciesModified(bundle, e))
                return true;
        }
        return false;
    }
    catch (err)
    {
        // the file doesn't exist, isn't accessible, etc.
        return true;
    }
};

/// Determines whether the build outputs for a given target resource exist.
/// @param targetPath The absolute path of the target resource.
/// @return true if all build outputs exist.
TargetBuilder.prototype.buildOutputsExist = function (targetPath)
{
    var target = this.target;
    var db     = target.targetDb;
    var root   = target.rootPath;
    var entry  = db.query(root, targetPath);
    if (entry)
    {
        var r  = true;
        var n  = entry.outputs.length;
        for (var i = 0; i < n; ++i)
        {
            var of = db.output(entry, root, i);
            if (!FSUtil.isFile(of))
            {
                r = false; // this file doesn't exist.
                break;
            }
        }
        return r; // will be true if no outputs or all outputs exist.
    }
    else
    {
        // the target resource is unknown.
        // the source file may not have any data compiler.
        return true;
    }
};

/// Checks a given resource to determine whether it needs to be rebuilt.
/// @param entry The source database entry representing the item to check.
/// @param targetPath The absolute path of the target resource.
/// @return true if the specified source file must be rebuilt.
TargetBuilder.prototype.requiresRebuild = function (entry, targetPath)
{
    if (this.dependenciesModified(entry))
        return true; // something in the dependency tree was modified
    if (this.buildOutputsExist(targetPath) === false)
        return true; // one or more build outputs missing
    return false;    // everything seems up-to-date
};

/// Callback invoked when the CompilerCache emits a 'skipped' event to signal
/// that it skipped building a source file, typically because no data compiler
/// exists for the file's resource type.
/// @param compilers The CompilerCache instance that raised the event.
/// @param result An object describing the result of the build operation.
/// @param result.input An object describing the input parameters.
/// @param result.input.bundle The Package instance for the content bundle.
/// @param result.input.target The Target instance for the target platform.
/// @param result.input.sourcePath The absolute path of the source file.
/// @param result.input.targetPath The absolute path of the target resource.
/// @param result.input.resourceName The unique name of the resource.
/// @param result.input.resourceType The resource type string.
/// @param result.input.platform The value of the resource platform property.
/// @param result.targetPath The absolute path of the target resource.
/// @param result.reason A string describing the reason the build was skipped.
TargetBuilder.prototype.handleFileSkipped = function (compilers, result)
{
    this.skipSourceFile(result.sourcePath, result.targetPath, result.reason);
};

/// Callback invoked when the CompilerCache emits a 'started' event to signal
/// that a file build has been submitted to a data compiler.
/// @param compilers The CompilerCache instance that raised the event.
/// @param request Information about the source file being built.
/// @param request.input An object describing the input parameters.
/// @param request.input.bundle The Package instance for the content bundle.
/// @param request.input.target The Target instance for the target platform.
/// @param request.input.sourcePath The absolute path of the source file.
/// @param request.input.targetPath The absolute path of the target resource.
/// @param request.input.resourceName The unique name of the resource.
/// @param request.input.resourceType The resource type string.
/// @param request.input.platform The value of the resource platform property.
/// @param request.targetPath The absolute path of the target resource.
/// @param request.compilerName The name of the data compiler.
TargetBuilder.prototype.handleFileStarted = function (compilers, request)
{
    var project = this.project;
    var bundle  = this.bundle;
    var target  = this.target;
    this.emit('started', this, {
        projectName    : project.projectName,
        packageName    : bundle.packageName,
        sourcePath     : request.input.sourcePath,
        targetPath     : request.input.targetPath,
        compilerName   : request.compilerName
    });
};

/// Callback invoked when the CompilerCache emits a 'complete' event to signal
/// that the data compiler has finished executing the build for a given source
/// content item.
/// @param compilers The CompilerCache instance that raised the event.
/// @param result An object describing the result of the build operation.
/// @param result.input An object describing the input parameters.
/// @param result.input.bundle The Package instance for the content bundle.
/// @param result.input.target The Target instance for the target platform.
/// @param result.input.sourcePath The absolute path of the source file.
/// @param result.input.targetPath The absolute path of the target resource.
/// @param result.input.resourceName The unique name of the resource.
/// @param result.input.resourceType The resource type string.
/// @param result.input.platform The value of the resource platform property.
/// @param result.compilerName The name of the data compiler.
/// @param result.compilerVersion The data compiler version.
/// @param result.targetPath The absolute path of the target resource.
/// @param result.success A boolean indicating whether the build was a success.
/// @param result.errors An array of string error messages.
/// @param result.outputs An array of absolute paths of build output files.
/// @param result.references An array of absolute paths of referenced files.
TargetBuilder.prototype.handleFileComplete = function (compilers, result)
{
    var sourceEntry = result.input.sourceEntry;
    var sourcePath  = result.input.sourcePath;
    var targetPath  = result.input.targetPath;
    var compiler    = result.compilerName;
    var version     = result.compilerVersion;
    var project     = this.project;
    var bundle      = this.bundle;
    var target      = this.target;
    var root        = target.rootPath;
    var tdb         = target.targetDb;
    var sdb         = target.sourceDb;

    if (result.success)
    {
        // insert (create or update) the source database entry for the
        // source file that just finished being compiled.
        sdb.insert(sourceEntry);

        // create a source database entry for each referenced (input) file
        // and add the referenced file as a dependency of the source file.
        var refs   = result.references; // @note: these are absolute paths
        for (var i = 0, n = refs.length; i < n; ++i)
        {
            var referenceEntry   = sdb.query(root, refs[i]);
            if (referenceEntry === undefined)
            {
                referenceEntry          = sdb.create(root, refs[i]);
                var properties          = referenceEntry.properties;
                referenceEntry.platform = this.determinePlatform(properties);
                sdb.insert(referenceEntry);
            }
            sdb.addReference(referenceEntry, root, sourcePath);
            sdb.addDependency(sourceEntry,   root, refs[i]);
        }

        // create a target database entry to represent the build outputs,
        // and add all of the output file paths to the new entry.
        var targetEntry   = tdb.create(root, sourcePath, targetPath, compiler, version);
        var outputs       = result.outputs; // @note: these are absolute paths
        for (var i = 0, n = outputs.length; i < n; ++i)
        {
            tdb.addOutput(targetEntry, root, outputs[i]);
        }
        tdb.insert(targetEntry);

        // emit the 'success' event to report build status information.
        this.emit('success', this, {
            projectName  : project.projectName,
            packageName  : bundle.packageName,
            sourcePath   : sourcePath,
            targetPath   : targetPath,
            compilerName : compiler,
            outputs      : result.outputs
        });
    }
    else
    {
        // emit the 'error' event to report build status information.
        // do not update database entries in this case.
        this.emit('error', this, {
            projectName  : project.projectName,
            packageName  : bundle.packageName,
            sourcePath   : sourcePath,
            targetPath   : targetPath,
            compilerName : compiler,
            errors       : result.errors
        });
    }
};

/// Given a set of properties associated with a resource, determine the one
/// identifying the target platform.
/// @param properties An array of strings representing the properties
/// associated with the resource.
/// @return A string representing the target platform name as found in the
/// resource properties. If the resource properties do not specify a target
/// platform, the identifier for the generic platform is returned.
TargetBuilder.prototype.determinePlatform = function (properties)
{
    var  count = this.platforms.length;
    for (var i = 0, n = properties.length; i < n; ++i)
    {
        var propValue = properties[i];
        for (var j = 0; j < count; ++j)
        {
            if (propValue === this.platforms[j])
                return propValue;
        }
    }
    return Target.GENERIC_PLATFORM;
};

/// Reports that a source file is being skipped for some reason.
/// @param sourcePath The absolute path of the source file.
/// @param targetPath The absolute path of the target resource.
/// @param why A string describing why the source file is being skipped.
TargetBuilder.prototype.skipSourceFile = function (sourcePath, targetPath, why)
{
    this.emit('skipped', this, {
        projectName    : this.project.projectName,
        packageName    : this.bundle.packageName,
        sourcePath     : sourcePath,
        targetPath     : targetPath,
        reason         : why
    });
};

/// Examines the data for a filesystem entry to determine whether it should be
/// considered as a source file for the current build target.
/// @param fsent An object specifying information about the filesystem entry.
/// @param fsent.rootPath The absolute path of the package source content root.
/// @param fsent.absolutePath The absolute path of the filesystem entry.
/// @param fsent.relativePath The relative path of the filesystem entry.
/// @param fsent.name The name of the file or directory.
/// @param fsent.stat An fs.Stats object describing the filesystem entry.
TargetBuilder.prototype.checkSourceFile = function (fsent)
{
    // skip checking any directories, etc.
    if (!fsent.stat.isFile()) return;

    // cache some properties for easy access.
    var generic          = Target.GENERIC_PLATFORM;
    var project          = this.project;
    var bundle           = this.bundle;
    var target           = this.target;
    var root             = target.rootPath;
    var sdb              = target.sourceDb;
    var tdb              = target.targetDb;

    // create (but do not insert) a record to represent
    // the source file in the source content database.
    // this is all of the information we need to determine
    // whether this source file should be rebuilt.
    var sourceEntry      = sdb.create(root, fsent.absolutePath);
    var resourceName     = sourceEntry.resourceName;
    var properties       = sourceEntry.properties;
    var platform         = this.determinePlatform(properties);
    var targetPath       = target.targetPathFor(resourceName);
    var sourcePath       = fsent.absolutePath;
    sourceEntry.platform = platform;

    // if this is a platform-specific source file, and its platform
    // property doesn't match the current target platform, skip it.
    if (platform !== generic && platform !== target.platformName)
    {
        var why = 'Source file does not match current build target';
        return this.skipSourceFile(sourcePath, targetPath, why);
    }
    // if this is a generic source file, and the current build target
    // is not the generic platform, skip it if there's a platform-specific
    // version of the source file; otherwise, include it in the build.
    if (platform === generic && generic  !== target.platformName)
    {
        var res  = this.sourceFiles[resourceName];
        if (res && res.platform !== generic)
        {
            var why = 'Source file overridden by platform-specific version';
            return this.skipSourceFile(sourcePath, targetPath, why);
        }
    }
    // if the source file platform matches the current build target platform,
    // include it in the build, but skip any generic version it may override.
    if (platform === target.platformName)
    {
        var res  = this.sourceFiles[resourceName];
        if (res && res.platform === generic)
        {
            var why = 'Source file overridden by platform-specific version';
            this.skipSourceFile(res.sourcePath, res.targetPath, why);
            // @note: fallthrough intentional. we're reporting a delayed skip
            // for the generic version, but still include the platform version.
        }
    }

    // this file is to be considered during the build process.
    this.sourceFiles[resourceName] = {
        resourceName : resourceName,
        sourceEntry  : sourceEntry,
        sourcePath   : sourcePath,
        targetPath   : targetPath,
        platform     : platform
    };
};

/// Determines the set of source files considered part of the build target.
/// Events indicating thsat files will be skipped are emitted during this call.
/// @return An array of objects describing the build target source files.
TargetBuilder.prototype.determineSourceFiles = function ()
{
    // reset the group of files considered for this target platform.
    this.sourceFiles = {};
    // walk the filesystem tree. this is a synchronous operation.
    FSUtil.walkTree(this.checkSourceFile.bind(this), {
        from         : this.target.sourcePath,
        recursive    : true,
        ignoreHidden : true
    });
    // copy everything into an array to be returned to the caller.
    var keys         = Object.keys(this.sourceFiles);
    var sourceFiles  = new Array(keys.length);
    for (var index   = 0, num  = keys.length; index < num; ++index)
    {
        sourceFiles[index]     = this.sourceFiles[keys[index]];
    }
    return sourceFiles;
};

/// Examines the set of build target source files to determine which files
/// actually need to be rebuilt. Events indicating that files are up-to-date
/// are emitted during this call.
/// @param sourceFiles The array of source file records returned by the
/// TargetBuilder.determineSourceFiles() method.
/// @return An array of objects describing the source files to build. This will
/// be a subset of the @a sourceFiles array.
TargetBuilder.prototype.determineBuildFiles = function (sourceFiles)
{
    var project      = this.project;
    var bundle       = this.bundle;
    var target       = this.target;
    var rootPath     = target.rootPath;
    var sdb          = target.sourceDb;
    var buildFiles   = [];
    for (var index   = 0, num = sourceFiles.length; index < num; ++index)
    {
        var info     = sourceFiles[index];
        var existing = sdb.query(rootPath, info.sourcePath);
        if (existing)
        {
            if (this.requiresRebuild(existing, info.targetPath) === false)
            {
                var why = 'Source file is up-to-date';
                this.skipSourceFile(info.sourcePath, info.targetPath, why);
                continue;
            }
        }
        buildFiles.push(info);
    }
    return buildFiles;
};

/// Submits a set of files to their corresponding data compilers to be rebuilt.
/// @param buildFiles An array of source file records as returned by the
/// TargetBuilder.determineBuildFiles() method.
TargetBuilder.prototype.rebuildFiles = function (buildFiles)
{
    var compilers   = this.compilers;
    for (var index  = 0, num = buildFiles.length; index < num; ++index)
    {
        var source  = buildFiles[index];
        var dbEntry = source.sourceEntry;
        compilers.build(source.targetPath, {
            sourcePath        : source.sourcePath,
            targetPath        : source.targetPath,
            sourceEntry       : dbEntry,
            resourceName      : dbEntry.resourceName,
            resourceType      : dbEntry.resourceType,
            platform          : dbEntry.platform
        });
    }
};

/// Determines whether the package manifest file exists on the filesystem.
/// @param manifestName The name and extension of the package manifest file.
/// @return true if the package manifest file exists on disk; false otherwise.
TargetBuilder.prototype.packageManifestExists = function (manifestName)
{
    var target       = this.target;
    var manifestPath = Path.join(target.targetPath, manifestName);
    return FSUtil.isFile(manifestPath);
};

/// Creates a package manifest, which contains the metadata for all of the
/// package resources, and writes it to the target directory.
/// @param manifestName The name and extension of the package manifest file.
TargetBuilder.prototype.writePackageManifest = function (manifestName)
{
    var project   = this.project;
    var target    = this.target;
    var sdb       = target.sourceDb;
    var tdb       = target.targetDb;
    var root      = target.rootPath;
    var count     = tdb.entries.length; // number of target resources
    var manifest  = {
        projectName : project.projectName,
        packageName : target.packageName,
        buildDate   : new Date(),
        platform    : target.platformName,
        resources   : new Array(count)
    };

    // create resource records for each target resource.
    for (var i = 0; i < count; ++i)
    {
        var te = tdb.entries[i];
        var sp = Path.join(root, te.sourcePath);
        var se = sdb.query(root, sp);
        var rr = {
            name : se.resourceName,
            type : se.resourceType,
            tags : se.properties,
            data : new Array(te.outputs.length)
        };
        // store paths of the resource data files, relative
        // to the root of the target output directory.
        for (var j = 0,  n = te.outputs.length; j < n; ++j)
        {
            var tp     = tdb.output(te, root, j); // absolute path of output
            rr.data[j] = Path.relative(target.targetPath, tp);
        }
        manifest.resources[i] = rr;
    }

    // write the manifest file to disk.
    var outPath = Path.join(target.targetPath, manifestName);
    var json    = JSON.stringify(manifest, null, '\t');
    Filesystem.writeFileSync(outPath, json, 'utf8');
};

/// Constructor function for a type that implements the build process for a
/// single content package.
/// @param args An object specifying build environment.
/// @param args.project A reference to the Project being built.
/// @param args.packageName The name of the content package to build.
/// @param args.platforms An array of recognized platform names.
/// @param args.compilers The CompilerCache representing the current definition
/// of the content pipeline.
/// @return A reference to the new PackageBuilder instance.
var PackageBuilder = function (args)
{
    if (!(this instanceof PackageBuilder))
    {
        return new PackageBuilder(args);
    }
    this.project     = args.project;
    this.packageName = args.packageName;
    this.platforms   = args.platforms;
    this.compilers   = args.compilers;
    return this;
};
Util.inherits(PackageBuilder, Events.EventEmitter);

/// The name of the manifest file for a content package.
PackageBuilder.MANIFEST_NAME = 'package.manifest';

/// Handles the 'started' event emitted by a TargetBuilder instance.
/// @param sender The TargetBuilder that raised the event.
/// @param fileInfo An object with additional information related to the event.
/// @param fileInfo.projectName The name of the project being built.
/// @param fileInfo.packageName The name of the content package being built.
/// @param fileInfo.sourcePath The absolute path of the source file.
/// @param fileInfo.targetPath The absolute path of the target resource.
/// @param fileInfo.compilerName The name of the data compiler.
PackageBuilder.prototype.handleFileStarted = function (sender, fileInfo)
{
    this.emit('compile', this, {
        projectName    : this.project.projectName,
        packageName    : this.packageName,
        targetName     : sender.target.platformName,
        sourcePath     : fileInfo.sourcePath,
        targetPath     : fileInfo.targetPath,
        compilerName   : fileInfo.compilerName
    });
};

/// Handles the 'skipped' event emitted by a TargetBuilder instance.
/// @param sender The TargetBuilder that raised the event.
/// @param fileInfo An object with additional information related to the event.
/// @param fileInfo.projectName The name of the project being built.
/// @param fileInfo.packageName The name of the content package being built.
/// @param fileInfo.sourcePath The absolute path of the source file.
/// @param fileInfo.targetPath The absolute path of the target resource.
/// @param fileInfo.reason A string specifying the reason the file was skipped.
PackageBuilder.prototype.handleFileSkipped = function (sender, fileInfo)
{
    sender.skipped++;
    this.emit('ignore' , this, {
        projectName    : this.project.projectName,
        packageName    : this.packageName,
        targetName     : sender.target.platformName,
        sourcePath     : fileInfo.sourcePath,
        targetPath     : fileInfo.targetPath,
        reason         : fileInfo.reason
    })
    if (sender.started)
    {
        sender.expect--;
        if (this.checkComplete(sender))
            this.targetComplete(sender);
    }
};

/// Handles the 'success' event emitted by a TargetBuilder instance.
/// @param sender The TargetBuilder that raised the event.
/// @param fileInfo An object with additional information related to the event.
/// @param fileInfo.projectName The name of the project being built.
/// @param fileInfo.packageName The name of the content package being built.
/// @param fileInfo.sourcePath The absolute path of the source file.
/// @param fileInfo.targetPath The absolute path of the target resource.
/// @param fileInfo.compilerName The name of the data compiler.
/// @param fileInfo.outputs An array of absolute paths of output files.
PackageBuilder.prototype.handleFileSuccess = function (sender, fileInfo)
{
    sender.success++;
    this.emit('success', this, {
        projectName    : this.project.projectName,
        packageName    : this.packageName,
        targetName     : sender.target.platformName,
        sourcePath     : fileInfo.sourcePath,
        targetPath     : fileInfo.targetPath,
        compilerName   : fileInfo.compilerName,
        outputFiles    : fileInfo.outputs
    });
    if (sender.started)
    {
        sender.expect--;
        if (this.checkComplete(sender))
            this.targetComplete(sender);
    }
};

/// Handles the 'error' event emitted by a TargetBuilder instance.
/// @param sender The TargetBuilder that raised the event.
/// @param fileInfo An object with additional information related to the event.
/// @param fileInfo.projectName The name of the project being built.
/// @param fileInfo.packageName The name of the content package being built.
/// @param fileInfo.sourcePath The absolute path of the source file.
/// @param fileInfo.targetPath The absolute path of the target resource.
/// @param fileInfo.compilerName The name of the data compiler.
/// @param fileInfo.errors An array of error messages.
PackageBuilder.prototype.handleFileError = function (sender, fileInfo)
{
    sender.errors++;
    this.emit('error'  , this, {
        projectName    : this.project.projectName,
        packageName    : this.packageName,
        targetName     : sender.target.platformName,
        sourcePath     : fileInfo.sourcePath,
        targetPath     : fileInfo.targetPath,
        compilerName   : fileInfo.compilerName,
        errors         : fileInfo.errors
    })
    if (sender.started)
    {
        sender.expect--;
        if (this.checkComplete(sender))
            this.targetComplete(sender);
    }
};

/// Checks the number of completion events still to be expected in order to
/// determine whether the content package has finished building.
/// @param targetBuilder The TargetBuilder instance to check.
/// @return true if the content package has finished building.
PackageBuilder.prototype.checkComplete = function (targetBuilder)
{
    return (0 === targetBuilder.expect); // no more events expected?
};

/// Notifies any event listeners that the content package build has finished.
/// @param targetBuilder The TargetBuilder instance representing the build.
PackageBuilder.prototype.notifyComplete = function (targetBuilder)
{
    this.emit('finish', this, {
        projectName   : this.project.projectName,
        packageName   : this.packageName,
        targetName    : targetBuilder.target.platformName,
        successCount  : targetBuilder.success,
        skippedCount  : targetBuilder.skipped,
        errorCount    : targetBuilder.errors,
        success       : targetBuilder.errors === 0 ? true : false
    });
};

/// Notifies any event listeners that the content package build is starting.
/// @param targetBuilder The TargetBuilder instance representing the build.
PackageBuilder.prototype.notifyStarted = function (targetBuilder)
{
    this.emit('start' , this, {
        projectName   : this.project.projectName,
        packageName   : this.packageName,
        targetName    : targetBuilder.target.platformName
    });
};

/// An internal function called when the build for a particular target has
/// finished. This method saves any database files, generates the package
/// manifest file, and performs cleanup and notification.
/// @param targetBuilder The TargetBuilder instance representing the build.
PackageBuilder.prototype.targetComplete = function (targetBuilder)
{
    var wasModified  = false;
    var target       = targetBuilder.target;
    var targetDb     = target.targetDb;
    var targetDbPath = target.targetDbPath;
    var sourceDb     = target.sourceDb;
    var sourceDbPath = target.sourceDbPath;

    // save the source and target databases if they've been modified.
    // write a file named 'package.manifest' to the target directory.
    // this file contains metadata for all resources in the package.
    // it is important that this file not be updated if nothing
    /// changed, since it contains the build date and time.
    if (sourceDb.dirty)
    {
        sourceDb.save(sourceDbPath);
        wasModified = true;
    }
    if (targetDb.dirty)
    {
        targetDb.save(targetDbPath);
        wasModified = true;
    }
    if (!targetBuilder.packageManifestExists(PackageBuilder.MANIFEST_NAME))
    {
        // need to re-generate the package manifest file.
        wasModified = true;
    }
    if (wasModified && 0 === targetBuilder.errors)
    {
        targetBuilder.writePackageManifest(PackageBuilder.MANIFEST_NAME);
    }
    targetBuilder.removeAllListeners();
    this.notifyComplete(targetBuilder);
};

/// Starts building the content package for a particular target platform.
/// @param targetName The name of the target platform.
PackageBuilder.prototype.buildTarget = function (targetName)
{
    var project = this.project;
    var bundle  = project.contentPackage(this.packageName);
    var target  = bundle.targetPlatform(targetName ||  '');
    var builder = new TargetBuilder({
        project     : project,
        bundle      : bundle,
        target      : target,
        platforms   : this.platforms,
        compilers   : this.compilers
    });
    builder.expect  = 0;     // number of events expected after build starts
    builder.errors  = 0;     // number of errors encountered
    builder.success = 0;     // number of files build successfully
    builder.skipped = 0;     // number of files skipped for some reason
    builder.started = false; // build hasn't started yet
    builder.on('started', this.handleFileStarted.bind(this));
    builder.on('skipped', this.handleFileSkipped.bind(this));
    builder.on('success', this.handleFileSuccess.bind(this));
    builder.on('error',   this.handleFileError.bind(this));
    this.notifyStarted(builder);
    var sourceFiles =  builder.determineSourceFiles();           // 'skipped'
    var buildFiles  =  builder.determineBuildFiles(sourceFiles); // 'skipped'
    builder.expect  =  buildFiles.length;  // number of events expected
    builder.started =  true;               // build is starting; count events
    builder.rebuildFiles(buildFiles);      // 'skipped', 'success' or 'error'
    if (0 === buildFiles.length)
    {
        // noothing needs to be rebuilt.
        this.targetComplete(builder);
    }
};

/// Inspects the filesystem to determine the known target platforms.
/// @return An array of the names of the known target platforms.
PackageBuilder.prototype.enumerateTargets = function ()
{
    var project = this.project;
    var bundle  = project.contentPackage(this.packageName).cacheTargets();
    return Object.keys(bundle.targets);
}

/// Constructor function for a type that loads projects from disk, starts the
/// content pipeline processes they have defined, and can enumerate and build
/// content packages for the project.
/// @return A reference to the ProjectBuilder instance.
var ProjectBuilder = function ()
{
    if (!(this instanceof ProjectBuilder))
    {
        return new ProjectBuilder();
    }
    this.project      = null; // the Project instance
    this.platforms    = null; // the array of recognized platform names
    this.compilers    = null; // the CompilerCache representing the pipeline
    this.projectName  = '';   // the name of the project
    this.projectPath  = '';   // absolute path of the specific project
    this.rootPath     = '';   // absolute path of the parent directory
    return this;
};
Util.inherits(ProjectBuilder, Events.EventEmitter);

/// Callback invoked when an error occurs when spawning a data compiler.
/// @param compilers The CompilerCache that raised the event.
/// @param info An object specifying additional information about the error.
/// @param info.resourceType A string specifying the resource type whose
/// compiler failed to start.
/// @param info.scriptPath The absolute path of the data compiler script.
/// @param info.error An Error instance specifying additional information.
ProjectBuilder.prototype.handleCompilersError = function (compilers, info)
{
    this.emit('error', this, info);
};

/// Callback invoked when all compiler processes for the content pipeline have
/// been spawned and are ready to begin accepting work.
/// @param compilers The CompilerCache that raised the event.
ProjectBuilder.prototype.handleCompilersReady = function (compilers)
{
    this.emit('ready', this);
};

/// Callback invoked when all compiler processes for the content pipeline have
/// been fully terminated.
/// @param compilers The CompilerCache that raised the event.
ProjectBuilder.prototype.handleCompilersTerminated = function (compilers)
{
    this.emit('disposed', this);
};

/// Loads (or creates) a project from disk, and starts the processes defined
/// for its content pipeline. When the project and its content pipeline are
/// ready to be built, a 'ready' event is emitted.
/// @param projectPath The path of the project directory for the project to
/// load or create. This will be resolved to an absolute path.
/// @return A reference to the ProjectBuilder.
ProjectBuilder.prototype.loadProject = function (projectPath)
{
    var  resolved    = Path.resolve(projectPath || process.cwd());
    var  name        = Path.basename(resolved);
    var  root        = Path.dirname(resolved);
    this.rootPath    = root;
    this.projectName = name;
    this.projectPath = projectPath;
    this.project     = Project.create({
        projectRoot  : root,
        projectName  : name
    });
    var  binRoot     = this.project.processorRoot;
    var  pipeline    = this.project.pipeline;
    this.platforms   = this.project.platforms;
    this.compilers   = Compiler.createCompilerCache(binRoot, pipeline);
    this.compilers.on('error',      this.handleCompilersError.bind(this));
    this.compilers.on('ready',      this.handleCompilersReady.bind(this));
    this.compilers.on('terminated', this.handleCompilersTerminated.bind(this));
    return this;
};

/// Examines the filesystem to determine what content packages are part of the
/// project, and returns the package names.
/// @return An array of strings specifying the names of the content packages
/// defined for the project.
ProjectBuilder.prototype.enumeratePackages = function ()
{
    var project = this.project.cachePackages();
    return Object.keys(project.packages);
};

/// Creates an object that can be used to build a specific content package.
/// @param packageName The name of the content package.
/// @return A new PackageBuilder instance that can manage the package build.
ProjectBuilder.prototype.createPackageBuilder = function (packageName)
{
    return new PackageBuilder({
        project     : this.project,
        packageName : packageName,
        platforms   : this.platforms,
        compilers   : this.compilers
    });
};

/// Stops all processes that are part of the content pipeline for the current
/// project. Once all processes have stopped, a 'disposed' event is emitted.
/// @return A reference to the ProjectBuilder.
ProjectBuilder.prototype.dispose = function ()
{
    if (this.compilers)
    {
        // stop the content compiler processes.
        this.compilers.removeAllListeners();
        this.compilers.shutdown();
        this.compilers = null;
    }
    else
    {
        // nothing to do in this case.
        this.emit('disposed', this);
    }
    return this;
};

/// Loads (or creates) a project from disk.
/// @param projectPath The path of the project directory for the project to
/// load or create. This will be resolved to an absolute path.
/// @return A reference to the Project.
function loadProject(projectPath)
{
    var resolved    = Path.resolve(projectPath || process.cwd());
    var name        = Path.basename(resolved);
    var root        = Path.dirname(resolved);
    return Project.create({
        projectRoot : root,
        projectName : name
    }).cachePackages();
}

/// Creates or loads a content project from disk.
/// @param projectName The name of the content project.
/// @param projectRoot The absolute path where the project will be created.
function createProject(projectName, projectRoot)
{
    return Project.create({
        projectRoot : projectRoot,
        projectName : projectName
    });
}

/// Creates an object that can manage the build process for a project.
/// @return A new ProjectBuilder instance.
function createProjectBuilder()
{
    return new ProjectBuilder();
}

/// Export public symbols from the module.
module.exports.Project                = Project;
module.exports.Package                = Package;
module.exports.Target                 = Target;
module.exports.ProjectBuilder         = ProjectBuilder;
module.exports.PackageBuilder         = PackageBuilder;
module.exports.TargetBuilder          = TargetBuilder;
module.exports.loadProject            = loadProject;
module.exports.createProject          = createProject;
module.exports.createBuilder          = createProjectBuilder;
module.exports.loadPlatformList       = loadPlatformList;
module.exports.savePlatformList       = savePlatformList;
module.exports.loadPipelineDefinition = loadPipelineDefinition;
module.exports.savePipelineDefinition = savePipelineDefinition;
