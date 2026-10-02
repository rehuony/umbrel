# Application Configuration and Custom Compose

Applications use the original project's app-store configuration and runtime. Official and community repositories are supported. The repository does not contain an `examples/` directory.

## Configuration structure

Each application has a directory containing at least two files:

- `umbrel-app.yml`: application ID, name, icon, description, category, version, Web port, and related metadata.
- `docker-compose.yml`: services, images, mounts, environment variables, and service dependencies.

Community repositories describe their store in a root `umbrel-app-store.yml`. Official repositories retain their original discovery behavior. Application dependencies, environment variables, directory access, data-directory moves, gateway authentication, and member grants use the existing implementation.

The runtime in `packages/backend/source/modules/apps/runtime/` merges Compose configuration. `app_proxy` declares the application's Web entry; the server gateway handles it without starting a separate proxy container. The application ID is the Compose project name. Generated container names match the original store convention.

Relative bind paths resolve from the application directory: `./data` maps to `app-data/<id>/data`. Existing runtime variables such as `$APP_DATA_DIR` remain available. The system manages generated files including `docker-compose.umbreld.yml` and `docker-compose.umbrel-user-settings.yml`.

## Custom applications

Administrators can open **Import Compose** from the app-store menu, paste or upload a single Compose file, and enter:

- Required: application ID, name, HTTP(S) icon URL, description, version, and category.
- Optional: tagline and project website.
- Web applications: service name, container port, panel entry port, and path. The form generates the original `app_proxy` declaration. If the Compose file already supplies that declaration, enter the corresponding entry port.
- Background applications: leave the Web service and ports empty.

The importer saves form metadata as `umbrel-app.yml` and Compose as `docker-compose.yml`, then invokes the same installation pipeline used by store applications. `custom-apps/<id>` in the system data directory holds the local installation source; installed configuration and application data live in `app-data/<id>`. Custom applications appear as a local store in the registry. Importing does not create a remote repository.

Single-file imports require prebuilt images. They reject `build`, external `env_file`, `include`, `extends`, and configuration requiring external files. An imported application cannot reuse an existing store application's ID. Members cannot import, update, or uninstall applications. Web access retains panel authentication and member authorization.

Importing the same custom application ID again invokes the existing update workflow. Updates preserve application data. Failures return errors; container-internal database changes are not guaranteed to be reversible. Published ports, host networking, and mount permissions follow Compose and the existing runtime.

## Uninstallation and data

Uninstallation stops the application, revokes related grants, and removes its application directory. Custom applications also lose their local installation source. There is no retained-data management flow after uninstall. User directories shared with an application are not application-owned data and are not deleted.

Existing external application data cleanup validates the mount location. Offline or unsafe-to-locate external data is not blindly deleted. Docker named volumes follow the original runtime's lifecycle rules and are distinct from the application directory.
