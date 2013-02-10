#! /usr/bin/env node
/*/////////////////////////////////////////////////////////////////////////////
/// @summary This command-line utility implements the content build process.
/// The tool loads a project from the filesystem, determines changed, added and
/// deleted files, and invokes the necessary data compilers.
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem  = require('fs');
var Path        = require('path');
var Commander   = require('commander');
var ContentJS   = require('../index');

/// Constants representing the various application exit codes.
var exit_code   = {
    /// The program has exited successfully.
    SUCCESS     : 0,
    /// The program has exited with an unknown error.
    ERROR       : 1
};

/// Constants and global values used throughout the application module.
var application = {
    /// The name of the application module.
    NAME              : 'build',
    /// The path from which the application was started.
    STARTUP_DIRECTORY : process.cwd(),
    /// An object defining the pre-digested command-line arguments passed to
    /// the application, not including the node or script name values.
    args              : {},
    /// The path of the project being built, as specified on the command-line.
    projectPath       : '',
    /// The name of the target platform, as specified on the command-line.
    targetPlatform    : '',
    /// The ProjectBuilder that manages the content pipeline processes.
    projectBuilder    : null,
    /// The application exit code.
    exitCode          : exit_code.SUCCESS,
    /// The number of content packages remaining to build.
    remaining         : 0
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

/// Callback invoked when the ProjectBuilder emits the 'error' event to
/// indicate that an error occurred while spawning data compiler processes.
/// @param builder The ProjectBuilder instance that raised the event.
/// @param info An object specifying additional information about the error.
/// @param info.resourceType A string specifying the resource type whose
/// compiler failed to start.
/// @param info.scriptPath The absolute path of the data compiler script.
/// @param info.error An Error instance specifying additional information.
function projectBuilderError(builder, info)
{
    if (!application.args.silent)
    {
        console.error('ERROR SPAWNING DATA COMPILER PROCESS:');
        console.error('  Type:  '+info.resourceType);
        console.error('  Path:  '+info.scriptPath);
        console.error('  Error: '+info.error);
        console.error();
    }
    process.exit(exit_code.ERROR);
}

/// Callback invoked when the ProjectBuilder emits the 'ready' event to
/// indicate that the content pipeline is available and builds can begin.
/// @param builder The ProjectBuilder instance that raised the event.
function projectBuilderReady(builder)
{
    var packages = builder.enumeratePackages();
    application.remaining = packages.length;
    for (var i   = 0,   n = packages.length; i < n; ++i)
    {
        var packageBuild  = builder.createPackageBuilder(packages[i]);
        packageBuild.on('start',   packageBuildStarted);
        packageBuild.on('finish',  packageBuildFinished);
        packageBuild.on('compile', compileStarted);
        packageBuild.on('success', compileSucceeded);
        packageBuild.on('error',   compileError);
        packageBuild.on('ignore',  sourceFileIgnored);
        packageBuild.buildTarget(application.targetPlatform);
    }
}

/// Callback invoked when the ProjectBuilder emits the 'disposed' event to
/// indicate that all content pipeline processes have been terminated.
/// @param builder The ProjectBuilder instance that raised the event.
function projectBuilderDisposed(builder)
{
    process.exit(application.exitCode);
}

/// Callback invoked when the PackageBuilder emits the 'start' event to
/// indicate that the build process has started for a content package.
/// @param builder The PackageBuilder instance that raised the event.
/// @param info Additional information related to the event.
/// @param info.projectName The name of the project the package belongs to.
/// @param info.packageName The name of the content package.
/// @param info.targetName The name of the target platform.
function packageBuildStarted(builder, info)
{
    if (!application.args.silent)
    {
        console.log('Starting build for content package:');
        console.log('  Project: '+info.projectName);
        console.log('  Package: '+info.packageName);
        console.log('  Target:  '+info.targetName);
        console.log();
    }
}

/// Callback invoked when the PackageBuilder emits the 'finish' event to
/// indicate that the build process has started for a content package.
/// @param builder The PackageBuilder instance that raised the event.
/// @param info Additional information related to the event.
/// @param info.projectName The name of the project the package belongs to.
/// @param info.packageName The name of the content package.
/// @param info.targetName The name of the target platform.
/// @param info.successCount The number of source files compiled successfully.
/// @param info.skippedCount The number of source files skipped.
/// @param info.errorCount The number of source files that encountered errors.
/// @param info.success true if the build was successful; false otherwise.
function packageBuildFinished(builder, info)
{
    if (info.success)
    {
        if (!application.args.silent)
        {
            console.log('PACKAGE BUILD SUCCEEDED:');
            console.log('  Package:   '+info.packageName);
            console.log('  Ignored:   '+info.skippedCount);
            console.log('  Succeeded: '+info.successCount);
            console.log('  Failed:    '+info.errorCount);
            console.log();
        }
    }
    else
    {
        if (!application.args.silent)
        {
            console.error('PACKAGE BUILD FAILED:');
            console.error('  Package:   '+info.packageName);
            console.error('  Ignored:   '+info.skippedCount);
            console.error('  Succeeded: '+info.successCount);
            console.error('  Failed:    '+info.errorCount);
            console.error();
        }
        // one or more packages failed to build.
        application.exitCode  = exit_code.ERROR;
    }
    if (application.remaining === 1)
    {
        // this was the final content package. we're done.
        application.remaining--;
        application.projectBuilder.dispose();
    }
    else
    {
        // there are additional packages still building.
        application.remaining--;
    }
}

/// Callback invoked when a source file is submitted to a data compiler.
/// @param builder The PackageBuilder instance that raised the event.
/// @param info Additional information related to the event.
/// @param info.projectName The name of the project the package belongs to.
/// @param info.packageName The name of the content package.
/// @param info.targetName The name of the target platform.
/// @param info.sourcePath The absolute path of the source file.
/// @param info.targetPath The absolute path of the target resource.
/// @param info.compilerName The name of the data compiler.
function compileStarted(builder, info)
{
    if (!application.args.silent)
    {
        console.log('Starting rebuild for source file:');
        console.log('  Package:  '+info.packageName);
        console.log('  Source:   '+info.sourcePath);
        console.log('  Target:   '+info.targetPath);
        console.log('  Compiler: '+info.compilerName);
        console.log();
    }
}

/// Callback invoked when a source file is recompiled successfully.
/// @param builder The PackageBuilder instance that raised the event.
/// @param info Additional information related to the event.
/// @param info.projectName The name of the project the package belongs to.
/// @param info.packageName The name of the content package.
/// @param info.targetName The name of the target platform.
/// @param info.sourcePath The absolute path of the source file.
/// @param info.targetPath The absolute path of the target resource.
/// @param info.compilerName The name of the data compiler.
/// @param info.outputFiles An array of absolute paths specifying the outputs.
function compileSucceeded(builder, info)
{
    if (!application.args.silent)
    {
        console.log('Successfully compiled source file:');
        console.log('  Package:   '+info.packageName);
        console.log('  Source:    '+info.sourcePath);
        console.log('  Target:    '+info.targetPath);
        console.log('  Compiler:  '+info.compilerName);
        console.log('  Output(s): ');
        for (var i = 0, n = info.outputFiles.length; i < n; ++i)
            console.log('    '+info.outputFiles[i]);
        console.log();
    }
}

/// Callback invoked when a data compiler returned errors dueing a recompile.
/// @param builder The PackageBuilder instance that raised the event.
/// @param info Additional information related to the event.
/// @param info.projectName The name of the project the package belongs to.
/// @param info.packageName The name of the content package.
/// @param info.targetName The name of the target platform.
/// @param info.sourcePath The absolute path of the source file.
/// @param info.targetPath The absolute path of the target resource.
/// @param info.compilerName The name of the data compiler.
/// @param info.errors An array of error messages.
function compileError(builder, info)
{
    if (!application.args.silent)
    {
        console.error('Error(s) while compiling file:');
        console.error('  Package:  '+info.packageName);
        console.error('  Source:   '+info.sourcePath);
        console.error('  Target:   '+info.targetPath);
        console.error('  Compiler: '+info.compilerName);
        console.error('  Error(s): ');
        for (var i = 0, n = info.errors.length; i < n; ++i)
            console.error('    '+info.errors[i]);
        console.error();
    }
}

/// Callback invoked when a source file is ignored (not recompiled).
/// @param builder The PackageBuilder instance that raised the event.
/// @param info Additional information related to the event.
/// @param info.projectName The name of the project the package belongs to.
/// @param info.packageName The name of the content package.
/// @param info.targetName The name of the target platform.
/// @param info.sourcePath The absolute path of the source file.
/// @param info.targetPath The absolute path of the target resource.
/// @param info.reason A string specifying the reason the file was ignored.
function sourceFileIgnored(builder, info)
{
    if (!application.args.silent)
    {
        console.log('Ignored source file:');
        console.log('  Package: '+info.packageName);
        console.log('  Source:  '+info.sourcePath);
        console.log('  Target:  '+info.targetPath);
        console.log('  Reason:  '+info.reason);
        console.log();
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
        .option('-p, --project [path]', 'Path of the project to build.', String)
        .option('-t, --target [name]',  'Name of the target platform.',  String, '')
        .parse(process.argv);

    // return an object containing our final configuration options:
    return {
        silent      : Commander.silent,
        projectRoot : Commander.project,
        targetName  : Commander.target
    };
}

/// Implements the entry point of the application. Command-line arguments are
/// parsed, and if necessary help information is displayed and the program
/// exits. The project is then loaded and the build process started.
function main()
{
    application.args            = processCommandLine();
    application.exitCode        = exit_code.SUCCESS;
    application.remaining       = 0;
    application.projectPath     = application.args.projectRoot;
    application.targetPlatform  = application.args.targetName;
    application.projectBuilder  = ContentJS.createBuilder();
    application.projectBuilder.on('error',    projectBuilderError);
    application.projectBuilder.on('ready',    projectBuilderReady);
    application.projectBuilder.on('disposed', projectBuilderDisposed);
    application.projectBuilder.loadProject(application.projectPath);
}

/// Application entry point.
main();
