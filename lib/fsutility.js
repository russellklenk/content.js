/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements a number of methods for dealing with the filesystem
/// that are missing from the Node.js core libraries.
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem  = require('fs');
var Events      = require('events');
var Path        = require('path');
var Util        = require('util');

/// Implements proper value defaulting for types which may have falsey values.
/// @param field The value to check.
/// @param def The value to return if @a field is undefined.
/// @return @a field if @a field is not undefined; otherwise, @a def.
function defaultValue(field, def)
{
    return (field !== undefined ? field : def);
}

/// Constructs a new FSEntry instance, which represents a single file or
/// directory in a filesystem tree.
/// @param rootPath The absolute path of the root of the filesystem tree.
/// @param entryName The name of the entry relative to its parent.
/// @param absPath The absolute path of the entry on the filesystem.
/// @param statInfo A fs.Stats specifying information about the entry.
/// @return A reference to the new instance.
var FSEntry = function (rootPath, entryName, absPath, statInfo)
{
    this.root  = rootPath  || '';
    this.name  = entryName || '';
    this.path  = absPath   || '';
    this.stat  = statInfo  || {};
    this.seen  = false;
    this.dirs  = [];
    this.files = [];
    this.tabd  = {};
    this.tabf  = {};
    return this;
};

/// Serializes a tree of FSEntry instances to a JSON-encoded string.
/// @param root An FSEntry instance representing the root of the tree.
/// @param format An optional string passed to JSON.stringify() that controls
/// formatting of the output. See JSON.stringify().
/// @return A string containing the JSON-formatted data.
FSEntry.treeToJSON = function (root, format)
{
    var treeToObject = function (node)
        {
            var nodeToObject = function (node)
            {                return {
                    name  : node.name,
                    path  : Path.relative(node.root, node.path),
                    stat  : node.stat,
                    dirs  : new Array(node.dirs.length),
                    files : new Array(node.files.length)
                };
            };

            var  self  = nodeToObject(node);
            for (var i = 0, n = node.files.length; i < n; ++i)
            {
                self.files[i] = nodeToObject(node.files[i]);
            }
            for (var i = 0, n = node.dirs.length; i < n; ++i)
            {
                self.dirs[i]  = treeToObject(node.dirs[i]);
            }
            return self;
        };
    return JSON.stringify({
        root  : root.root,
        nodes : treeToObject(root)
    }, null, format);
};

/// Reconstructs a tree of FSEntry instances from a JSON-encoded form.
/// @param json A string containing the JSON-encoded tree data.
/// @return An FSEntry instance representing the root of the tree.
FSEntry.treeFromJSON = function (json)
{
    var objectToTree = function (rootPath, obj)
        {
            var objToEntry = function (rootPath, obj)
                {
                    var absPath  = Path.join(rootPath, obj.path);
                    var stat     = new Filesystem.Stats();
                    stat.dev     = obj.stat.dev;
                    stat.ino     = obj.stat.ino;
                    stat.mode    = obj.stat.mode;
                    stat.nlink   = obj.stat.nlink;
                    stat.uid     = obj.stat.uid;
                    stat.gid     = obj.stat.gid;
                    stat.rdev    = obj.stat.rdev;
                    stat.size    = obj.stat.size;
                    stat.blksize = obj.stat.blksize;
                    stat.blocks  = obj.stat.blocks;
                    stat.atime   = new Date(obj.stat.atime);
                    stat.mtime   = new Date(obj.stat.mtime);
                    stat.ctime   = new Date(obj.stat.ctime);
                    return new FSEntry(rootPath, obj.name, absPath, stat);
                };

            var  self  = objToEntry(rootPath, obj);
            for (var i = 0, n = obj.files.length; i < n; ++i)
            {
                self.tabf[obj.name] = i;
                self.files.push(objToEntry(rootPath, obj.files[i]));
            }
            for (var i = 0, n = obj.dirs.length; i < n; ++i)
            {
                self.tabd[obj.name] = i;
                self.dirs.push(objectToTree(rootPath, obj.dirs[i]));
            }
            return self;
        };

    var tree  = JSON.parse(json);
    var root  = tree.root  || '';
    var nodes = tree.nodes || {};
    return objectToTree(root, nodes);
};

