/*/////////////////////////////////////////////////////////////////////////////
/// @summary Defines functions for working with the content databases that are
/// constructed during content builds and maintain information about asset
/// relationships (dependencies, references, etc.)
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem = require('fs');
var Path       = require('path');

/// Parses a path string to extract the metadata associated with a resource.
/// @param root The absolute path of the source content root directory.
/// @param path The path string to parse. Metadata is extracted from the
/// filename portion of the path.
/// @return An object with 'resourceName', 'resourceType' and 'properties'
/// fields containing the information extracted from the path. The 'properties'
/// field is an array of strings.
function parseResourcePath(root, path)
{
    var pn  = Path.relative(root, path);
    var ls  = pn.lastIndexOf(Path.sep);
    var fp  = pn.indexOf('.',  ls + 1); // first '.' after last Path.sep
    var lp  = pn.lastIndexOf('.');      // last '.' after last Path.sep
    var rn  = pn.substring(0, fp);      // path and filename, without extension
    var rt  = pn.substring(lp +1);      // final extension, w/o leading '.'
    var ps  = fp === lp ? '' : pn.substring(fp + 1, lp);
    return  {
        resourceName : rn,
        resourceType : rt,
        properties   : ps.split('.')
    };
}

/// Constructor function for the SourceDatabase type, which maintains data
/// about source files referenced by the content.
/// @return A reference to the SourceDatabase instance.
var SourceDatabase = function ()
{
    if (!(this instanceof SourceDatabase))
    {
        return new SourceDatabase();
    }
    this.resourceRoot = '';
    this.bundleName   = '';
    this.entries      = [];
    this.entryTable   = {};
    this.dirty        = false;
    return this;
};

/// Loads data from a file into the database. Any existing data is overwritten.
/// @param path The path of the source database file to load.
/// @return A reference to the SourceDatabase instance.
SourceDatabase.prototype.load = function (path)
{
    var json          = Filesystem.readFileSync(path, 'utf8');
    var data          = JSON.parse(json);
    this.bundleName   = data.bundleName || '';
    this.entries      = data.entries    || [];
    this.entryTable   = {};
    this.dirty        = false;
    for (var i = 0, n = this.entries.length; i < n; ++i)
    {
        var en        = this.entries[i];
        en.writeTime  = new Date(en.writeTime);
        this.entryTable[en.relativePath] = i;
    }
    return this;
};

/// Saves the current database contents to a file and resets the dirty status.
/// @param path The path of the file to which the source database information
/// will be written.
/// @return A reference to the SourceDatabase instance.
SourceDatabase.prototype.save = function (path)
{
    var data        = {
        bundleName  : this.bundleName || '',
        entries     : this.entries    || []
    };
    var json        = JSON.stringify(data, null, '\t');
    Filesystem.writeFileSync(path, json, 'utf8');
    this.dirty      = false;
    return this;
};

/// Creates a new database entry representing a given source file. The entry is
/// not inserted into the database.
/// @param rootPath The absolute path of the package root directory.
/// @param sourcePath The absolute path of the source file. The file must
/// exist, as the filesystem is accessed to retrieve file information.
/// @return An object representing the database entry for the specified file.
SourceDatabase.prototype.create = function (rootPath, sourcePath)
{
    var stats = Filesystem.statSync(sourcePath);
    var parts = parseResourcePath(this.resourceRoot, sourcePath);
    return {
        relativePath : Path.relative(rootPath, sourcePath),
        resourceName : parts.resourceName,
        resourceType : parts.resourceType,
        platform     : '',
        properties   : parts.properties,
        references   : [],
        dependencies : [],
        writeTime    : stats.mtime,
        fileSize     : stats.size
    };
};

/// Queries the SourceDatabase to retrieve the entry representing the specified
/// source file.
/// @param rootPath The absolute path of the package root directory.
/// @param sourcePath The absolute path of the source file.
/// @return An object representing the database entry for the specified source
/// file, or undefined if no entry exists.
SourceDatabase.prototype.query = function (rootPath, sourcePath)
{
    var relPath = Path.relative(rootPath, sourcePath);
    var index   = this.entryTable[relPath];
    if (index !== undefined)
        return this.entries[index];
};

/// Inserts an entry into the database. If the entry exists, the existing entry
/// is overwritten. Otherwise, the entry is added.
/// @param entry The source database record to insert.
SourceDatabase.prototype.insert = function (entry)
{
    // if there's an existing entry with this relative path,
    // we want to overwrite it instead of duplicate it.
    var key        = entry.relativePath;
    var index      = this.entries.length;
    var existing   = this.entryTable[key];
    if (existing !== undefined)
    {
        // overwrite the existing entry.
        index = existing;
    }
    // insert the item into the database.
    this.entries[index]  = entry;
    this.entryTable[key] = index;
    this.dirty           = true;
};

/// Deletes the database entry representing a given source file.
/// @param rootPath The absolute path of the package root directory.
/// @param sourcePath The absolute path of the source file.
SourceDatabase.prototype.remove = function (rootPath, sourcePath)
{
    var relPath = Path.relative(rootPath, sourcePath);
    var index   = this.entryTable[relPath];
    if (index !== undefined)
    {
        delete this.entryTable[relPath];
        this.entries.splice(index, 1);
        this.dirty = true;
    }
};

/// Retrieves a the absolute path for a specific file that references a given
/// source file.
/// @param entry The source database entry.
/// @param rootPath The absolute path of the package root directory.
/// @param index The zero-based index of the reference to retrieve.
/// @return The absolute path of the referencing file.
SourceDatabase.prototype.reference = function (entry, rootPath, index)
{
    return Path.join(rootPath, entry.references[index]);
};

/// Retrieves the absolute path for specific file referenced by a given source
/// source file.
/// @param entry The source database entry.
/// @param rootPath The absolute path of the package root directory.
/// @param index The zero-based index of the reference to retrieve.
/// @return The absolute path of the referenced file.
SourceDatabase.prototype.dependency = function (entry, rootPath, index)
{
    return Path.join(rootPath, entry.dependencies[index]);
};

/// Adds a reference link from one source file to another.
/// @param entry The source database entry for the referenced source file.
/// @param rootPath The absolute path of the package root directory.
/// @param sourcePath The absolute path of the referencing source file.
SourceDatabase.prototype.addReference = function (entry, rootPath, sourcePath)
{
    var relPath = Path.relative(rootPath, sourcePath);
    var index   = entry.references.indexOf(relPath);
    if (index   < 0)
    {
        // reference doesn't exist; add it.
        entry.references.push(relPath);
    }
};

/// Adds a dependency link from one source file to another.
/// @param entry The source database entry for the referencing source file.
/// @param rootPath The absolute path of the package root directory.
/// @param sourcePath The absolute path of the referenced source file.
SourceDatabase.prototype.addDependency = function (entry, rootPath, sourcePath)
{
    var relPath = Path.relative(rootPath, sourcePath);
    var index   = entry.dependencies.indexOf(relPath);
    if (index   < 0)
    {
        // dependency doesn't exist; add it.
        entry.dependencies.push(relPath);
    }
};

/// Constructor function for the TargetDatabase type, which maintains data
/// about target files output by the content pipeline.
/// @return A reference to the TargetDatabase instance.
var TargetDatabase = function ()
{
    if (!(this instanceof TargetDatabase))
    {
        return new TargetDatabase();
    }
    this.resourceRoot = '';
    this.bundleName   = '';
    this.platform     = '';
    this.entries      = [];
    this.entryTable   = {};
    this.dirty        = false;
    return this;
};

/// Loads data from a file into the database. Any existing data is overwritten.
/// @param path The path of the target database file to load.
/// @return A reference to the TargetDatabase instance.
TargetDatabase.prototype.load = function (path)
{
    var json          = Filesystem.readFileSync(path, 'utf8');
    var data          = JSON.parse(json);
    this.bundleName   = data.bundleName || '';
    this.platform     = data.platform   || '';
    this.entries      = data.entries    || [];
    this.entryTable   = {};
    this.dirty        = false;
    for (var i = 0, n = this.entries.length; i < n; ++i)
    {
        var en        = this.entries[i];
        this.entryTable[en.relativePath] = i;
    }
    return this;
};

/// Saves the current database contents to a file and resets the dirty status.
/// @param path The path of the file to which the target database information
/// will be written.
/// @return A reference to the TargetDatabase instance.
TargetDatabase.prototype.save = function (path)
{
    var data        = {
        bundleName  : this.bundleName || '',
        platform    : this.platform   || '',
        entries     : this.entries    || []
    };
    var json        = JSON.stringify(data, null, '\t');
    Filesystem.writeFileSync(path, json, 'utf8');
    this.dirty      = false;
    return this;
};

/// Creates a new database entry representing a given target file. The entry is
/// not inserted into the database.
/// @param rootPath The absolute path of the package root directory.
/// @param sourcePath The absolute path of the source file.
/// @param targetPath The absolute path of the target file. The file must
/// exist, as the filesystem is accessed to retrieve file information.
/// @param compilerName The name of the content compiler.
/// @param compilerVersion The version of the content compiler.
/// @return An object representing the database entry for the specified file.
TargetDatabase.prototype.create = function (
    rootPath,
    sourcePath,
    targetPath,
    compilerName,
    compilerVersion)
{
    return {
        relativePath : Path.relative(rootPath, targetPath),
        sourcePath   : Path.relative(rootPath, sourcePath),
        platform     : this.platform,
        compilerName : compilerName,
        outputs      : []
    };
};

/// Queries the TargetDatabase to retrieve the entry representing the specified
/// target file.
/// @param rootPath The absolute path of the package root directory.
/// @param sourcePath The absolute path of the target file.
/// @return An object representing the database entry for the specified target
/// file, or undefined if no entry exists.
TargetDatabase.prototype.query = function (rootPath, targetPath)
{
    var relPath = Path.relative(rootPath, targetPath);
    var index   = this.entryTable[relPath];
    if (index !== undefined)
        return this.entries[index];
};

/// Inserts an entry into the database. If the entry exists, the existing entry
/// is overwritten. Otherwise, the entry is added.
/// @param entry The target database record to insert.
TargetDatabase.prototype.insert = function (entry)
{
    // if there's an existing entry with this relative path,
    // we want to overwrite it instead of duplicate it.
    var key        = entry.relativePath;
    var index      = this.entries.length;
    var existing   = this.entryTable[key];
    if (existing !== undefined)
    {
        // overwrite the existing entry.
        index = existing;
    }
    // insert the item into the database.
    this.entries[index]  = entry;
    this.entryTable[key] = index;
    this.dirty           = true;
};

/// Deletes the database entry representing a given target file.
/// @param rootPath The absolute path of the package root directory.
/// @param sourcePath The absolute path of the target file.
TargetDatabase.prototype.remove = function (rootPath, targetPath)
{
    var relPath = Path.relative(rootPath, targetPath);
    var index   = this.entryTable[relPath];
    if (index !== undefined)
    {
        delete this.entryTable[relPath];
        this.entries.splice(index, 1);
        this.dirty = true;
    }
};

/// Retrieves the absolute path for specific output file.
/// @param entry The target database entry.
/// @param rootPath The absolute path of the package root directory.
/// @param index The zero-based index of the output path to retrieve.
/// @return The absolute path of the output file.
TargetDatabase.prototype.output = function (entry, rootPath, index)
{
    return Path.join(rootPath, entry.outputs[index]);
};

/// Adds an output file reference.
/// @param entry The target database entry for the output file.
/// @param rootPath The absolute path of the package root directory.
/// @param outputPath The absolute path of the output file.
TargetDatabase.prototype.addOutput = function (entry, rootPath, outputPath)
{
    var relPath = Path.relative(rootPath, outputPath);
    var index   = entry.outputs.indexOf(relPath);
    if (index   < 0)
    {
        // output doesn't exist; add it.
        entry.outputs.push(relPath);
    }
};

/// Attempts to load a source database from a file. Exceptions are not caught.
/// @param path The path of the file to load.
/// @return A reference to the new SourceDatabase containing the data from the
/// specified file.
function loadSourceDatabase(path)
{
    var sourceDb = new SourceDatabase();
    if (Filesystem.existsSync(path))
        sourceDb.load(path);
    else
        sourceDb.dirty = true; // newly created
    return sourceDb;
}

/// Creates a new, empty source database.
/// @return A new SourceDatabase instance.
function createSourceDatabase()
{
    return new SourceDatabase();
}

/// Attempts to load a target database from a file. Exceptions are not caught.
/// @param path The path of the file to load.
/// @return A reference to the new TargetDatabase containing the data from the
/// specified file.
function loadTargetDatabase(path)
{
    var targetDb = new TargetDatabase();
    if (Filesystem.existsSync(path))
        targetDb.load(path);
    else
        targetDb.dirty = true; // newly created
    return targetDb;
}

/// Creates a new, empty target database.
/// @return A new TargetDatabase instance.
function createTargetDatabase()
{
    return new TargetDatabase();
}

/// Export public types and functions from the module.
module.exports.SourceDatabase       = SourceDatabase;
module.exports.TargetDatabase       = TargetDatabase;
module.exports.parseResourcePath    = parseResourcePath;
module.exports.loadSourceDatabase   = loadSourceDatabase;
module.exports.loadTargetDatabase   = loadTargetDatabase;
module.exports.createSourceDatabase = createSourceDatabase;
module.exports.createTargetDatabase = createTargetDatabase;
