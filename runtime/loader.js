/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements the resource loading routines for the application on
/// top of the services provided by ContentJS. This is a stub implementation
/// that applications can build on; it is not meant to be a complete
/// implementation. In ContentLoader.prototype.init, ensure that the scriptPath
/// is set to the correct relative path to the content.js runtime script.
/// @author Russell Klenk (contact@russellklenk.com)
///////////////////////////////////////////////////////////////////////////80*/
/// @summary Defines the internal event IDs relating to content loading. Events
/// are posted from callback functions and processed during the update tick.
var LoadEvent     = {
    /// Indicates that the content loading process should begin. Moves the
    /// current state to LoadState.LOAD_MANIFEST.
    START_LOADING : 0,
    /// Indicates that an error occurred when loading content. Moves the
    /// current state to LoadState.ERROR.
    ERROR         : 1,
    /// Indicates that the application manifest has been received. Moves the
    /// current state to LoadState.LOAD_SPLASH.
    READ_MANIFEST : 2,
    /// Indicates that the splash screen content is loaded and fully unpacked.
    /// Moves the current state to LoadState.LOAD_UI.
    SPLASH_READY  : 3,
    /// Indicates that the UI content is loaded and fully unpacked. Moves the
    /// current state to LoadState.LOAD_CONTENT.
    UI_READY      : 4,
    /// Indicates that the primary content group is loaded and fully unpacked.
    /// Moves the current state to LoadState.READY.
    CONTENT_READY : 5,
    /// Indicates that a reload request has been received.
    RELOAD        : 6
};

/// @summary Defines the various internal loading states. Content is loaded in
/// three separate groups. First, splash screen content is loaded - this group
/// is small and quick to download. Once the splash screen content it ready,
/// the presentation can begin while the UI content is loaded. As soon as the
/// UI group is ready, the app can become interactive while the main app content
/// is loading in the background. Once the main app content has downloaded and
/// unpacked, the content loader becomes idle.
var LoadState     = {
    /// Initial state at startup. Waits for the LoadEvent.START_LOADING event.
    STARTUP       : 0,
    /// Unrecoverable error state. The LoadEvent.ERROR event is posted. The
    /// only way to get out of this state is to perform a reload.
    ERROR         : 1,
    /// Waiting for the application manifest to be loaded.
    LOAD_MANIFEST : 2,
    /// Waiting for the splash screen content group to load.
    LOAD_SPLASH   : 3,
    /// Waiting for the UI content group to load.
    LOAD_UI       : 4,
    /// Waiting for the primary content group to load.
    LOAD_PRIMARY  : 5,
    /// All content groups have loaded and unpacked successfully and the loader
    /// is waiting in an idle state.
    READY         : 6
};

/// @summary Defines the content group names for the application.
var ContentGroup  = {
    SPLASH        : 'splash',
    UI            : 'ui',
    PRIMARY       : 'main'
};

/// @summary Defines the names of the content bundles within each content
/// group. A content group may be comprised of multiple bundles. The
/// application is only notified when all bundles in a group have loaded.
var ContentBundle = {
    SPLASH        : ['splash'],
    UI            : ['ui'],
    PRIMARY       : ['main']
};

/// @summary Constructor function for the ContentLoader type, which manages
/// loading content for the application using the services provided by the
/// ContentJS library. The methods on this class can only be called from the
/// UI thread. The loader may spawn a background thread to handle unpacking.
/// @return A reference to the new ContentLoader instance.
var ContentLoader = function ()
{
    if (!(this instanceof ContentLoader))
        return new ContentLoader();

    this.state          = LoadState.STARTUP;
    this.canPresent     = false;
    this.loader         = null;
    this.events         = [];
    this.uiContent      = {};
    this.splashContent  = {};
    this.primaryContent = {};
    this.eventCount     = 0;
    return this;
};
ContentJS.Emitter.mixin(ContentLoader);