/// Queries the entry to determine whether it references a file.
/// @return true if the entry references a file.
FSEntry.prototype.isFile = function ()
{
    return this.stat.isFile();
};

/// Queries the entry to determine whether it references a directory.
/// @return true if the entry references a directory.
FSEntry.prototype.isDirectory = function ()
{
    return this.stat.isDirectory();
};

/// Searches for a named file located within the directory.
/// @param filename The name of the file entry to locate.
/// @return The zero-based index of the specified file, or -1 if not found.
FSEntry.prototype.indexOfFile = function (filename)
{
    var     index   = this.tabf[filename];
    return (index !== undefined ? index : -1);
};

/// Searches for a named subdirectory located within the directory.
/// @param dirname The name of the directory entry to locate.
/// @return The zero-based index of the specified subdirectory, or -1.
FSEntry.prototype.indexOfDirectory = function (dirname)
{
    var     index   = this.tabd[dirname];
    return (index !== undefined ? index : -1);
}

/// The object representing the FSScanner type, which can scan a directory tree
/// and return information as an FSEntry. All methods are static.
var FSScanner = {};

/// Builds a tree of FSEntry instances describing the current state of the
/// filesystem from a particular root path.
/// @param options An object controlling the scanner behavior.
/// @param options.from The root path at which to begin the scan. This path is
/// resolved into an absolute path prior to use. Defaults to process.cwd().
/// @param options.recursive Specify true to recurse into subdirectories. The
/// default value is true.
/// @param options.ignoreHidden Specify true to ignore hidden directories and
/// files (anything beginning with a '.' character.) The default value is true.
/// @return An FSEntry instance representing the root of the tree.
FSScanner.scanTree = function (options)
{
    options              = options || {};
    options.from         = Path.resolve(options.from || process.cwd());
    options.recursive    = defaultValue(options.recursive,    true);
    options.ignoreHidden = defaultValue(options.ignoreHidden, true);
    var rootStat         = Filesystem.statSync(options.from);
    return FSScanner.scanDirectory(options, options.from, '', rootStat);
};

/// Scans a directory on the filesystem, returning information about the
/// directory contents as an FSEntry instance.
/// @param options An object controlling the scanner behavior.
/// @param options.from The root path at which to begin the scan. This path is
/// resolved into an absolute path prior to use. Defaults to process.cwd().
/// @param options.recursive Specify true to recurse into subdirectories. The
/// default value is true.
/// @param options.ignoreHidden Specify true to ignore hidden directories and
/// files (anything beginning with a '.' character.) The default value is true.
/// @param thisPath The absolute path of the directory entry.
/// @param thisName The name of the directory entry, relative to its parent.
/// For the root directory, this value will be an empty string.
/// @param thisStat A fs.Stats specifying information about the directory.
/// @return An FSEntry instance containing information for the directory and
/// its entire subtree.
FSScanner.scanDirectory = function (options, thisPath, thisName, thisStat)
{
    var parent   = new FSEntry(options.from, thisName, thisPath, thisStat);
    var contents = Filesystem.readdirSync(thisPath);
    var num      = contents.length;
    for (var i   = 0; i < num; ++i)
    {
        var name = contents[i];
        if (options.ignoreHidden && name[0] === '.')
            continue;

        var abs  = Path.join(thisPath, name);
        var stat = Filesystem.statSync(abs);
        if (stat.isDirectory() && options.recursive)
        {
            var dirEntry      = FSScanner.scanDirectory(options, abs, name, stat);
            var dirIndex      = parent.dirs.length;
            parent.tabd[name] = dirIndex;
            parent.dirs.push(dirEntry);
        }
        else if (stat.isDirectory()) // but we're not monitoring recursively
        {
            var dirEntry      = new FSEntry(options.from, name, abs, stat);
            var dirIndex      = parent.dirs.length;
            parent.tabd[name] = dirIndex;
            parent.dirs.push(dirEntry);
        }
        else if (stat.isFile())
        {
            var fileEntry     = new FSEntry(options.from, name, abs, stat);
            var fileIndex     = parent.files.length;
            parent.tabf[name] = fileIndex;
            parent.files.push(fileEntry);
        }
        // else, some type of entry we don't care about
    }
    return parent;
};

