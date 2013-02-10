#! /usr/bin/env node
/*/////////////////////////////////////////////////////////////////////////////
/// @summary This command-line utility implements a set of JSON web services
/// providing a web interface to the build and publish functionality of
/// content.js. Three HTTP servers are provided; one for serving static web
/// content, one for serving content manifests and resource package files, and
/// one for processing control directives from the game.
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem  = require('fs');
var Url         = require('url');
var HTTP        = require('http');
var MIME        = require('mime');
var Path        = require('path');
var Process     = require('child_process');
var Commander   = require('commander');
var ContentJS   = require('../index');

/// Constants representing the various application exit codes.
var exit_code   = {
    /// The program has exited successfully.
    SUCCESS           : 0,
    /// The program has exited with an unknown error.
    ERROR             : 1
};

/// Default application configuration values.
var defaults    = {
    /// The name of the server configuration file.
    CONFIG_FILENAME   : 'serve.json',
    /// The name of the default publish target.
    PUBLISH_TARGET    : 'dev',
    /// The name of the static web content directory, relative to project root.
    WEB_PATH          : 'web',
    /// The name of the default staging directory, relative to project root.
    STAGING_PATH      : 'staging',
    /// The name of the default publish directory, relative to project root.
    PUBLISH_PATH      : 'publish',
    /// The port number on which the static web content server listens.
    STATIC_PORT       : 55365,
    /// The port number on which the game content server listens.
    CONTENT_PORT      : 55366,
    /// The port number on which the command and control server listens.
    CONTROL_PORT      : 55367
};

/// Constants and global values used throughout the application module.
var application = {
    /// The name of the application module.
    NAME              : 'serve',
    /// The path from which the application was started.
    STARTUP_DIRECTORY : process.cwd(),
    /// An object defining the pre-digested command-line arguments passed to
    /// the application, not including the node or script name values.
    args              : {},
    /// An object mapping resource URLs to objects representing their state.
    builds            : {},
    /// The ID of an interval timer used to prune expired requests.
    pruneTimer        : -1,
    /// The application exit code.
    exitCode          : exit_code.SUCCESS
};

/// Constants representing the state of a pending build request.
var build_state = {
    /// The build is in-progress. Either build or publish is executing.
    STARTED           : 0,
    /// The build has completed successfully.
    SUCCESS           : 1,
    /// The build has completed with one or more errors.
    ERROR             : 2
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
    var appConfig               = {};
    var staticConfig            = {};
    var controlConfig           = {};
    var defaultPath             = application.STARTUP_DIRECTORY;
    var stagingPath             = defaults.STAGING_PATH;
    var publishPath             = defaults.PUBLISH_PATH;
    var webContentPath          = defaults.WEB_PATH;
    staticConfig.staticPort     = defaults.STATIC_PORT;
    staticConfig.contentPort    = defaults.CONTENT_PORT;
    staticConfig.webRoot        = Path.join(defaultPath, webContentPath);
    controlConfig.stagingRoot   = Path.join(defaultPath, stagingPath);
    controlConfig.publishRoot   = Path.join(defaultPath, publishPath);
    controlConfig.publishTarget = defaults.PUBLISH_TARGET;
    controlConfig.controlPort   = defaults.CONTROL_PORT;
    appConfig.staticConfig      = staticConfig;
    appConfig.controlConfig     = controlConfig;
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
        .option('-p, --project [path]', 'Path of the project to serve. [cwd]', String, process.cwd())
        .option('-C, --save-config',    'Save the current publish configuration.')
        .parse(process.argv);

    var projectPath   = Path.resolve(Commander.project);
    var projectName   = Path.basename(projectPath);
    var configPath    = Path.join(projectPath, defaults.CONFIG_FILENAME);
    var configData    = loadConfiguration(configPath, Commander.silent);
    var staticConfig  = configData.staticConfig;
    var controlConfig = configData.controlConfig;
    var publishTarget = controlConfig.publishTarget;
    var publishRoot   = controlConfig.publishRoot;
    var stagingRoot   = controlConfig.stagingRoot;
    var webRoot       = staticConfig.webRoot;

    // if no server configuration exists, always save out the
    // serve.json file containing the current configuration.
    if (!ContentJS.isFile(configPath))
    {
        Commander.saveConfig = true;
    }

    // resolve any relative paths to absolute paths:
    staticConfig.webRoot      = Path.resolve(projectPath, webRoot);
    controlConfig.publishRoot = Path.resolve(projectPath, publishRoot);
    controlConfig.stagingRoot = Path.resolve(projectPath, stagingRoot);
    publishRoot               = controlConfig.publishRoot;
    stagingRoot               = controlConfig.stagingRoot;
    webRoot                   = staticConfig.webRoot;

    // ensure that required directories exist.
    var targetPath  = Path.join(publishRoot, projectName, publishTarget);
    try
    {
        ContentJS.makeTree(targetPath);
        ContentJS.makeTree(webRoot);
    }
    catch (error)
    {
        programError(exit_code.ERROR, error);
    }

    // save out the current configuration if instructed to do so.
    if (Commander.saveConfig)
    {
        saveConfiguration(configData, configPath, Commander.silent);
    }

    // return an object containing our final configuration options:
    return {
        silent        : Commander.silent,
        staticPort    : staticConfig.staticPort,
        contentPort   : staticConfig.contentPort,
        controlPort   : controlConfig.controlPort,
        staticRoot    : webRoot,
        contentRoot   : targetPath,
        publishRoot   : publishRoot,
        stagingRoot   : stagingRoot,
        projectPath   : projectPath,
        projectName   : projectName,
        publishTarget : publishTarget
    };
}

/// Registers custom MIME types with the mime module.
function registerMimeTypes()
{
    MIME.define({
        'text/json'                : ['manifest'],
        'application/octet-stream' : ['package']
    });
}

/// Creates an object representing the state associated with a build request.
/// @return An object representing the state associated with the build request.
/// obj.state One of the values of the build_state enumeration.
/// obj.resource The resource URL used by clients to poll for build status.
/// obj.listeners An array of HTTP response objects representing the clients
/// waiting for the status of the build.
/// obj.exitBuild The exit code of the content.js build process.
/// obj.exitPublish The exit code of the content.js publish process.
/// obj.stdoutBuild A string specifying the data written to stdout by the
/// content.js build process.
/// obj.stderrBuild A string specifying the data written to stderr by the
/// content.js build process.
/// obj.stdoutPublish A string specifying the data written to stdout by the
/// content.js publish process.
/// obj.stderrPublish A string specifying the data written to stderr by the
/// content.js publish process.
/// obj.startTime A timestamp the time the build was started.
/// obj.finishTime A timestamp specifying the time the build was completed.
/// obj.expireTime A timestamp specifying the time the build results expire.
function createBuildRequest()
{
    var now           = Date.now();
    return {
        state         : build_state.STARTED,   // request state
        resource      : '/build/'+now,         // long poll resource URL
        listeners     : [],                    // array of HTTP response
        exitBuild     : exit_code.SUCCESS,     // exit code of build process
        exitPublish   : exit_code.SUCCESS,     // exit code of publish process
        stdoutBuild   : '',                    // stdout from build process
        stderrBuild   : '',                    // stderr from build process
        stdoutPublish : '',                    // stdout from publish process
        stderrPublish : '',                    // stderr from publish process
        startTime     : now,                   // Date/time request received
        finishTime    : now,                   // Date/time build finished
        expireTime    : now                    // Date/time request expires
    };
}

/// Determines whether any build request is outstanding and if so, returns it.
/// @return An object representing the outstanding build request, or undefined.
function outstandingRequest()
{
    var STARTED = build_state.STARTED;
    var builds  = application.builds;
    var keys    = Object.keys(builds);
    for (var i  = 0, n = keys.length; i < n; ++i)
    {
        var req = builds[keys[i]];
        if (req.state === STARTED)
            return req;
    }
}

/// Callback invoked on a fixed interface to free resources associated with
/// any expired build requests.
function pruneExpiredRequests()
{
    var STARTED = build_state.STARTED;
    var builds  = application.builds;
    Object.keys(builds).forEach(function (key)
        {
            var req         = builds[key];
            if (req.state !== STARTED)
            {
                if (Date.now() >= req.expireTime)
                {
                    req.listeners     = null;
                    req.stdoutBuild   = null;
                    req.stderrBuild   = null;
                    req.stdoutPublish = null;
                    req.stderrPublish = null;
                    delete application.builds[key];
                }
            }
        });
}

/// Completes a request by writing the response back to any registered
/// listeners and closing each outstanding listener's HTTP request.
/// @param request The build request being completed.
function completeRequest(request)
{
    var success = (request.exitBuild === 0 && request.exitPublish === 0);
    var now     =  Date.now();
    var exp     =  now + (15 * 60 * 1000); // now + 15 minutes
    var res     =  {
        project        :  application.args.projectName,
        success        :  success,
        buildStdout    :  request.stdoutBuild   || '',
        buildStderr    :  request.stderrBuild   || '',
        publishStdout  :  request.stdoutPublish || '',
        publishStderr  :  request.stderrPublish || ''
    };
    var json    = JSON.stringify(res);
    var polls   = request.listeners;
    for (var i  = polls.length - 1; i >= 0; --i)
    {
        var rsp = polls[i];
        rsp.writeHead(200, {
            'Content-Type' : 'text/json',
            'Access-Control-Allow-Origin': '*'
        });
        rsp.end(json);
    }

    if (success)  request.state = build_state.SUCCESS;
    else          request.state = build_state.ERROR;
    request.expireTime          = exp;
    request.listeners           = [];
}

/// Spawns a child process to build the project. The build executes
/// asynchronously and the state of the current build is updated when the
/// process exits based on the process exit code.
/// @param request An object representing the build request.
function executeBuild(request)
{
    var child      = null;
    var nodePath   = process.execPath;
    var scriptPath = Path.join(__dirname, 'build.js');
    var argv2      = '-p ' + application.args.projectPath;
    var argv       = [nodePath, scriptPath, argv2];
    var command    = argv.join(' ');
    var onComplete = function (error, stdout, stderr)
        {
            if (error) request.exitBuild = error.code;
            request.stdoutBuild   = stdout.toString('utf8');
            request.stderrBuild   = stderr.toString('utf8');
            if (error) completeRequest(request);
            else       executePublish(request);
        };

    try
    {
        child = Process.exec(command, {
            cwd      : application.STARTUP_DIRECTORY,
            env      : process.env,
            encoding : 'utf8'
        },  onComplete);
    }
    catch (err)
    {
        if (!application.args.silent)
        {
            console.log('An error occurred when spawning the build process:');
            console.log(err);
            console.log();
        }
    }
}

/// Spawns a child process to publish the project. The publish process executes
/// asynchronously and the state of the current build is updated when the
/// process exits based on the process exit code.
/// @param request An object representing the build request.
function executePublish(request)
{
    var child      = null;
    var nodePath   = process.execPath;
    var scriptPath = Path.join(__dirname, 'publish.js');
    var argv2      = '-p ' + application.args.projectPath;
    var argv3      = '-S ' + application.args.stagingRoot;
    var argv4      = '-O ' + application.args.publishRoot;
    var argv5      = '-T ' + application.args.publishTarget;
    var argv       = [nodePath, scriptPath, argv2, argv3, argv4, argv5];
    var command    = argv.join(' ');
    var onComplete = function (error, stdout, stderr)
        {
            if (error) request.exitPublish = error.code;
            request.stdoutPublish = stdout.toString('utf8');
            request.stderrPublish = stderr.toString('utf8');
            completeRequest(request);
        };

    try
    {
        child = Process.exec(command, {
            cwd      : application.STARTUP_DIRECTORY,
            env      : process.env,
            encoding : 'utf8'
        },  onComplete);
    }
    catch (err)
    {
        if (!application.args.silent)
        {
            console.log('An error occurred when spawning the publish process:');
            console.log(err);
            console.log();
        }
    }
}

/// Spawns the HTTP server responsible for serving static web content.
function spawnStaticServer()
{
    HTTP.createServer(function (req, res)
    {
        var uri      = Url.parse(req.url).pathname;
        var filename = Path.join(application.args.staticRoot, uri);
        var mimeType = MIME.lookup(filename);
        Filesystem.exists(filename, function(exists)
        {
            if(!exists)
            {
                res.writeHead(404, {
                    'Content-Type' : 'text/plain'
                });
                res.write('404 Not Found\n');
                res.end();
                return;
            }
            else
            {
                res.writeHead(200, {
                    'Content-Type' : mimeType
                });
                Filesystem.createReadStream(filename).pipe(res);
            }
        });
    }).listen(application.args.staticPort);

    if (!application.args.silent)
    {
        var url   = 'http://localhost:' + application.args.staticPort;
        var path  = application.args.contentRoot;
        console.log('Started static file server:');
        console.log('  URL:  '+url);
        console.log('  Path: '+path);
        console.log();
    }
}

/// Spawns the HTTP server responsible for serving content manifest and
/// resource package files representing the build output.
function spawnContentServer()
{
    HTTP.createServer(function (req, res)
    {
        var uri      = Url.parse(req.url).pathname;
        var filename = Path.join(application.args.contentRoot, uri);
        var mimeType = MIME.lookup(filename);
        Filesystem.exists(filename, function(exists)
        {
            if(!exists)
            {
                res.writeHead(404, {
                    'Content-Type' : 'text/plain'
                });
                res.write('404 Not Found\n');
                res.end();
                return;
            }
            else
            {
                res.writeHead(200, {
                    'Content-Type' : mimeType,
                    'Access-Control-Allow-Origin': '*'
                });
                Filesystem.createReadStream(filename).pipe(res);
            }
        });
    }).listen(application.args.contentPort);

    if (!application.args.silent)
    {
        var url   = 'http://localhost:' + application.args.contentPort;
        var path  = application.args.contentRoot;
        console.log('Started content file server:');
        console.log('  URL:  '+url);
        console.log('  Path: '+path);
        console.log();
    }
}

/// Spawns the HTTP server responsible for handling control requests.
function spawnControlServer()
{
    HTTP.createServer(function (req, res)
    {
        if ('POST' === req.method && '/rebuild' === req.url)
        {
            var request   = outstandingRequest();
            if (request === undefined)
            {
                request   = createBuildRequest();
                application.builds[request.resource] = request;
                executeBuild(request);
            }
            // return the resource URL to the requestor.
            res.writeHead(200, {
                'Content-Type' : 'text/plain',
                'Access-Control-Allow-Origin' : '*'
            });
            res.end(request.resource);
            return;
        }
        if ('GET'  === req.method)
        {
            var request = application.builds[req.url];
            if (request)
            {
                request.listeners.push(res);
                if (request.state !== build_state.STARTED)
                    completeRequest(request);
            }
            else
            {
                res.writeHead(404, {
                    'Content-Type' : 'text/plain',
                    'Access-Control-Allow-Origin' : '*'
                });
                res.end('Unknown resource '+req.url+'. It may have expired.');
            }
        }
    }).listen(application.args.controlPort);

    // check once per-minute to release expired request resources.
    application.pruneTimer = setInterval(pruneExpiredRequests, 60 * 1000);

    if (!application.args.silent)
    {
        var url   = 'http://localhost:' + application.args.controlPort;
        console.log('Started control server:');
        console.log('  URL:  '+url);
        console.log();
    }
}

/// Performs any application-level cleanup when the process is terminating.
function shutdown()
{
    if (!application.args.silent)
    {
        console.log();
        console.log('Content server is shutting down.');
        console.log();
    }
    if (application.pruneTimer >= 0)
    {
        clearInterval(application.pruneTimer);
        application.pruneTimer  =-1;
    }
    process.exit(exit_code.SUCCESS);
}

/// Register signal handlers to shut down the application.
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledException', shutdown);

/// Implements the entry point of the application. Command-line arguments are
/// parsed, and if necessary help information is displayed and the program
/// exits. The servers are then started.
function main()
{
    application.args     = processCommandLine();
    application.exitCode = exit_code.SUCCESS;
    registerMimeTypes();
    spawnStaticServer();
    spawnContentServer();
    spawnControlServer();
}

/// Application entry point.
main();
