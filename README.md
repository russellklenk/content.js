# content.js #

A streamlined, minimalistic game content pipeline built on Node.js. The library and tools can be set up to monitor multiple source directory trees for changes, and on command, execute data compilers for each modified file. The intent is to provide rapid iteration for game content while minimizing errors that might result from manually running a series of separate tools.

Currently, the filesystem watching functionality is not implemented. Instead, the core functionality is exposed as a set of command-line tools for compiling resources and then archiving them up into single files for efficient transfer and loading.


## Installation ##

```bash
npm install -g contentjs
```
This installs a number of utilities accessible from the command-line.


## Usage ##

Content.js is a toolset, not a Node module. When installed, a number of command-line utilities become available:

 * `build` implements the core content build process.
 * `publish` builds archives for each resource package.

For each utility you can specify `--help` to see the command-line options.


## Project Structure ##

The tools operate on a top-level entity referred to as a content project. This is nothing more than a root directory under which all source content is located. A content project has the following basic directory structure:

 * `project_name/` The root content project directory.
  * `database/` Stores all generated content database information.
  * `packages/` The root directory for all resource packages.
  * `processors/` The root directory for all data compilers.
  * `pipeline.json` The content pipeline definition file.
  * `platform.json` The set of recognized platform names.
  * `publish.json` Configuration data for the `publish` tool.

Most of the work occurs under the `packages` directory. Within the `packages` directory, source content packages are defined. Each content package is a directory with a name like `Core.source`. The name of the content package is 'Core', and the '.source' identifies it as a source directory. Within the source content directory, you may organize files however you would like. The directory structure helps to define the name of the resource at runtime; for example:

 * `Core.source/` The source content package directory.
  * `textures/` The root textures directory.
   * `brick.texture` The brick texture for the 'generic' platform.
   * `brick.xbox360.texture` The brick texture for the 'xbox360' platform.
   * `brick.ps3.texture` The brick texture for the 'ps3' platform.

At runtime, the 'Core' package would contain a resource named `textures/brick`, which would contain the runtime data for the platform-specific version of the resource.


## Resource Identifiers ##

Resource identifiers consist of three parts, a name, zero or more properties, and a type. This data is all encoded in the file path:

 * Name: The name portion is the relative path and filename of the resource, with any extension components removed. The path is relative to the resource package root.
 * Properties: The properties are all of the dot-separated extension portions of the filename, not including the final extension component. Properties may be anything you desire and are available at runtime.
 * Type: The resource type is taken as the final extension component of the filename.

For example, given a root content project path `/Users/foo/project`, with a resource package at `/Users/foo/project/packages/Core.source`, and a file within that package at `textures/armor.battered.ps3.texture` we have:

 * A resource name of `textures/armor`.
 * Two properties, `battered` and `ps3`.
 * A resource type of `texture`.


## Platform Identifiers ##

Platform identifiers may be any string you wish. Edit the `platform.json` file to define your platform identifiers. This JSON file contains a single array of string values, each of which represents a single platform identifier:

```js
[
    'xbox360',
    'ps3'
]
```

These identifiers will then be automatically recognized when they appear as part of the resource filename extension list, for example `brick.ps3.texture`.


## Runtime ##

A JavaScript client runtime library can be found in the runtime directory. This library can load package files (tar format) output by the content.js publish tool. It uses the information stored in the package.manifest files to build a runtime set of content that can be accessed by name, and allows for easy asset replacement.

Additionally, code is included to manage the downloading of these manifest and package files. The HTML5 IndexedDB API is used to cache downloaded packages on the client, speeding load times and allowing offline access while still allowing for content updates.


## TODOs ##

The following items remain TBD or fixed:

 * Need to implement the clean tool to delete all target packages.


## License ##

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this software dedicate any and all copyright interest in the software to the public domain. We make this dedication for the benefit of the public at large and to the detriment of our heirs and successors. We intend this dedication to be an overt act of relinquishment in perpetuity of all present and future rights to this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS ORIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>