/// The object representing the FSDiffer type, which can determine the
/// differences between two in-memory copies of a filesystem tree. All methods
/// are static.
var FSDiffer = {};

/// Creates an empty difference list object for entries rooted at a given path.
/// @param root The absolute root path for all FSEntry data.
/// @return An object representing the difference list. The object has fields:
/// diffList.rootPath: Stores the value @a root.
/// diffList.additions: An array of FSEntry representing created items.
/// diffList.deletions: An array of FSEntry representing deleted items.
/// diffList.changes: An array of object with fields 'prev' and 'curr', each of
/// which are set to an FSEntry containing detailed information.
/// diffList.count: The number of differences.
FSDiffer.createDifferenceList = function (root)
{
    return {
        rootPath  : root,    // absolute path for everything
        additions : [],      // FSEntry in 'current' representing additions
        deletions : [],      // FSEntry in 'previous' representing removals
        changes   : [],      // object { prev: FSEntry, curr: FSEntry }
        count     : 0        // total number of changes
    };
};

/// Determines the differences in the files and subdirectories of two versions
/// of a given filesystem tree.
/// @param root The absolute root path for all FSEntry data.
/// @param a The FSEntry instance representing the 'previous' or 'left-hand'
/// version of the filesystem tree. This FSEntry should identify a directory.
/// @param b The FSEntry instance representing the 'current' or 'right-hand'
/// version of the filesystem tree. This FSEntry should identify a directory.
/// @param recursive Specify true to diff the entire tree recursively. The
/// default value is true.
FSDiffer.diffTree = function (root, a, b, recursive)
{
    var diffs = FSDiffer.createDifferenceList(root);
    recursive = defaultValue(recursive, true);
    FSDiffer.diffDirectory(a, b, diffs, recursive);
    return diffs;
};

/// Determines the differences in the files and subdirectories of two versions
/// of a directory.
/// @param a The FSEntry instance representing the 'previous' or 'left-hand'
/// version of the directory.
/// @param b The FSEntry instance representing the 'current' or 'right-hand'
/// version of the directory.
/// @param diff The difference list object to update with any differences.
/// @param recursive Specify true to recursively diff subdirectories. The
/// default value is false.
FSDiffer.diffDirectory = function (a, b, diff, recursive)
{
    // first diff all of the files contained in the directory.
    FSDiffer.diffFiles(a, b, diff);

    // and then diff the subdirectories within the directory.
    var  dirsA  = a.dirs;
    var  dirsB  = b.dirs;
    var  numdA  = dirsA.length;
    var  numdB  = dirsB.length;
    for (var ia = 0; ia < numdA; ++ia)
    {
        var da  = dirsA[ia];
        var ib  = b.indexOfDirectory(da.name);
        if (ib >= 0)
        {
            // this directory exists in both a and b.
            var db  = dirsB[ib];
            if (recursive)
            {
                FSDiffer.diffDirectory(da, db, diff, recursive);
            }
            db.seen = true;
        }
        else
        {
            // this directory existed in a but was deleted in b.
            diff.deletions.push(da);
            diff.count++;
        }
    }
    for (var ib = 0; ib < numdB; ++ib)
    {
        var  db = dirsB[ib];
        if (!db.seen)
        {
            // this directory was not in the previous listing.
            diff.additions.push(db);
            diff.count++;
        }
    }
};

/// Determines the differences between the files in two directories.
/// @param a The FSEntry instance representing the 'previous' or 'left-hand'
/// version of the directory.
/// @param b The FSEntry instance representing the 'current' or 'right-hand'
/// version of the directory.
/// @param diff The difference list object to update with any differences.
FSDiffer.diffFiles = function (a, b, diff)
{
    var  filesA = a.files;
    var  filesB = b.files;
    var  numfA  = filesA.length;
    var  numfB  = filesB.length;
    for (var ia = 0; ia < numfA; ++ia)
    {
        var fa  = filesA[ia];
        var ib  = b.indexOfFile(fa.name);
        if (ib >= 0)
        {
            // this file exists in both a and b. check for modifications.
            var fb  = filesB[ib];
            var sa  = fa.stat.size;
            var sb  = fb.stat.size;
            var ta  = fa.stat.mtime.getTime();
            var tb  = fb.stat.mtime.getTime();
            if (sa != sb || ta != tb)
            {
                // this file was modified, as either the sizes differ or
                // the date and time of last modification differs.
                diff.changes.push({
                    prev : fa,
                    curr : fb
                });
                diff.count++;
            }
            // we've 'seen' this file in b.
            fb.seen = true;
        }
        else
        {
            // this file existed in a but was deleted in b.
            diff.deletions.push(fa);
            diff.count++;
        }
    }
    for (var ib = 0; ib < numfB; ++ib)
    {
        var  fb = filesB[ib];
        if (!fb.seen)
        {
            // this file was not in the previous listing.
            diff.additions.push(fb);
            diff.count++;
        }
    }
};

