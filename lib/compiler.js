/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements the loading of data compiler processes, IPC
/// communications, and building of content.
///////////////////////////////////////////////////////////////////////////80*/
var Monitor  = require('./monitor');
var Events   = require('events');
var Path     = require('path');
var Util     = require('util');

/// Defines the various types of IPC messages between the CompilerCache and a
/// data compiler process. This enumeration must be kept in sync with the
/// corresponding version in the data compiler.
var ipc_message = {
    /// The CompilerCache is requesting the compiler name and version from the
    /// data compiler process.
    /// Data: none
    VERSION_QUERY  : 0,

    /// The data compiler process is passing compiler version information back
    /// to the requesting CompilerCache.
    /// Data: An object {
    ///     version     : Number
    /// }
    VERSION_DATA   : 1,

    /// The CompilerCache is requesting that a data compiler process a source
    /// file and generate corresponding target file(s).
    /// Data: An object {
    ///     sourcePath  : String,
    ///     targetPath  : String,
    ///     platform    : String
    /// }
    BUILD_REQUEST  : 2,

    /// The data compiler is reporting the results of a build operation back to
    /// the CompilerCache.
    /// Data: An object {
    ///     sourcePath  : String,
    ///     targetPath  : String,
    ///     platform    : String,
    ///     success     : Boolean,
    ///     errors      : Array of String (error and warning messages),
    ///     outputs     : Array of String (absolute paths of target files),
    ///     references  : Array of String (absolute paths of referenced files)
    /// }
    BUILD_RESULT   : 3
};

/// Constructor function for the JobQueue type, which provides a simple method
/// for queueing and executing some sort of user-defined task, where the thing
/// that does the work can only process a single request at a time.
/// @param name A string name to be associated with the queue.
/// @return The new JobQueue instance.
var JobQueue = function (name)
{
    if (!(this instanceof JobQueue))
    {
        return new JobQueue(name);
    }
    this.name    = name;
    this.jobList = [];
    return this;
};
Util.inherits(JobQueue, Events.EventEmitter);

/// Checks the queue status to determine whether the queue is empty.
/// @return true if the queue is empty.
JobQueue.prototype.isEmpty = function ()
{
    return (0 === this.jobList.length);
};

/// Retrieves the item at the front of the queue.
/// @return The task at the front of the job queue.
JobQueue.prototype.front = function ()
{
    return (0 !== this.jobList.length ? this.jobList[0] : null);
}

/// Enqueues a job. If the queue is currently empty, the job is executed
/// immediately.
/// @param job An object representing the job. The object may have any format.
JobQueue.prototype.submit = function (job)
{
    this.jobList.push(job);
    if (1 === this.jobList.length)
        this.emit('execute', job);
};

/// This method should be called when the most recently executed job has
/// completed, whether the job completed successfully or with an error. The
/// completed job is popped from the queue and the next job is started.
JobQueue.prototype.complete = function ()
{
    // pop the job off of the front of the queue.
    this.jobList.shift();
    if (this.jobList.length > 0)
        this.emit('execute', this.jobList[0]);
    else
        this.emit('drain', this);
};

/// Flushes all pending jobs from the queue.
JobQueue.prototype.flush = function ()
{
    this.jobList = [];
};

/// Constructor function for the CompilerCache type, which spawns data compiler
/// processes based on a pipeline definition file and handles the dispatching
/// of data compilation requests to them.
/// @return The new CompilerCache instance.
var CompilerCache = function ()
{
    if (!(this instanceof CompilerCache))
    {
        return new CompilerCache();
    }
    this.pathTable         = {}; // map compiler path to Monitor instance
    this.compilers         = {}; // map resource type to Monitor instance
    this.waitCount         = 0;
    this.childProcessCount = 0;
    return this;
};
Util.inherits(CompilerCache, Events.EventEmitter);

/// Evaluates a condition to determine whether all data compiler processes have
/// been spawned successfully.
/// @return true if all data compiler processes have been spawned.
CompilerCache.prototype.checkReadyStatus = function ()
{
    return (0 === this.waitCount);
};

/// Emits the 'ready' event to indicate that this CompilerCache instance is
/// ready for use.
CompilerCache.prototype.signalReady = function ()
{
    this.emit('ready', this);
};

/// Sends an IPC message to a data compiler process requesting its version.
/// @param compiler The Monitor instance representing the compiler.
CompilerCache.prototype.queryCompilerVersion = function (compiler)
{
    compiler.send({
        type : ipc_message.VERSION_QUERY,
        data : {}
    });
};

