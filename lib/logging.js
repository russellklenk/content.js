/*/////////////////////////////////////////////////////////////////////////////
/// @summary Defines a flexible logging mechanism for writing output to the
/// console and possible one or more files. Supports log rolling.
/// @author Russell Klenk (contact@russellklenk.com)
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem = require('fs');
var Assert     = require('assert');
var Util       = require('util');
var OS         = require('os');

/// @summary Global variable for tracking all of the named Log instances for
/// this process. This table is populated by @a loggerDefineLogInstance().
var LogTable   = {};

/// @summary A table used to access string names of months by month index from
/// a Date object.
var Months     = [
    'Jan', 'Feb', 'Mar',
    'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep',
    'Oct', 'Nov', 'Dec'
];

/// @summary A handy utility function that prevents having to write the same
/// obnoxious code everytime. The typical javascript '||' trick works for
/// strings, arrays and objects, but it doesn't work for booleans or integers.
/// @param value The value to test.
/// @param theDefault The value to return if @a value is undefined.
/// @return Either @a value or @a theDefault (if @a value is undefined.)
function defaultValue(value, theDefault)
{
    return (value !== undefined) ? value : theDefault;
}

/// @summary Pre-pends a leading zero to a number value less than 10.
/// @param n The number value to inspect.
/// @return The number value with a leading zero added, if the value of @a n
/// is less than 10.
function numberWithLeadingZero(n)
{
    if (n < 10) return '0' + n;
    else        return  n;
}

/// @summary Constructs a date and time value in based on either a user-
/// specified date and time, or the current date and time.
/// @param dt The Date value to convert to a syslog-formatted string.
/// @return The formatted date and time string.
function dateAndTime(dt)
{
    dt     = dt || new Date();
    var nz = numberWithLeadingZero;
    var h  = nz(dt.getHours());
    var m  = nz(dt.getMinutes());
    var s  = nz(dt.getSeconds());
    var mo = dt.getMonth();
    var dy = dt.getDate();
    if (dy < 10)  dy  = ' ' + dy;
    return Months[mo] + ' ' + dy + ' ' + h + ':' + m + ':' + s;
}

/// @summary Constructor function for the Logger class.
/// @param options An object specifying options for controlling the logging
/// configuration. See the loggerCreateConfiguration() function for a
/// prototype object initialized with the default values.
/// @return A reference to the new Log instance.
var Log = function (config)
{
    // ensure the constructor is being invoked on an instance of Log.
    if (!(this instanceof Log))
        return new Log(config);

    // copy configuration options into object-local properties:
    config                = config                || {};
    this.filesystemPath   = config.filesystemPath || 'default.log';
    this.enableStdout     = defaultValue(config.enableStdout,     true);
    this.enableStderr     = defaultValue(config.enableStderr,     true);
    this.enableFilesystem = defaultValue(config.enableFilesystem, false);
    this.maxFileSize      = defaultValue(config.maxFileSize,  16*1024*1024);
    this.maxFileCount     = defaultValue(config.maxFileCount, 0);
    this.times            = {}; // for profiling

    // define filesystem-related properties:
    this.fd               = null;
    this.isStopped        = true;
    this.updateInterval   = 60 * 1000;
    this.updateIntervalId = 0;
    return this;
}

/// @summary Outputs a pre-formatted string to stdout.
/// @param msg The formatted message to be written to stdout.
/// @return The Log.
Log.prototype.outputStdout = function (msg)
{
    process.stdout.write(msg);
    return this;
}

/// @summary Outputs a pre-formatted string to stderr.
/// @param msg The formatted message to be written to stderr.
/// @return The Log.
Log.prototype.outputStderr = function (msg)
{
    process.stderr.write(msg);
    return this;
}

/// @summary Outputs a pre-formatted string to the current log file.
/// @param msg The formatted message to be written to the log file.
/// @return The Log.
Log.prototype.outputFilesystem = function (msg)
{
    if (this.isStopped ) return this;
    if (this.fd == null) this.fd = Filesystem.openSync(this.filesystemPath,'a');
    if (this.fd != null)
    {
        var data = new Buffer(msg);
        Filesystem.writeSync(this.fd, data, 0, data.length, null);
    }
    return this;
}

/// @summary Examines the file size of the current log file and rolls the log
/// over into a new file if necessary. This function is called repeatedly on an
/// interval configured in the Log.start() function.
Log.prototype.roll = function ()
{
    var self = this;
    // don't do anything if filesystem output isn't enabled.
    if (!self.enableFilesystem || self.isStopped) return;
    // retrieve the file size for the current log file.
    Filesystem.stat(self.filesystemPath, function (err, stats)
        {
            if (err) return;
            if (stats.size > self.maxFileSize)
            {
                // rename all of the existing rolled files:
                for (var i = self.maxFileCount; i > 1; --i)
                {
                    try
                    {
                        Filesystem.renameSync(
                            self.filesystemPath + '.' + (i - 1),
                            self.filesystemPath + '.' + (i));
                    }
                    catch (error) { /* empty */ }
                }
                // close the current file:
                if (self.fd != null)
                {
                    Filesystem.closeSync(self.fd);
                    self.fd  = null;
                }
                // rename the current file:
                Filesystem.renameSync(
                    self.filesystemPath,
                    self.filesystemPath + '.1');
            }
        });
}