/// Writes path information for a difference list to the console.
/// @param diffList The difference list object to dump.
FSDiffer.dumpDiffs = function (diffList)
{
    if (diffList && diffList.count > 0)
    {
        console.log('Differences detected:');

        if (diffList.additions.length > 0)
        {
            console.log('  Additions: ');
            for (var i = 0, n = diffList.additions.length; i < n; ++i)
                console.log('    '+diffList.additions[i].path);
        }
        else console.log('  Additions: None');

        if (diffList.deletions.length > 0)
        {
            console.log('  Deletions: ');
            for (var i = 0, n = diffList.deletions.length; i < n; ++i)
                console.log('    '+diffList.deletions[i].path);
        }
        else console.log('  Deletions: None');

        if (diffList.changes.length > 0)
        {
            console.log('  Modifications: ');
            for (var i = 0, n = diffList.changes.length; i < n; ++i)
                console.log('    '+diffList.changes[i].curr.path);
        }
        else console.log('  Modifications: None');
    }
    else console.log('No differences detected.');
};

/// Constructor function for a type that can monitor a directory tree and
/// report file and directory additions, deletions and modifications. The
/// implementation uses stat polling and must keep the entire tree in memory.
/// Unfortunately, fs.watch behavior is inconsistent across platforms and in
/// some cases (OSX) unusable for monitoring large numbers of items.
/// @param options An object specifying options that control watcher behavior.
/// @param options.from A string specifying the root top-most directory that
/// will be monitored. This path will be resolved into an absolute path.
/// @param options.interval An integer specifying the number of milliseconds
/// between polling of the filesystem.
/// @param options.recursive A boolean value that should be set to true in
/// order monitor the entire directory tree under the root path.
/// @param options.ignoreHidden A boolean value that should be set to true in
/// order to ignore (not monitor) any files or directories that begin with '.'.
/// @return A reference to the FSWatcher instance.
var FSWatcher = function (options)
{
    if (!(this instanceof FSWatcher))
    {
        return new FSWatcher(options);
    }
    options              = options || {};
    options.from         = Path.resolve(options.from || process.cwd());
    options.interval     = defaultValue(options.interval, 1000);
    options.recursive    = defaultValue(options.recursive, true);
    options.ignoreHidden = defaultValue(options.ignoreHidden, true);
    this.timerId         = null;
    this.rootPath        = options.from;
    this.interval        = options.interval;
    this.recursive       = options.recursive;
    this.ignoreHidden    = options.ignoreHidden;
    this.currentTree     = null;
    this.previousTree    = null;
    return this;
}
Util.inherits(FSWatcher, Events.EventEmitter);

/// Scans the filesystem starting from the root path.
/// @return An FSEntry instance containing information for the filesystem tree.
FSWatcher.prototype.scanTree = function ()
{
    return FSScanner.scanTree({
        from         : this.rootPath,
        recursive    : this.recursive,
        ignoreHidden : this.ignoreHidden
    });
};

/// Diffs the filesystem starting from the root path.
/// @return An object representing the differences between the two trees. See
/// function FSDiffer.diffTree() for more information.
FSWatcher.prototype.diffTree = function ()
{
    return FSDiffer.diffTree(
        this.rootPath,
        this.previousTree,
        this.currentTree,
        this.recursive);
};