/// @summary Initializes the content loader to a known state, but does not
/// attempt to load any content.
/// @return The ContentLoader.
ContentLoader.prototype.init = function ()
{
    this.state          = LoadState.STARTUP;
    this.canPresent     = false;
    this.events         = [];
    this.eventCount     = 0;
    this.uiContent      = ContentJS.createContentSet();
    this.splashContent  = ContentJS.createContentSet();
    this.primaryContent = ContentJS.createContentSet();
    this.loader         = ContentJS.createLoader({
        scriptPath      : 'scripts/content.js/',
        applicationName : 'prototype',
        platformName    : 'generic',
        version         : 'latest',
        background      : false,
        servers         : [
            'http://localhost:55366'
        ]
    });
    this.loader.on('download:error',    this.onDownloadError.bind(this));
    this.loader.on('download:progress', this.onDownloadProgress.bind(this));
    this.loader.on('manifest:loaded',   this.onManifestLoaded.bind(this));
    this.loader.on('group:error',       this.onGroupError.bind(this));
    this.loader.on('group:ready',       this.onGroupReady.bind(this));
    return this;
};

/// @summary An internal function used to post an event to the internal event
/// queue. Applications should not call this method.
/// @param eventId One of the values of the LoadEvent enumeration.
/// @return The ContentLoader.
ContentLoader.prototype.post = function (eventId)
{
    this.events[this.eventCount++] = eventId;
    return this;
};

/// @summary Begins the process of loading the application content.
/// @return The ContentLoader.
ContentLoader.prototype.load = function ()
{
    this.post(LoadEvent.START_LOADING);
    return this;
};

/// @summary Implements the content loading state machine. This should be
/// called once per-tick of the application loop.
/// @return The ContentLoader.
ContentLoader.prototype.tick = function ()
{
    var events = this.events;
    var active = this.state;
    var state  = this.state;
    for (var i = 0; i < this.eventCount; ++i)
    {
        var ev = this.events[i];
        if (ev === LoadEvent.ERROR)
        {
            // immediately transition to the error state.
            // the individual states never see this event.
            active = LoadState.ERROR;
        }
        switch (active)
        {
            case LoadState.STARTUP:
                state = this.state_Startup(ev);
                break;
            case LoadState.ERROR:
                state = this.state_Error(ev);
                break;
            case LoadState.LOAD_MANIFEST:
                state = this.state_LoadManifest(ev);
                break;
            case LoadState.LOAD_SPLASH:
                state = this.state_LoadSplash(ev);
                break;
            case LoadState.LOAD_UI:
                state = this.state_LoadInterface(ev);
                break;
            case LoadState.LOAD_PRIMARY:
                state = this.state_LoadPrimary(ev);
                break;
            case LoadState.READY:
                state = this.state_Ready(ev);
                break;
        }
        // possibly update active to a new state.
        active = state;
    }
    this.state = active;
    this.eventCount = 0;
    this.loader.unpackResources(16);
    return this;
};

/// @summary Submits a request to rebuild and publish the latest content. This
/// is used during development mode only.
/// @return The ContentLoader.
ContentLoader.prototype.reload = function ()
{
    this.post(LoadEvent.RELOAD);
    return this;
};

/// @summary Loads text from a script node and returns the script string.
/// @param element_id The ID of the script element to read.
/// @return A string containing the text read from the script element, or an
/// empty string if no element with the specified ID was found.
ContentLoader.prototype.textFromDOM = function (elementId)
{
    var  element = document.getElementById(elementId);
    if (!element)  return '';
    var    scriptSource = '';
    var    currentChild = element.firstChild;
    while (currentChild)
    {
        if (currentChild.nodeType === 3) /* a text node */
        {
            scriptSource += currentChild.textContent;
        }
        currentChild = currentChild.nextSibling;
    }
    return scriptSource;
};

