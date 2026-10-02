# Application Configuration and Custom Compose

Applications use the original project's app-store configuration and runtime. Official and community repositories are supported. The repository does not contain an `examples/` directory.

The official [Umbrel App Store repository](https://github.com/getumbrel/umbrel-apps) is enabled by default on new installations. Repository management shows its address, a copy action, and the number of available apps alongside added community stores. The configured default repository cannot be removed through the panel. Adding a repository makes its catalog available; it does not install its applications.

## Local discovery content

Discover uses project-owned editorial content in `packages/frontend/src/features/app-store/data/storefront.json`. Its banners and category artwork are bundled in `packages/frontend/public/assets/app-store/storefront/`. The dashboard does not request the upstream storefront API at runtime. The initial content and artwork were imported from the [Umbrel storefront](https://apps.umbrel.com/api/v3/umbrelos/app-store/storefront) on October 2, 2026; subsequent changes are reviewed and shipped with this project. Original artwork came from the storefront's `/images/redesign/banners/` and `/images/redesign/feature-cards/` paths. Upstream names and artwork remain attributed to their respective owners.

Edit the JSON to change section order, featured application IDs, text, and category picks. Artwork paths must point to local WebP files in the bundled directory. Storefront tests validate the configuration and referenced assets. Recommendations only resolve against the current local catalog: missing apps are omitted, duplicate entries are removed, and empty sections disappear. A recommendation never overrides an installable version. The bundled application dates are a snapshot, not live upstream rankings or statistics; update dates only apply when the recorded version matches the local manifest. The complete catalog remains available even when no recommendations match.

Application repositories still supply app manifests, icons, and screenshots. Those images retain their repository-defined URLs; they are separate from the locally bundled discovery banners. Optional per-app release history remains separate from Discover, with current manifest release notes as its fallback.

The community-store warning is shown on the first opening in each browser profile for this system. Later openings omit it; clearing browser storage resets this preference.

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