/// Handles a single update cycle for the watcher, swapping the filesystem
/// trees, rescanning, diffing and possibly emitting events.
FSWatcher.prototype.update = function ()
{
    this.previousTree  = this.currentTree;
    this.currentTree   = this.scanTree();
    var diffList       = this.diffTree();
    if (diffList.count > 0)
    {
        // provide the complete, raw data.
        this.emit('data', this, diffList);
        // emit deletions, then additions, then changes.
        for (var i = 0, n = diffList.deletions.length; i < n; ++i)
        {
            this.emit('remove', this, diffList.deletions[i]);
        }
        for (var i = 0, n = diffList.additions.length; i < n; ++i)
        {
            this.emit('create', this, diffList.additions[i]);
        }
        for (var i = 0, n = diffList.changes.length;   i < n; ++i)
        {
            this.emit('change', this, diffList.changes[i]);
        }
    }
};

/// Starts monitoring the current root directory.
/// @return A reference to the FSWatcher instance.
FSWatcher.prototype.start = function ()
{
    if (this.interval < 60)
    {
        this.interval = 60;
    }
    if (this.timerId)
    {
        clearInterval(this.timerId);
        this.timerId  = null;
    }
    var tree          = this.scanTree();
    this.previousTree = tree;
    this.currentTree  = tree;
    this.timerId      = setInterval(this.update.bind(this), this.interval);
    return this;
};

/// Stops monitoring the current root directory.
/// @return A reference to the FSWatcher instance.
FSWatcher.prototype.stop = function ()
{
    if (this.timerId)
    {
        clearInterval(this.timerId);
        this.timerId = null;
    }
};

/// Ensure that a value ends in the path separator character.
/// @param value The string value to check. Shamelessly ripped from wrench.js.
/// @return The string @a value, with a path separator appended if necessary.
function ensurePathSeparator(value)
{
    value = value || Path.sep;
    var l = value.length;
    if (l > 0)
    {
        var c  = value[l-1];
        if (c != '/' && c != '\\') return value + Path.sep;
    }
    return value;
}

/// Ensure that a value does not end in a path separator character. Shamelessly
/// ripped from wrench.js.
/// @param value The string value to check.
/// @return The string @a value, the any trailing path separator(s) removed.
function removePathSeparator(value)
{
    if (value)
    {
        var l = value.length;
        if (l > 0)
        {
            var n = 0;
            do
            {
                var c  = value[l-1];
                if (c != '/' && c != '\\')
                {
                    // encountered a non-separator character.
                    break;
                }
                else
                {
                    // this is a separator chartacter; trim it.
                    ++n; --l;
                }
            } while (l > 0);
            return  (n > 0) ? value.slice(0, -n) : value;
        }
        // else, value is an empty string.
    }
    return value;
}

/// Synchronously walks a filesystem tree, executing a user-defined callback
/// for each file or directory.
/// @param absPath The absolute path of the directory.
/// @param relPath The relative path of the directory. The path is specified
/// relative to @a options.from.
/// @param statInfo An fs.Stats instance describing the filesystem entry.
/// @param callback A function (object) : void to invoke for each entry. The
/// parameter has the following fields:
/// object.rootPath: The root path of the walk operation.
/// object.absolutePath: The absolute path of the entry.
/// object.relativePath: The path of the entry relative to the root path.
/// object.name: The name of the file or directory, relative to its parent.
/// object.stat: The fs.Stats instance associated with the entry.
/// @param options An object controlling the walk behavior.
/// @param options.from The root path at which to begin the scan. This path is
/// resolved into an absolute path prior to use. Defaults to process.cwd().
/// @param options.recursive Specify true to recurse into subdirectories. The
/// default value is true.
/// @param options.ignoreHidden Specify true to ignore hidden directories and
/// files (anything beginning with a '.' character.) The default value is true.
function walkTreeRecursive(absPath, relPath, statInfo, callback, options)
{
    var contents = Filesystem.readdirSync(absPath);
    var count    = contents.length;
    for (var i   = 0; i < count; ++i)
    {
        var name = contents[i];
        if (options.ignoreHidden && name[0] === '.')
            continue;

        var abs  = Path.join(absPath, name);
        var rel  = Path.join(relPath, name);
        var stat = Filesystem.statSync(abs);
        if (stat.isDirectory() || stat.isFile())
        {
            callback({
                rootPath     : options.from,
                absolutePath : abs,
                relativePath : rel,
                name         : name,
                stat         : stat
            });
            if (options.recursive && stat.isDirectory())
            {
                walkTreeRecursive(abs, rel, stat, callback, options);
            }
        }
    }
}

