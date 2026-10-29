import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nativeSha256 } from "./android-native";

export function patchAndroidObjectStore(upstream: string, destination: string, helper: string, platform: "android" | "termux" = "android") {
  const path = join(destination, "src/local.rs");
  let source = readFileSync(join(upstream, "src/local.rs"), "utf8");
  const version = (Bun.TOML.parse(readFileSync(join(upstream, "Cargo.toml"), "utf8")) as { package: { version: string } }).package.version;
  if (version !== "0.13.2" && version !== "0.14.2") throw new Error(`Unsupported object_store version: ${version}`);
  const durable = version === "0.14.2";
  // The Termux addon runs as GNU/Linux through grun or PRoot. Its private
  // patched crates need the same atomic publication on target_os = "linux".
  const targetOs = platform === "termux" ? "linux" : "android";
  // Exact pinned source; never patch a different object_store release silently.
  if ((source.match(/std::fs::hard_link\(/g) || []).length !== (durable ? 2 : 3)) throw new Error("Unexpected object_store hard-link implementation");
  source = source.replaceAll("std::fs::hard_link(", "platform_atomic_link(");
  const old = source.match(/            \/\/ fall-back to copy & delete\n            RenameTargetMode::Create => \{[\s\S]*?\n            \}/)?.[0];
  if (!old || !old.includes("self.copy_opts(") || !old.includes(durable ? "Self::delete_location(config, automatic_cleanup, &from, fsync)" : "self.delete(from).await?"))
    throw new Error("Unexpected object_store rename implementation");
  // Retain the exact upstream implementation on other targets, including
  // 0.14's file closing, directory fsync, and automatic directory cleanup.
  const fallback = old.slice(old.indexOf("{") + 1, old.lastIndexOf("}"));
  const replacement = `            RenameTargetMode::Create => {
                #[cfg(target_os = "${targetOs}")]
                {
                    let _ = extensions;
                    let from = self.path_to_filesystem(from)?;
                    let to = self.path_to_filesystem(to)?;
                    ${durable ? "let fsync = self.fsync;" : ""}
                    maybe_spawn_blocking(move || {
                        loop {
                            match android_rename_noreplace(&from, &to) {
                                Ok(_) => {
                                    ${durable ? `if fsync {
                                        fsync_parent_dir(&to).map_err(|source| Error::UnableToSyncFile { path: to.clone(), source })?;
                                        if from.parent() != to.parent() {
                                            fsync_parent_dir(&from).map_err(|source| Error::UnableToSyncFile { path: from.clone(), source })?;
                                        }
                                    }` : ""}
                                    return Ok(());
                                }
                                Err(source) => match source.kind() {
                                    ErrorKind::AlreadyExists => return Err(Error::AlreadyExists {
                                        path: to.to_string_lossy().into_owned(), source,
                                    }.into()),
                                    ErrorKind::NotFound => match from.exists() {
                                        true => create_parent_dirs(&to, source${durable ? ", fsync" : ""})?,
                                        false => return Err(Error::NotFound { path: from, source }.into()),
                                    },
                                    _ => return Err(Error::UnableToCopyFile { from, to, source }.into()),
                                },
                            }
                        }
                    }).await
                }
                #[cfg(not(target_os = "${targetOs}"))]
                {${fallback}
                }
            }`;
  const helperSource = readFileSync(helper, "utf8").replaceAll('target_os = "android"', `target_os = "${targetOs}"`);
  source = source.replace(old, replacement) + "\n" + helperSource;
  if (!existsSync(path) || readFileSync(path, "utf8") !== source) {
    cpSync(upstream, destination, { recursive: true });
    writeFileSync(path, source);
  }
  return nativeSha256(Buffer.from(source));
}
