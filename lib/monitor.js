/*/////////////////////////////////////////////////////////////////////////////
/// @summary Defines a lightweight object that can spawn and monitor processes,
/// restarting them automatically if they crash.
///////////////////////////////////////////////////////////////////////////80*/
var ChildProcess = require('child_process');
var Events       = require('events');
var Util         = require('util');

/// A handy utility function that prevents having to write the same obnoxious
/// code everytime. The typical javascript '||' trick works for strings,
/// arrays and objects, but it doesn't work for booleans or integers.
/// @param value The value to test.
/// @param theDefault The value to return if @a value is undefined.
/// @return Either @a value or @a theDefault (if @a value is undefined.)
function defaultValue(value, theDefault)
{
    return (value !== undefined) ? value : theDefault;
}

/// Constructor function for a Monitor object, which executes a script as a
/// child process and restarts it if it fails.
///
/// @param script The path of the script to load and execute.
/// @param config An object specifying monitoring options. See the function
/// monitorCreateConfiguration() for a prototype.
/// @return a new instance of the Monitor object.
var Monitor = function (config)
{
    if (!(this instanceof Monitor))
    {
        return new Monitor(script, options);
    }

    // initialize class members based on passed-in option values:
    this.scriptPath        = config.path;
    this.workingDirectory  = config.workingDirectory || process.cwd();
    this.scriptArguments   = config.arguments        || [];
    this.extraEnvironment  = config.extraEnvironment || {};
    this.hiddenEnvironment = config.hideEnvironment  || [];
    this.maxRestartCount   = defaultValue(config.maxRestartCount, 0);
    this.suppressStdio     = defaultValue(config.suppressStdio,   false);
    this.scriptEnvironment = this.makeEnvironment(
                                this.extraEnvironment,
                                this.hiddenEnvironment);
    this.isRunning         = false;
    this.forceExit         = false;
    this.canSendIPC        = false;
    this.childPid          = 0;
    this.childProcess      = null;
    this.lastStartTime     = Date.now();
    return this;
}
Util.inherits(Monitor, Events.EventEmitter);

/// Builds an object whose key-value pairs represent a given environment
/// configuration. The caller can hide environment information exposed by the
/// process environment, as well as add new key-value pairs.
/// @param xtraEnv An object whose key-value pairs represent environment
/// variables to be added to the process environment variables.
/// @param hideEnv An array of process environment variables to suppress from
/// the new environment configuration.
/// @return An object whose key-value pairs represent the desired environment.
Monitor.prototype.makeEnvironment = function (xtraEnv, hideEnv)
{
    var merged = {};
    var hidden = {};
    hideEnv    = hideEnv || [];
    xtraEnv    = xtraEnv || {};

    // build an object containing hidden environment keys.
    // this lets us look up hidden environment by key name.
    hideEnv.forEach(function (key)
        {
            hidden[key] = true;
        });
    // first, add in the environment from the parent process.
    Object.keys(process.env).forEach(function (key)
        {
            if (!hidden[key]) merged[key] = process.env[key];
        });
    // now, add in any extra environment specified by the caller.
    Object.keys(xtraEnv).forEach(function (key)
        {
            merged[key] = xtraEnv[key];
        });
    // return the merged environment configuration:
    return merged;
}

/// Event handler invoked when an IPC message is received from the child
/// process. The message object is re-emitted as a 'message' event on the
/// Monitor instance.
/// @param msg The deserialized IPC message received from the child process.
Monitor.prototype.onChildMessage = function (msg)
{
    // child process has sent an IPC message.
    // emit an event with the message (on the same process tick.)
    this.emit('message', this, msg);
}

/// Event handler invoked when the child process has exited. The monitor will
/// either let the child process die completely, or it will attempt to restart
/// the child process, depending on whether Monitor.kill() was called with the
/// allowRestart value set to false or true. If the child process exits for
/// some reason (it crashed) it is restarted.
/// @param code The exit code (Number) of the child process, if it exited
/// normally; otherwise, null.
/// @param signal The name (String) of the signal that caused the process to
/// terminate, if any; otherwise, null.
Monitor.prototype.onChildExit = function (code, signal)
{
    if (this.forceExit)
    {
        // let the child process die.
        var self        = this;
        this.isRunning  = false;
        this.forceExit  = false;
        this.canSendIPC = false;
        this.childProcess.removeAllListeners();
        process.nextTick( function letChildProcessDie()
            {
                self.emit('exit', self);
            });
    }
    else
    {
        // restart the child process on the next tick.
        var self        = this;
        this.isRunning  = false;
        this.forceExit  = false;
        this.canSendIPC = false;
        this.childProcess.removeAllListeners();
        process.nextTick( function restartChildProcess()
            {
                self.start(true);
            });
    }
}

/// Event handler invoked when the IPC channel to the child process has been
/// connected or disconnected.
Monitor.prototype.onChildDisconnect = function ()
{
    if (this.childProcess)
    {
        this.canSendIPC = this.childProcess.connected;
    }
}