/// @summary Starts the log rolling process for filesystem logging.
/// @param updateInterval The minimum amount of time that should elapse before
/// the current size of the log file is checked and log rolling is performed,
/// specified in milliseconds. The default value is to check every 60 seconds.
/// @param timeInterval The minimum amount of time that should elapse before
/// printing the current time to the log, specified in milliseconds. The
/// default value is to output the current time every 60 seconds.
/// @return The Log.
Log.prototype.start = function (updateInterval, timeInterval)
{
    if (this.isStopped && this.enableFilesystem)
    {
        // the logger is starting up:
        this.isStopped        = false;
        // set the update interval to the caller-supplied value.
        // default to updating once every 60 seconds.
        this.updateInterval   = updateInterval || 60 * 1000;
        // roll the log file once initially, and then check
        // it's current size and roll again periodically:
        this.roll();
        this.updateIntervalId = setInterval(
            this.roll.bind(this),
            this.updateInterval);
    }
    return this;
}

/// @summary Stops the log rolling process for filesystem logging and prevents
/// any output from being written to the log file(s).
/// @return The Log.
Log.prototype.stop = function ()
{
    // prevent data from being written to the log file.
    this.isStopped = true;
    // prevent future invocations of the update callback.
    // any active invocation will complete before returning.
    if (this.updateIntervalId)
    {
        clearInterval(this.updateIntervalId);
        this.updateIntervalId = 0;
    }
    // close the current file, synchronously.
    if (this.fd)
    {
        Filesystem.closeSync(this.fd);
        this.fd = null;
    }
}

/// @summary Prepends a date and timestamp value to a log message.
/// @param msg The formatted log message.
/// @return The formatted log message @a msg with date and time prepended.
Log.prototype.dt = function (msg)
{
    return '['+dateAndTime()+'] '+msg;
}