/// @summary Sends the rebuild request to the content server.
ContentLoader.prototype.request_Rebuild = function ()
{
    var url           = 'http://localhost:55367'+'/rebuild';
    var xhr           = new XMLHttpRequest();
    var self          = this;
    this.state        = LoadState.STARTUP;
    xhr.open('POST',url,true);
    xhr.responseType  = 'text'
    xhr.onload        = function (progress)
        {
            var stat  = xhr.status;
            if (stat >= 200 && stat < 300)
            {
                // status codes in the 200 range indicate success.
                self.request_BuildStatus(xhr.response);
            }
            else
            {
                // status codes outside the 200 range indicate an error.
                self.post(LoadEvent.ERROR);
                self.emit('error:rebuild', this, url, new Error(xhr.statusText));
            }
        };
    xhr.onerror       = function (progress)
        {
            self.post(LoadEvent.ERROR);
            self.emit('error:rebuild', this, url, new Error(xhr.statusText));
        };
    xhr.send();
};

/// @summary Polls the content server for the status of a particular build. If
/// the build completes successfully, application content is reloaded.
/// @param buildUrl The relative URL returned by the rebuild request. This URL
/// specifies the unique ID of the build to poll.
ContentLoader.prototype.request_BuildStatus = function (buildUrl)
{
    var url           = 'http://localhost:55367'+buildUrl;
    var xhr           = new XMLHttpRequest();
    var self          = this;
    xhr.open('GET', url, true);
    xhr.responseType  = 'text';
    xhr.onload        = function (progress)
        {
            var stat  = xhr.status;
            if (stat >= 200 && stat < 300)
            {
                // status codes in the 200 range indicate success.
                var json = xhr.response;
                var data = JSON.parse(json);
                if (data.success)
                {
                    // during the initial load, the ContentJS.ContentLoader
                    // requests the application manifest automatically when
                    // the cache becomes ready, but during a reload, we must
                    // perform that step manually.
                    self.loader.loadApplicationManifest(navigator.onLine);
                    self.post(LoadEvent.START_LOADING);
                    self.emit('rebuild:success', this);
                }
                else
                {
                    var pub  = data.publishStdout;
                    var make = data.buildStdout;
                    var text = 'Build:\n'+make+'\n\n'+'Publish:\n'+pub+'\n';
                    self.post(LoadEvent.ERROR);
                    self.emit('error:rebuild', this, url, new Error(text));
                }
            }
            else
            {
                self.post(LoadEvent.ERROR);
                self.emit('error:rebuild', this, url, new Error(xhr.statusText));
            }
        };
    xhr.onerror       = function (progress)
        {
            self.post(LoadEvent.ERROR);
            self.emit('error:rebuild', this, url, new Error(xhr.statusText));
        };
    xhr.send();
};

/// @summary Implements the logic for the STARTUP state.
/// @param ev One of the values of the LoadEvent enumeration.
/// @return One of the values of the LoadState enumeration representing the
/// new active state of the load process.
ContentLoader.prototype.state_Startup = function (ev)
{
    if (ev !== LoadEvent.START_LOADING)
        return LoadState.STARTUP;

    return LoadState.LOAD_MANIFEST;
};

/// @summary Implements the logic for the ERROR state.
/// @param ev One of the values of the LoadEvent enumeration.
/// @return One of the values of the LoadState enumeration representing the
/// new active state of the load process.
ContentLoader.prototype.state_Error = function (ev)
{
    if (ev !== LoadEvent.RELOAD)
        return LoadState.ERROR;

    this.request_Rebuild();
    return LoadState.STARTUP;
};

/// @summary Implements the logic for the LOAD_MANIFEST state.
/// @param ev One of the values of the LoadEvent enumeration.
/// @return One of the values of the LoadState enumeration representing the
/// new active state of the load process.
ContentLoader.prototype.state_LoadManifest = function (ev)
{
    if (ev !== LoadEvent.READ_MANIFEST)
        return LoadState.LOAD_MANIFEST;

    var groupName = ContentGroup.SPLASH;
    var bundles   = ContentBundle.SPLASH;
    var content   = this.splashContent;
    this.loader.loadPackageGroup(groupName, content, bundles);
    this.emit('load:manifest', this);
    return LoadState.LOAD_SPLASH;
};