/// Synchronously walks a filesystem tree, executing a user-defined callback
/// for each file or directory. The root directory is NOT included.
/// @param callback A function (object) : void to invoke for each entry.
/// @param options An object controlling the walk behavior.
/// @param options.from The root path at which to begin the scan. This path is
/// resolved into an absolute path prior to use. Defaults to process.cwd().
/// @param options.recursive Specify true to recurse into subdirectories. The
/// default value is true.
/// @param options.ignoreHidden Specify true to ignore hidden directories and
/// files (anything beginning with a '.' character.) The default value is true.
function walkTree(callback, options)
{
    callback             = callback || function (info) { /* empty */ }
    options              = options  || {};
    options.from         = Path.resolve(options.from || process.cwd());
    options.recursive    = defaultValue(options.recursive,    true);
    options.ignoreHidden = defaultValue(options.ignoreHidden, true);
    var absPath          = options.from;
    var relPath          = '';
    var statInfo         = Filesystem.statSync(absPath);
    walkTreeRecursive(absPath, relPath, statInfo, callback, options);
}

/// Synchronously creates a directory tree. Any directories in the path that
/// don't exist are created. Shamelessly ripped from node-mkdirp.
/// @param path The path to create.
/// @param mode A number specifying the directory permissions.
/// @param made The portion of the path that has been created successfully.
/// @return The portion of the path that was created successfully.
function makeTreeRecursive(path, mode, made)
{
    try
    {
        path  = Path.resolve(path);
        Filesystem.mkdirSync(path, mode);
        made  = made || path;
    }
    catch (err0)
    {
        switch (err0.code)
        {
            case 'ENOENT' :
                {
                    // a portion of the path doesn't exist, chop off the
                    // last directory from the path and try again.
                    made = makeTreeRecursive(Path.dirname(path), mode, made);
                    makeTreeRecursive(path, mode, made);
                }
                break;
            case 'EISDIR':
            case 'EPERM':
            case 'EROFS':
            case 'EEXIST' :
                {
                    var stat;
                    try
                    {
                        stat = Filesystem.statSync(path);
                    }
                    catch (err1)
                    {
                        throw err0;
                    }
                    if (!stat.isDirectory()) throw err0;
                }
                break;
            default:
                {
                    throw err0;
                }
                break;
        }
    }
    return made;
}

/// Synchronously creates a directory tree. Any directories in the path that
/// don't exist are created. Shamelessly ripped from node-mkdirp.
/// @param path The path to create.
/// @param mode An number or octal permissions string specifying the directory
/// permissions. Defaults to 0777.
function makeTree(path, mode)
{
    if (       mode === undefined) mode = 0777 & (~process.umask());
    if (typeof mode === 'string')  mode = parseInt(mode, 8);
    var made = null;
    makeTreeRecursive(path, mode,  made);
}

/// Synchronously reads the contents of a directory and all child directories.
/// Shamelessly ripped from wrench.js.
/// @param path The parent path to read. This path string should have any
/// trailing path separators removed.
/// @return An array containing the absolute paths of the files and directories
/// under @a path and all of its child directories.
function readTreeRecursive(path)
{
    var files = [];
    var curFiles;
    var nextDirs;
    var isDir = function (fname)
    {
        return Filesystem.statSync(Path.join(path, fname)).isDirectory();
    };
    var prependBase = function (fname)
    {
        return Path.join(path, fname);
    };
    curFiles  = Filesystem.readdirSync(path);
    nextDirs  = curFiles.filter(isDir);
    curFiles  = curFiles.map(prependBase);
    files     = files.concat(curFiles);
    while (nextDirs.length)
    {
        files = files.concat(readTreeRecursive(Path.join(path, nextDirs.shift())));
    }
    return files;
}

/// Synchronously reads the contents of a directory and all child directories.
/// Shamelessly ripped from wrench.js.
/// @param path The parent path to read.
/// @param [relative] Specify true to return the results relative to @a path.
/// Specify false to return absolute paths.
/// @return An array containing the paths of the files and directories under
/// @a path and all of its child directories.
function readTree(path, relative)
{
    var basePath = removePathSeparator(path);
    var fileList = readTreeRecursive(basePath);
    if (relative)
    {
        fileList = fileList.map(function (val)
            {
                return Path.relative(basePath, val);
            });
    }
    return fileList;
}