/// @summary Outputs a log message to enabled log endpoints. The output is
/// tagged with '#notice'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.log = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #notice\n');
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs a log message to enabled log endpoints. The output is
/// tagged with '#notice'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.notice = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #notice\n');
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs an informational message to enabled log endpoints. The
/// output is tagged with '#info'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.info = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #info\n');
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs a debug message to enabled log endpoints. The output is
/// tagged with '#debug'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.debug = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #debug\n');
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs a warning message to enabled log endpoints. The output is
/// tagged with '#warn'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.warn = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #warn\n');
    if (this.enableStdout)     this.outputStderr(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs an error message to enabled log endpoints. The output is
/// tagged with '#error'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.error = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #error\n');
    if (this.enableStdout)     this.outputStderr(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs a critical error message to enabled log endpoints. The
/// output is tagged with both '#error' and '#crit'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.critical = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #error #crit\n');
    if (this.enableStdout)     this.outputStderr(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs an alert message to enabled log endpoints. The output is
/// tagged with both '#error' and '#alert'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.alert = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #error #alert\n');
    if (this.enableStdout)     this.outputStderr(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs an emergency message to enabled log endpoints. The output
/// is tagged with both '#error' and '#emerg'.
/// @param format The printf-style format string. See the documentation at:
/// http://nodejs.org/docs/latest/api/util.html#util_util_format_format
/// @param varargs A variable-length argument list to be substituted into the
/// format string.
/// @return The Log.
Log.prototype.emergency = function ()
{
    var msg  = this.dt(Util.format.apply(this, arguments)+' #error #emerg\n');
    if (this.enableStdout)     this.outputStderr(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs the contents of an object to enabled log endpoints.
/// @param obj The object to inspect and dump.
/// @return The Log.
Log.prototype.dir = function (obj)
{
    var msg  = Util.inspect(obj)+' #debug\n';
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Captures the current time and stores in in an array associated
/// with a specified label. Call the timeEnd() function with the same label to
/// generate a profiling trace.
/// @param label A label to be associated with the timing snapshot.
/// @return The Log.
Log.prototype.time = function (label)
{
    this.times[label] = Date.now();
    return this;
}

/// @summary Captures the time elapsed between this call and a prior call to
/// the time() function, and outputs the time (in milliseconds) to enabled log
/// endpoints. Output is tagged with '#profile'.
/// @param label The label previously specified to the time() function.
/// @return The Log.
Log.prototype.timeEnd = function (label)
{
    var  time = this.times[label];
    if (!time)  throw new Error('Undefined label \''+label+'\'.');
    var  dt   = Date.now() - time;
    var  msg  = Util.format('Time for \'%s\': %dms #profile\n', label, dt);
    delete this.times[label];
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Generates a stack trace and outputs it to enabled log endpoints.
/// Output is tagged with '#debug'.
/// @param label An optional label to be associated with the trace output. If
/// not specified, the label defaults to an empty string.
/// @return The Log.
Log.prototype.trace = function (label)
{
    var err     = new Error();
    err.name    = 'Trace';
    err.message = label || '';
    Error.captureStackTrace(err, arguments.callee);
    var msg     = err.stack+' #debug\n';
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs system statistics to the enabled log endpoints. Information
/// gathered includes the hostname, platform, memory information, uptime in
/// seconds, and average system load factors. Output is tagged with '#profile'.
/// @return The Log.
Log.prototype.stats = function ()
{
    var la  = OS.loadavg();
    var hi  = OS.hostname();
    var pi  = OS.type()+' '+OS.release()+ ' '+OS.arch();
    var mi  = OS.totalmem()+'/'+OS.freemem();
    var ui  = OS.uptime();
    var li  = la[0]+ ', '+ la[1]+ ', ' + la[2];
    var msg = hi   + ' ' + pi   + ' '  + mi + ' '  + ui  + ' ' + li + ' #profile\n';
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Outputs the current time, in standard syslog format, to the enabled
/// log endpoints. Output is tagged with '#time'.
/// @return The Log.
Log.prototype.currentTime = function ()
{
    var msg  = this.dt(' #time\n');
    if (this.enableStdout)     this.outputStdout(msg);
    if (this.enableFilesystem) this.outputFilesystem(msg);
    return this;
}

/// @summary Create a new object initialized with the default configuration
/// options. This function is exposed publicly as createConfiguration().
/// @return A template object used to specify options used to configure a
/// Log instance. The object is initialized with default values.
function logCreateConfiguration(name)
{
    name = name || 'default';
    return {
        enableStdout     : true,
        enableStderr     : true,
        enableFilesystem : false,
        filesystemPath   : name + '.log',
        maxFileSize      : 16 * 1024 * 1024, /* 16MB */
        maxFileCount     : 4
    };
}

/// @summary Create a new Log instance initialized with the specified
/// configuration data.
/// @param config Configuration options for the Log instance. See the function
/// @a logCreateConfiguration() for a template.
/// @return A new Log instance.
function logCreateLogInstance(config)
{
    return new Log(config);
}

/// @summary Define a shared log instance associated with a particular name. If
/// the Log does not exist, it is created. If the name is currently in use, the
/// existing Log instance is returned.
/// @param name The name of the Log instance to retrieve or create.
/// @param config Configuration options for the Log instance. See the function
/// logCreateConfiguration() for a template. This parameter is used only if
/// the Log instance does not currently exist.
/// @return A reference to the named Log instance.
function logDefineLogInstance(name, config)
{
    name    = name   || 'default';
    config  = config || logCreateConfiguration(name);
    var log = LogTable[name];
    if (log)  return log;
    log = new Log(config);
    LogTable[name] = log;
    return log;
}

/// @summary Deletes an existing log instance associated with a particular name.
/// @param name The name of the Log instance to delete.
function logDeleteLogInstance(name)
{
    name    = name || 'default';
    var log = LogTable[name];
    if (log)
    {
        log.stop();
        delete LogTable[name];
    }
}

/// @summary Deletes all existing named Log instances and resets the global
/// Log table.
function logClearLogInstances()
{
    for (var name in LogTable)
    {
        var log  = LogTable[name];
        if (typeof log !== 'function')
        {
            log.stop();
        }
    }
    LogTable = {};
}

/// Set the functions exported by the module.
module.exports.createConfiguration = logCreateConfiguration;
module.exports.createLog           = logCreateLogInstance;
module.exports.defineLog           = logDefineLogInstance;
module.exports.deleteLog           = logDeleteLogInstance;
module.exports.deleteAllLogs       = logClearLogInstances;
module.exports.Log                 = Log;