/// @summary Implements the logic for the LOAD_SPLASH state.
/// @param ev One of the values of the LoadEvent enumeration.
/// @return One of the values of the LoadState enumeration representing the
/// new active state of the load process.
ContentLoader.prototype.state_LoadSplash = function (ev)
{
    if (ev !== LoadEvent.SPLASH_READY)
        return LoadState.LOAD_SPLASH;

    var groupName = ContentGroup.UI;
    var bundles   = ContentBundle.UI;
    var content   = this.uiContent;
    this.loader.loadPackageGroup(groupName, content, bundles);
    this.emit('load:splash', this, this.splashContent);
    return LoadState.LOAD_UI;
};

/// @summary Implements the logic for the LOAD_UI state.
/// @param ev One of the values of the LoadEvent enumeration.
/// @return One of the values of the LoadState enumeration representing the
/// new active state of the load process.
ContentLoader.prototype.state_LoadInterface = function (ev)
{
    if (ev !== LoadEvent.UI_READY)
        return LoadState.LOAD_MANIFEST;

    var groupName = ContentGroup.PRIMARY;
    var bundles   = ContentBundle.PRIMARY;
    var content   = this.content;
    this.loader.loadPackageGroup(groupName, content, bundles);
    this.emit('load:ui', this, this.uiContent);
    return LoadState.LOAD_PRIMARY;
};

/// @summary Implements the logic for the LOAD_PRIMARY state.
/// @param ev One of the values of the LoadEvent enumeration.
/// @return One of the values of the LoadState enumeration representing the
/// new active state of the load process.
ContentLoader.prototype.state_LoadPrimary = function (ev)
{
    if (ev !== LoadEvent.CONTENT_READY)
        return LoadState.LOAD_CONTENT;

    this.emit('load:primary',  this, this.content);
    this.emit('load:complete', this);
    return LoadState.READY;
};

/// @summary Implements the logic for the READY state.
/// @param ev One of the values of the LoadEvent enumeration.
/// @return One of the values of the LoadState enumeration representing the
/// new active state of the load process.
ContentLoader.prototype.state_Ready = function (ev)
{
    if (ev !== LoadEvent.RELOAD)
        return LoadState.READY;

    this.request_Rebuild();
    return LoadState.STARTUP;
};

/// @summary Callback invoked when ContentJS reports an error trying to
/// download a content bundle or the application manifest.
/// @param ev Additional information about the error.
/// @param ev.loader The ContentJS.ContentLoader that raised the event.
/// @param ev.resourceName The URL of the resource being downloaded.
/// @param ev.error The Error instance specifying additional information.
ContentLoader.prototype.onDownloadError = function (ev)
{
    this.post(LoadEvent.ERROR);
    this.emit('error:download', this, ev.resourceName, ev.error);
};

/// @summary Callback invoked when ContentJS reports progress downloading
/// a content bundle file.
/// @param ev Additional information about the event.
/// @param ev.loader The ContentJS.ContentLoader that raised the event.
/// @param ev.resourceName The URL of the resource being downloaded.
/// @param ev.packageName The friendly name of the content bundle.
/// @param ev.progress A number in [0, 100] indicating the percentage complete.
ContentLoader.prototype.onDownloadProgress = function (ev)
{
    this.emit('load:progress', this, ev.packageName, ev.progress);
};

/// @summary Callback invoked when ContentJS reports that it has successfully
/// received and parsed the application manifest, which specifies all of the
/// content bundles available to the application.
/// @param ev Additional information about the event.
/// @param ev.loader The ContentJS.ContentLoader that raised the event.
/// @param ev.manifest The deserialized application manifest defining the
/// content bundles and their revisions.
/// @param ev.manifest.latest An object describing the latest content revision.
/// @param ev.version An object describing the requested content revision.
/// @param ev.packages An array specifying additional information about the
/// content bundles available to the application.
ContentLoader.prototype.onManifestLoaded = function (ev)
{
    this.post(LoadEvent.READ_MANIFEST);
};