/// Synchronously determines whether a given path exists and represents a file
/// by querying the filesystem.
/// @param path The path to check.
/// @return true if @a path represents a file that exists.
function isFile(path)
{
    try
    {
        var    stat = Filesystem.statSync(path);
        return stat.isFile();
    }
    catch (err)
    {
        // doesn't exist, can't access, etc.
        return false;
    }
}

/// Synchronously determines whether a given path exists and represents a
/// directory by querying the filesystem.
/// @param path The path to check.
/// @return true if @a path represents a directory that exists.
function isDirectory(path)
{
    try
    {
        var    stat = Filesystem.statSync(path);
        return stat.isDirectory();
    }
    catch (err)
    {
        // doesn't exist, can't access, etc.
        return false;
    }
}

/// Writes an numeric value to a tar header block. The value is written as a
/// string of ASCII-encoded octal digits. Space permitting, an ASCII space
/// character (byte value 32) is written and any remaining space is filled with
/// zero bytes until the desired length is reached.
/// @param buffer The destination buffer.
/// @param offset The byte offset within @a buffer at which to begin writing.
/// @param length The number of bytes to write.
/// @param val The integer Number value to write.
function tarWriteOctal(buffer, offset, length, val)
{
    var endofs = offset + length;
    var valstr = val.toString(8);
    var vallen = valstr.length;
    for (var i = 0; i < vallen; ++i)
    {
        buffer[offset++] = valstr.charCodeAt(i);
    }
    // write a space, if it will fit.
    if (vallen > 0 && length - vallen >= 2)
    {
        buffer[offset++] = 32; // ASCII space
    }
    // pad the value out with null bytes.
    for (var i = offset; i < endofs;  ++i)
    {
        buffer[offset++] = 0;
    }
}

/// Writes a string value to a tar header block. The value is written as a
/// series of ASCII-encoded characters. Any remaining space is filled with zero
/// bytes until the desired length is achieved.
/// @param buffer The destination buffer.
/// @param offset The byte offset within @a buffer at which to begin writing.
/// @param length The number of bytes to write.
/// @param val The String value to write.
function tarWriteString(buffer, offset, length, val)
{
    var nbytes = Buffer.byteLength(val, 'ascii');
    if (nbytes > length)
    {
        // we need to write only a portion of the string.
        nbytes = length;
    }
    // write the ASCII-encoded character data.
    var nwrite = buffer.write(val, offset, nbytes, 'ascii');
    // pad the remainder of the buffer with zero bytes.
    for (var i = nwrite; i < length; ++i)
    {
        buffer[offset + i] = 0;
    }
}

