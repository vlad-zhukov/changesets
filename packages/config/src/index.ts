import * as fs from "fs-extra";
import path from "path";
import { ValidationError } from "@changesets/errors";
import { warn } from "@changesets/logger";
import { Packages } from "@manypkg/get-packages";
import { Config, WrittenConfig } from "@changesets/types";
import packageJson from "../package.json";
import { getDependentsGraph } from "@changesets/get-dependents-graph";

export let defaultWrittenConfig = {
  $schema: `https://unpkg.com/@changesets/config@${packageJson.version}/schema.json`,
  changelog: "@changesets/cli/changelog",
  commit: false,
  linked: [] as ReadonlyArray<ReadonlyArray<string>>,
  access: "restricted",
  baseBranch: "master",
  updateInternalDependencies: "patch",
  ignore: [] as ReadonlyArray<string>
} as const;

function getNormalisedChangelogOption(
  thing: false | readonly [string, any] | string
): Config["changelog"] {
  if (thing === false) {
    return false;
  }
  if (typeof thing === "string") {
    return [thing, null];
  }
  return thing;
}

export let read = async (cwd: string, packages: Packages) => {
  let json = await fs.readJSON(path.join(cwd, ".changeset", "config.json"));
  return parse(json, packages);
};

export let parse = (json: WrittenConfig, packages: Packages): Config => {
  let messages = [];
  if (
    json.changelog !== undefined &&
    json.changelog !== false &&
    typeof json.changelog !== "string" &&
    !(
      Array.isArray(json.changelog) &&
      json.changelog.length === 2 &&
      typeof json.changelog[0] === "string"
    )
  ) {
    messages.push(
      `The \`changelog\` option is set as ${JSON.stringify(
        json.changelog,
        null,
        2
      )} when the only valid values are undefined, a module path(e.g. "@changesets/cli/changelog" or "./some-module") or a tuple with a module path and config for the changelog generator(e.g. ["@changesets/cli/changelog", { someOption: true }])`
    );
  }

  let normalizedAccess: WrittenConfig["access"] = json.access;
  if ((json.access as string) === "private") {
    normalizedAccess = "restricted";
    warn(
      'The `access` option is set as "private", but this is actually not a valid value - the correct form is "restricted".'
    );
  }
  if (
    normalizedAccess !== undefined &&
    normalizedAccess !== "restricted" &&
    normalizedAccess !== "public"
  ) {
    messages.push(
      `The \`access\` option is set as ${JSON.stringify(
        normalizedAccess,
        null,
        2
      )} when the only valid values are undefined, "public" or "restricted"`
    );
  }

  if (json.commit !== undefined && typeof json.commit !== "boolean") {
    messages.push(
      `The \`commit\` option is set as ${JSON.stringify(
        json.commit,
        null,
        2
      )} when the only valid values are undefined or a boolean`
    );
  }
  if (json.baseBranch !== undefined && typeof json.baseBranch !== "string") {
    messages.push(
      `The \`baseBranch\` option is set as ${JSON.stringify(
        json.baseBranch,
        null,
        2
      )} but the \`baseBranch\` option can only be set as a string`
    );
  }
  if (json.linked !== undefined) {
    if (
      !(
        Array.isArray(json.linked) &&
        json.linked.every(
          arr =>
            Array.isArray(arr) &&
            arr.every(pkgName => typeof pkgName === "string")
        )
      )
    ) {
      messages.push(
        `The \`linked\` option is set as ${JSON.stringify(
          json.linked,
          null,
          2
        )} when the only valid values are undefined or an array of arrays of package names`
      );
    } else {
      let pkgNames = new Set(
        packages.packages.map(({ packageJson }) => packageJson.name)
      );
      let foundPkgNames = new Set<string>();
      let duplicatedPkgNames = new Set<string>();
      for (let linkedGroup of json.linked) {
        for (let linkedPkgName of linkedGroup) {
          if (!pkgNames.has(linkedPkgName)) {
            messages.push(
              `The package "${linkedPkgName}" is specified in the \`linked\` option but it is not found in the project. You may have misspelled the package name.`
            );
          }
          if (foundPkgNames.has(linkedPkgName)) {
            duplicatedPkgNames.add(linkedPkgName);
          }
          foundPkgNames.add(linkedPkgName);
        }
      }
      if (duplicatedPkgNames.size) {
        duplicatedPkgNames.forEach(pkgName => {
          messages.push(
            `The package "${pkgName}" is in multiple sets of linked packages. Packages can only be in a single set of linked packages.`
          );
        });
      }
    }
  }
  if (
    json.updateInternalDependencies !== undefined &&
    !["patch", "minor"].includes(json.updateInternalDependencies)
  ) {
    messages.push(
      `The \`updateInternalDependencies\` option is set as ${JSON.stringify(
        json.updateInternalDependencies,
        null,
        2
      )} but can only be 'patch' or 'minor'`
    );
  }
  if (json.ignore) {
    if (
      !(
        Array.isArray(json.ignore) &&
        json.ignore.every(pkgName => typeof pkgName === "string")
      )
    ) {
      messages.push(
        `The \`ignore\` option is set as ${JSON.stringify(
          json.ignore,
          null,
          2
        )} when the only valid values are undefined or an array of package names`
      );
    } else {
      let pkgNames = new Set(
        packages.packages.map(({ packageJson }) => packageJson.name)
      );
      for (let pkgName of json.ignore) {
        if (!pkgNames.has(pkgName)) {
          messages.push(
            `The package "${pkgName}" is specified in the \`ignore\` option but it is not found in the project. You may have misspelled the package name.`
          );
        }
      }

      // Validate that all dependents of ignored packages are listed in the ignore list
      const dependentsGraph = getDependentsGraph(packages);
      for (const ignoredPackage of json.ignore) {
        const dependents = dependentsGraph.get(ignoredPackage) || [];
        for (const dependent of dependents) {
          if (!json.ignore.includes(dependent)) {
            messages.push(
              `The package "${dependent}" depends on the ignored package "${ignoredPackage}", but "${dependent}" is not being ignored. Please add "${dependent}" to the \`ignore\` option.`
            );
          }
        }
      }
    }
  }

  if (json.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH !== undefined) {
    const {
      onlyUpdatePeerDependentsWhenOutOfRange,
      useCalculatedVersionForSnapshots
    } = json.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH;
    if (
      onlyUpdatePeerDependentsWhenOutOfRange !== undefined &&
      typeof onlyUpdatePeerDependentsWhenOutOfRange !== "boolean"
    ) {
      messages.push(
        `The \`onlyUpdatePeerDependentsWhenOutOfRange\` option is set as ${JSON.stringify(
          onlyUpdatePeerDependentsWhenOutOfRange,
          null,
          2
        )} when the only valid values are undefined or a boolean`
      );
    }
    if (
      useCalculatedVersionForSnapshots !== undefined &&
      typeof useCalculatedVersionForSnapshots !== "boolean"
    ) {
      messages.push(
        `The \`useCalculatedVersionForSnapshots\` option is set as ${JSON.stringify(
          useCalculatedVersionForSnapshots,
          null,
          2
        )} when the only valid values are undefined or a boolean`
      );
    }
  }
  if (messages.length) {
    throw new ValidationError(
      `Some errors occurred when validating the changesets config:\n` +
        messages.join("\n")
    );
  }

  let config: Config = {
    changelog: getNormalisedChangelogOption(
      json.changelog === undefined
        ? defaultWrittenConfig.changelog
        : json.changelog
    ),
    access:
      normalizedAccess === undefined
        ? defaultWrittenConfig.access
        : normalizedAccess,
    commit:
      json.commit === undefined ? defaultWrittenConfig.commit : json.commit,
    linked:
      json.linked === undefined ? defaultWrittenConfig.linked : json.linked,
    baseBranch:
      json.baseBranch === undefined
        ? defaultWrittenConfig.baseBranch
        : json.baseBranch,

    updateInternalDependencies:
      json.updateInternalDependencies === undefined
        ? defaultWrittenConfig.updateInternalDependencies
        : json.updateInternalDependencies,

    ignore:
      json.ignore === undefined ? defaultWrittenConfig.ignore : json.ignore,

    ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
      onlyUpdatePeerDependentsWhenOutOfRange:
        json.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH === undefined ||
        json.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH
          .onlyUpdatePeerDependentsWhenOutOfRange === undefined
          ? false
          : json.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH
              .onlyUpdatePeerDependentsWhenOutOfRange,

      useCalculatedVersionForSnapshots:
        json.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH === undefined ||
        json.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH
          .useCalculatedVersionForSnapshots === undefined
          ? false
          : json.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH
              .useCalculatedVersionForSnapshots
    }
  };
  return config;
};

let fakePackage = {
  dir: "",
  packageJson: {
    name: "",
    version: ""
  }
};

export let defaultConfig = parse(defaultWrittenConfig, {
  root: fakePackage,
  tool: "root",
  packages: [fakePackage]
});