/// Callback invoked when a data compiler is ready to begin another compile
/// operation. When the data compiler completes, either successfully or with
/// an error, it sends an IPC message to its Monitor.
/// @param task Information about the compile task to execute.
CompilerCache.prototype.handleQueueExecute = function (task)
{
    this.emit('started', this, {
        input          : task.input,
        targetPath     : task.targetPath,
        compilerName   : task.compilerName
    });

    task.dataCompiler.send({
        type : ipc_message.BUILD_REQUEST,
        data : {
            sourcePath : task.input.sourcePath,
            targetPath : task.targetPath,
            platform   : task.input.platform
        }
    });
};

/// Callback invoked when a data compiler has completed all tasks.
/// @param queue The JobQueue that raised the event.
CompilerCache.prototype.handleQueueDrain = function (queue)
{
    /* empty */
};

/// Event handler invoked when a monitored child process has started
/// successfully for the first time. This event handler isn't called if a
/// child process is automatically restarted.
/// @param monitor The Monitor instance associated with the child process.
CompilerCache.prototype.handleMonitorStart = function (monitor)
{
    this.childProcessCount++;
    var name  = monitor.name;
    var queue = new JobQueue(name);
    queue.on('drain',   this.handleQueueDrain.bind(this));
    queue.on('execute', this.handleQueueExecute.bind(this));
    monitor.version   = 0;
    monitor.workQueue = queue;
    this.queryCompilerVersion(monitor);
    this.waitCount--;
    if (this.checkReadyStatus())
        this.signalReady();
}

/// Event handler invoked when a monitored child process cannot be started.
/// This event can occur on either the initial start, or a subsequent restart.
/// @param monitor The Monitor instance that raised the event.
/// @param error Information about the error that occurred.
CompilerCache.prototype.handleMonitorError = function (monitor, error)
{
    this.emit('error', this,  {
        resourceType : monitor.types[0],
        scriptPath   : monitor.scriptPath,
        error        : error
    });
}

/// Event handler invoked when a monitored child process is restarted.
/// @param monitor The Monitor instance that raised the event.
CompilerCache.prototype.handleMonitorRestart = function (monitor)
{
    /* empty */
}

/// Event handler invoked when a monitored child process sends the the parent
/// process (this process) an IPC message.
/// @param monitor The Monitor instance that raised the event.
/// @param message The message sent by the child process.
CompilerCache.prototype.handleMonitorMessage = function (monitor, message)
{
    var type = message.type || '';
    var data = message.data || {};
    switch (type)
    {
        case ipc_message.VERSION_DATA:
            {
                monitor.version = data.version || 1;
            }
            break;

        case ipc_message.BUILD_RESULT:
            {
                var queue = monitor.workQueue;
                var task  = queue.front();
                this.emit('complete', this, {
                    input           : task.input,
                    compilerName    : task.compilerName,
                    compilerVersion : monitor.version,
                    targetPath      : data.targetPath,
                    success         : data.success,
                    errors          : data.errors     || [],
                    outputs         : data.outputs    || [],
                    references      : data.references || []
                });
                queue.complete();
            }
            break;
    }
}

/// Event handler invoked when a monitored child process has terminated fully
/// and will not be restarted. This is typically due to a call to the function
/// Monitor.kill(false) to shut down the system.
/// @param monitor The monitor instance associated with the child process.
CompilerCache.prototype.handleMonitorExit = function (monitor)
{
    // a child process has terminated and will not be restarted.
    this.childProcessCount--;

    // clean up our various tables.
    var types  = monitor.types;
    for (var i = 0,  n = types.length; i < n; ++i)
        delete this.compilers[types[i]];
    delete this.pathTable[monitor.name];

    // if there are no child processes remaining, terminate this process.
    if (0 == this.childProcessCount)
    {
        this.emit('terminated', this);
    }
}

/// Constructs a string representing a monitor configuration instance. This
/// string may be used as a key to uniquely identify a process configuration
/// and prevent spawning of duplicate processes when the same compiler is used
/// by more than one resource type.
/// @param root The absolute path of the directory which all data compiler
/// paths are specified relative to.
/// @param config An object representing the Monitor configuration. See the
/// monitorCreateConfiguration() function.
/// @return A string uniquely identifying the monitor configuration.
CompilerCache.prototype.buildMonitorConfigKey = function (root, config)
{
    var path = Path.join(root, config.path);
    var args = config.arguments.join(' ');
    var cwd  = config.workingDirectory || Path.dirname(path);
    return [cwd, path, args].join(' ');
};