/// Writes the tar header entry for a file to a buffer. This function only
/// handles ASCII character paths properly; paths with unicode characters may
/// not be written to the archive without data loss.
/// @param buffer The 512 byte destination buffer.
/// @param relativePath The relative path of the file.
/// @param stat The fs.Stats instance describing the file attributes.
function tarWriteHeader(buffer, relativePath, stat)
{
    var mb = 'ustar';    // magic bytes
    var vs = '00';       // version field
    var cs = '        '; // checksum placeholder (8 ASCII space characters)
    var bo = 0;          // byte offset
    var sz = stat.size;  // size of file in bytes
    var tf = '0';        // typeflag field; '0' = normal file
    var ns = '';         // name string field
    var ps = '';         // prefix string field
    var wo = tarWriteOctal;
    var ws = tarWriteString;
    var pl = Buffer.byteLength(relativePath, 'ascii');
    if (pl > 99)         // 100 bytes; 99 ASCII characters plus zero byte
    {
        // the path string is too long and must be split
        // between the name and prefix header fields.
        var  nchar    = relativePath.length;
        var  lastPart = relativePath.substr(-99);
        var  firstSep = lastPart.indexOf(Path.sep);
        ns = lastPart.substr(firstSep + 1);
        ps = relativePath.substr(0, (nchar - 99) + (firstSep + 1));
        ps = ps.substr(-155);
    }
    else
    {
        // the entire path fits in the name field.
        // the prefix field will be an empty string.
        ns = relativePath;
        ps = '';
    }

    // write out the header fields. there are a few things of note:
    // the mode is always set to 0644, which is owner: rw, group: r, other: r
    // the uid and gid fields are always set to zero
    // the mtime field is always set to 0ms since midnight January 1st 1970
    ws(buffer, bo, 100,  ns); bo += 100; // name field
    wo(buffer, bo,   8, 420); bo +=   8; // mode field; 420d = 0644
    wo(buffer, bo,   8,   0); bo +=   8; // uid field;  0    = root
    wo(buffer, bo,   8,   0); bo +=   8; // gid field;  unspecified
    wo(buffer, bo,  12,  sz); bo +=  12; // size field
    wo(buffer, bo,  12,   0); bo +=  12; // mtime field (constant)
    ws(buffer, bo,   8,  cs); bo +=   8; // chksum field (spaces)
    ws(buffer, bo,   1,  tf); bo +=   1; // typeflag field (normal file)
    ws(buffer, bo, 100,  ''); bo += 100; // linkname field (empty string)
    ws(buffer, bo,   6,  mb); bo +=   6; // magic field
    ws(buffer, bo,   2,  vs); bo +=   2; // version field
    ws(buffer, bo,  32,  ''); bo +=  32; // uname field
    ws(buffer, bo,  32,  ''); bo +=  32; // gname field
    ws(buffer, bo,   8,  ''); bo +=   8; // devmajor field
    ws(buffer, bo,   8,  ''); bo +=   8; // devminor field
    ws(buffer, bo, 155,  ps); bo += 155; // prefix field
    ws(buffer, bo,  12,  ''); bo +=  12; // empty space

    // now compute the simple checksum of the entire header buffer.
    var sum    = 0;
    for (var i = 0; i < 512; ++i)
        sum   += buffer[i];

    // overwrite the space characters with the actual checksum data.
    wo(buffer, 148,  8, sum);
}

/// Constructs a tar archive file from the filesystem and writes it to disk.
/// @param args An object controlling the behavior of the tar process.
/// @param args.from The root path from which the archive will be created.
/// @param args.recursive Specify true to recurse into subdirectories. The
/// default value is true.
/// @param args.targetPath The path of the file to create.
function makeTar(args)
{
    var fd         = Filesystem.openSync(args.targetPath, 'w');
    var buffer     = new Buffer(512);
    var checkEntry = function (entry)
        {
            if (!entry.stat.isFile()) return;

            // serialize the header data to a buffer:
            tarWriteHeader(buffer, entry.relativePath, entry.stat);
            Filesystem.writeSync(fd, buffer, 0, 512);

            // now copy the source file, 512 bytes at a time.
            var num    = 1;
            var pos    = 0;
            var fdRd   = Filesystem.openSync(entry.absolutePath, 'r');
            while (num > 0)
            {
                buffer.fill(0, 0, 512); // fill the buffer with zero bytes
                num    = Filesystem.readSync(fdRd, buffer, 0, 512, pos);
                pos   += num;
                if (num) Filesystem.writeSync(fd, buffer, 0, 512);
            }
            Filesystem.closeSync(fdRd);
        };

    // synchronously walk the filesystem, creating
    // entries in the archive for each regular file.
    walkTree(checkEntry, {
        from           : args.from,
        recursive      : args.recursive,
        ignoreHidden   : true
    });

    // write the end-of-archive marker, consisting of
    // two 512-byte blocks filled with all zero bytes.
    buffer.fill(0, 0, 512);
    Filesystem.writeSync(fd, buffer, 0, 512);
    Filesystem.writeSync(fd, buffer, 0, 512);
    Filesystem.closeSync(fd);
}

/// Export symbols from the module.
module.exports.FSEntry             = FSEntry;
module.exports.FSDiffer            = FSDiffer;
module.exports.FSScanner           = FSScanner;
module.exports.FSWatcher           = FSWatcher;
module.exports.readTree            = readTree;
module.exports.makeTree            = makeTree;
module.exports.walkTree            = walkTree;
module.exports.isFile              = isFile;
module.exports.isDirectory         = isDirectory;
module.exports.makeTar             = makeTar;
module.exports.ensurePathSeparator = ensurePathSeparator;
module.exports.removePathSeparator = removePathSeparator;