/// @summary Callback invoked when an error occurs during unpacking and runtime
/// preparation of content within a particular content group.
/// @param ev Additional information about the event.
/// @param ev.loader The ContentJS.ContentLoader that raised the event.
/// @param ev.error Additional information about the error.
/// @param ev.archive The ContentJS.TarArchive instance for the content package.
/// @param ev.context Application-specific context data supplied to the
/// ContentJS.ContentLoader.unpackResources() method.
/// @param ev.metadata An array of objects describing the resources contained
/// within the content package.
/// @param ev.groupName The name of the content group being unpacked.
/// @param ev.contentSet The ContentJS.ContentSet into which content is loaded.
/// @param ev.packageName The name of the content package being unpacked.
ContentLoader.prototype.onGroupError = function (ev)
{
    this.post(LoadEvent.ERROR);
    this.emit('error:unpack', this, ev.packageName, ev.error);
};

/// @summary Callback invoked when resources have been unpacked successfully
/// from all packages within a content group.
/// @param ev Additional information about the event.
/// @param ev.loader The ContentJS.ContentLoader that raised the event.
/// @param ev.context Application-specific context data supplied to the
/// ContentJS.ContentLoader.unpackResources() method.
/// @param ev.metadata An array of objects describing the resources contained
/// within the content package.
/// @param ev.groupName The name of the content group that was unpacked.
/// @param ev.contentSet The ContentJS.ContentSet into which content was loaded.
ContentLoader.prototype.onGroupReady = function (ev)
{
    switch (ev.groupName)
    {
        case ContentGroup.SPLASH:
            this.post(LoadEvent.SPLASH_READY);
            break;
        case ContentGroup.UI:
            this.post(LoadEvent.UI_READY);
            break;
        case ContentGroup.MAIN:
            this.post(LoadEvent.CONTENT_READY);
            break;
    }
};

/// @summary Callback invoked when a shader resource is being unpacked.
/// @param ev Additional information associated with the event.
/// @param ev.loader The ContentJS.ContentLoader that raised the event.
/// @param ev.archive The ContentJS.TarArchive instance for the archive file
/// from which the resource data should be loaded.
/// @param ev.content The ContentJS.Content instance associated with the
/// content item.
/// @param ev.context Application-specific context data supplied to the
/// ContentJS.ContentLoader.unpackResources() method.
/// @param ev.metadata Metadata associated with the resource.
/// @param ev.metadata.name The friendly name of the resource.
/// @param ev.metadata.type A string specifying the resource type, 'shader'.
/// @param ev.metadata.tags An array of strings specifying application metadata.
/// @param ev.metadata.data An array of strings specifying the names of the
/// files that make up the resource, which can be used to extract the resource
/// from the containing archive file.
/// @param ev.groupName The name of the content group being unpacked.
/// @param ev.contentSet The ContentJS.ContentSet into which content is loaded.
/// @param ev.packageName The name of the content package being unpacked.
ContentLoader.prototype.onLoadShader = function (ev)
{
    // @todo: implement this for your content type.
};

/// @summary Callback invoked when a texture resource is being unpacked.
/// @param ev Additional information associated with the event.
/// @param ev.loader The ContentJS.ContentLoader that raised the event.
/// @param ev.archive The ContentJS.TarArchive instance for the archive file
/// from which the resource data should be loaded.
/// @param ev.content The ContentJS.Content instance associated with the
/// content item.
/// @param ev.context Application-specific context data supplied to the
/// ContentJS.ContentLoader.unpackResources() method.
/// @param ev.metadata Metadata associated with the resource.
/// @param ev.metadata.name The friendly name of the resource.
/// @param ev.metadata.type A string specifying the resource type, 'texture'.
/// @param ev.metadata.tags An array of strings specifying application metadata.
/// @param ev.metadata.data An array of strings specifying the names of the
/// files that make up the resource, which can be used to extract the resource
/// from the containing archive file.
/// @param ev.groupName The name of the content group being unpacked.
/// @param ev.contentSet The ContentJS.ContentSet into which content is loaded.
/// @param ev.packageName The name of the content package being unpacked.
ContentLoader.prototype.onLoadTexture = function (ev)
{
    // @todo: implement this for your content type.
};