/// Starts (or restarts) the child process. If the child process is already
/// running, the function returns immediately and no events are raised. Emits
/// either the 'start' or 'restart' event, each of which specify the Monitor
/// instance that started the child process. An 'error' event is emitted if
/// the child process cannot be started. All events are emitted on the next
/// tick of the event loop.
/// @param isRestart A value indicating whether the child process is being
/// restarted. If unspecified, this value defaults to false. If this value is
/// false, the startCount for the Monitor instance is reset to zero.
Monitor.prototype.start = function (isRestart)
{
    var self  = this;
    var cproc = null;
    var cpath = this.scriptPath;
    var cargs = this.scriptArguments;
    isRestart = defaultValue(isRestart, false);

    if (this.isRunning || this.forceExit)
    {
        // the child process is already running, or we should not
        // (re) start it because the forceExit flag has been set.
        return;
    }
    if (isRestart == false)
    {
        // this isn't a restart attempt, so reset the start count.
        this.startCount = 0;
    }
    if (isRestart                 &&
        this.maxRestartCount >  0 &&
        this.startCount      >= this.maxRestartCount)
    {
        // we've exceeded the maximum number of restart attempts.
        this.emit('exit', this);
        return;
    }
    try
    {
        // attempt to spawn the child process.
        cproc = ChildProcess.fork(cpath, cargs, {
            cwd    : this.workingDirectory,
            env    : this.scriptEnvironment,
            silent : this.suppressStdio
        });
    }
    catch (err)
    {
        // an error occurred; most likely, the script doesn't exist.
        // emit the error on the next tick so the caller can attach
        // an event handler for the 'error' event.
        process.nextTick(function errorSpawningChildProcess ()
            {
                self.emit('error', self, err);
            });
    }

    // the child process has started successfully.
    this.lastStartTime = Date.now();
    this.childPid      = cproc.pid;
    this.childProcess  = cproc;
    this.isRunning     = true;
    this.canSendIPC    = true;
    this.startCount++;

    // hook the critical events from the child process.
    cproc.on('exit',       this.onChildExit.bind(this));
    cproc.on('message',    this.onChildMessage.bind(this));
    cproc.on('disconnect', this.onChildDisconnect.bind(this));

    // notify any interested parties that the process has started
    // successfully. emit the event on the next tick so the caller
    // can attach an event handler for the 'start' event.
    if (isRestart)
    {
        process.nextTick(function processRestarted ()
            {
                self.emit('restart', self);
            });
    }
    else
    {
        process.nextTick(function processStarted ()
            {
                self.emit('start', self);
            });
    }
}

/// Signals the child process to exit, allowing the caller to specify whether
/// or not to allow the process to automatically restart. Emits the 'stop'
/// event on the current event loop tick. The 'exit' event is not emitted until
/// the child process has fully terminated.
/// @param allowRestart Specify true to allow the child process to be restarted
/// automatically. Specify false to prevent the child process from restarting.
/// If unspecified, this value defaults to true (allow child process restart.)
Monitor.prototype.kill = function (allowRestart)
{
    if (!this.childProcess || !this.isRunning)
    {
        // the child process isn't running; don't do anything.
        return;
    }
    // prevent the process from restarting, if requested.
    allowRestart    = defaultValue(allowRestart, true);
    this.forceExit  = allowRestart ? false : true;
    // detach our IPC message forwarder and close the IPC channel.
    this.childProcess.disconnect();
    this.childProcess.removeListener('message',    this.onChildMessage);
    this.childProcess.removeListener('disconnect', this.onChildDisconnect);
    this.childProcess.kill('SIGTERM');
    this.canSendIPC = false;
    this.emit('stop', this);
}

/// Sends a message to the child process via the built-in IPC mechanism. See
/// the documentation for ChildProcess.send(message, [sendHandle]).
/// @param message The message object to send to the child process.
/// @param sendHandle An optional object that can be used to pass handles to
/// the child process (for example a TCP server or Socket instance.)
Monitor.prototype.send = function (message, sendHandle)
{
    if (this.canSendIPC)
    {
        this.childProcess.send(message, sendHandle);
    }
}

/// Create a new object initialized with the default configuration options.
/// This function is exposed publicly as the createConfiguration() function.
/// @return A template object used to specify options used to configure a
/// Monitor instance. The object is initialized with default values.
function monitorCreateConfiguration()
{
    return {
        path             : '',
        workingDirectory : '',
        arguments        : [],
        hideEnvironment  : [],
        extraEnvironment : {},
        maxRestartCount  : 0,
        suppressStdio    : false,
    };
}

/// Create a new Monitor instance initialized with the specified configuration.
/// @param config Configuration options for the Monitor instance. See the
/// function monitorCreateConfiguration() for a template.
/// @return A new Monitor instance.
function monitorCreateInstance(config)
{
    return new Monitor(config);
}

/// Set the functions exported by the module.
module.exports.createConfiguration = monitorCreateConfiguration;
module.exports.createMonitor       = monitorCreateInstance;
module.exports.Monitor             = Monitor;