/// Launches and begins monitoring of processes for all data compilers in a
/// content pipeline configuration object.
/// @param processorRoot The absolute path of the directory which all data
/// compiler paths are specified relative to.
/// @param config An object representing the content pipeline definition. Keys
/// are strings representing resource types, and values are Monitor
/// configuration objects. See the monitorCreateConfiguration() function.
/// @return A reference to the CompilerCache.
CompilerCache.prototype.startup = function (processorRoot, config)
{
    var self = this;
    var keys = Object.keys(config || {});
    // each key in the table is the process name, and the value
    // is the configuration data for the associated Monitor.
    keys.forEach(
        function startup_SpawnChildProcess(key)
        {
            var mc      = config[key];
            var mck     = self.buildMonitorConfigKey(processorRoot, mc);
            var monitor = self.pathTable[mck];
            if (monitor)
            {
                // the monitor exists; no need to spawn another instance.
                self.compilers[key] = monitor;
                monitor.types.push(key);
            }
            else
            {
                // create a new monitor and start it to spawn the child process.
                // @note: Monitor emits events no earlier than the next tick so
                // it is safe to increment the waitCount in this function.
                mc.path             = Path.join(processorRoot, mc.path);
                monitor             = Monitor.createMonitor(mc);
                monitor.name        = mck;
                monitor.types       =[key];
                monitor.on('start',   self.handleMonitorStart.bind(self));
                monitor.on('error',   self.handleMonitorError.bind(self));
                monitor.on('message', self.handleMonitorMessage.bind(self));
                monitor.on('restart', self.handleMonitorRestart.bind(self));
                monitor.on('exit',    self.handleMonitorExit.bind(self));
                self.compilers[key] = monitor;
                self.pathTable[mck] = monitor;
                self.waitCount++;
                monitor.start();
            }
        });
    return this;
};

/// Terminates all data compiler processes. When all processes have terminated,
/// the CompilerCache emits a 'terminated' event.
/// @return A referebce to the CompilerCache.
CompilerCache.prototype.shutdown = function ()
{
    var self = this;
    // send a kill signal to each child process.
    Object.keys(this.pathTable).forEach(
        function shutdown_KillChildProcess(key)
        {
            var monitor = self.pathTable[key];
            monitor.kill(false); // don't allow restart.
        });
    // don't actually allow the process to exit until the last
    // child process has shut down, unless there are no children.
    if (0 == this.childProcessCount)
    {
        this.emit('terminated', this);
    }
};

/// Locates the compiler instance for a particular combination of resource type
/// and target platform.
/// @param resourceType The resource type identifier.
/// @param platformName The name of the target platform.
/// @return An object specifying information about the data compiler.
/// obj.compilerName The name of the data compiler.
/// obj.dataCompiler The Monitor instance representing the data compiler
/// process, or null if no data compiler is registered to handle the specified
/// resource type.
CompilerCache.prototype.findCompiler = function (resourceType, platformName)
{
    platformName = platformName || 'generic';
    var name1    = resourceType  + '.' + platformName;
    var name2    = resourceType;
    var dc       = this.compilers[name1];
    if (dc)
    {
        return { // return the platform-specific version.
            compilerName : name1,
            dataCompiler : dc
        };
    }
    else
    {
        return { // return the generic platform version.
            compilerName : name2,
            dataCompiler : this.compilers[name2]
        };
    }
};

/// Submits a source file to be built.
/// @param targetPath The absolute path and filename (excluding extension)
/// of the target file to generate. The data compiler may generate additional
/// files with the same name but different extensions.
/// @param input An object describing the source file.
/// @param input.sourcePath The absolute path of the source file to pass as
/// input to the data compiler.
/// @param input.platform The name of the target platform for the resource.
CompilerCache.prototype.build = function (targetPath, input)
{
    var type     = input.resourceType || '';
    var platform = input.platform     || '';
    var info     = this.findCompiler(type, platform);
    var compiler = info.dataCompiler;
    if (compiler)
    {
        // queue the job. if the work queue is empty, the job may start
        // immediately. a 'started' event is emitted when the job is started.
        var jobq = compiler.workQueue;
        jobq.submit({
            input          : input,
            targetPath     : targetPath,
            compilerName   : info.compilerName,
            dataCompiler   : info.dataCompiler
        });
    }
    else
    {
        // no data compiler for this source file, so we will skip it.
        this.emit('skipped', this, {
            input          : input,
            targetPath     : targetPath,
            reason         : 'No data compiler for resource type '+type
        });
    }
};

/// Creates a new CompilerCache optionally initialized with a content pipeline
/// definition. If a pipeline definition is supplied, all data compiler
/// processes are started in persistent mode.
/// @param pipelineDefinition An object representing the content pipeline
/// definition. Keys correspond to resource types, and values are Monitor
/// configuration objects describing where the data compiler is located.
/// @return A new CompilerCache instance.
function createCompilerCache(processorRoot, pipelineDefinition)
{
    var cache = new CompilerCache();
    if (pipelineDefinition)
    {
        // spawn all of the data compiler processes.
        cache.startup(processorRoot, pipelineDefinition);
    }
    return cache;
}

/// Export public symbols from the module.
module.exports.CompilerCache       = CompilerCache;
module.exports.createCompilerCache = createCompilerCache;
