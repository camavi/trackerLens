// Core-owned Custom Node package import/review UI. Package code is never loaded here.
window.TrackerLensCustomNodePackages = (() => {
  let installed = [];
  const bridge = () => window.trackers?.desktop?.customNodePackages || null;
  const isAvailable = () => Boolean(bridge()?.inspect && bridge()?.install && bridge()?.list);
  const declaredPermissions = (permissions = {}) => Object.entries(permissions || {})
    .filter(([, value]) => Boolean(value) && value !== "none")
    .map(([key, value]) => value === true ? `custom.${key}` : `custom.${key}.${value}`);
  const paletteItem = (pkg = {}) => {
    const manifest = pkg.manifest || {};
    return {
      label: pkg.name || manifest.name || pkg.packageId || "Custom Node",
      icon: manifest.icon || "extension",
      tone: "gold",
      nodeType: "custom",
      subtype: pkg.subtype || manifest.subtype || pkg.packageId || "custom-package",
      category: "custom-packages",
      inputs: manifest.inputs || [],
      outputs: manifest.outputs || [],
      // This is a normalized display/graph permission list. The original
      // declared object stays in metadata below for the review surface.
      permissions: declaredPermissions(pkg.permissions || manifest.permissions),
      settingsSchema: manifest.ui?.settingsSchema || manifest.settingsSchema || {},
      runtime: { execution: "blocked", installState: pkg.installState || "manifest-only" },
      manifest: { ...manifest, permissions: declaredPermissions(pkg.permissions || manifest.permissions) },
      customPackage: {
        packageId: pkg.packageId,
        version: pkg.version,
        archive: pkg.archive || {},
        trustLevel: pkg.trustLevel || "local-dev",
        installState: pkg.installState || "manifest-only",
        runtimeExecution: "blocked",
        declaredPermissions: pkg.permissions || manifest.permissions || {},
      },
      connectionType: "Custom package · runtime blocked",
      runtimeBlocked: true,
    };
  };
  const notifyPaletteChanged = () => window.dispatchEvent(new CustomEvent("trackers-custom-node-packages-updated"));
  const refreshInstalled = async () => {
    if (!isAvailable()) { installed = []; return installed; }
    installed = await bridge().list().catch(() => []);
    notifyPaletteChanged();
    return installed;
  };
  const paletteGroups = () => installed.length ? [["Custom Packages", installed.map(paletteItem)]] : [];
  const permissionText = (permissions = {}) => [
    permissions.network ? "network" : null,
    permissions.filesystem ? "filesystem" : null,
    permissions.aiProvider ? "AI provider" : null,
    permissions.memory ? "memory" : null,
    permissions.runtimeGraph && permissions.runtimeGraph !== "none" ? `runtime graph: ${permissions.runtimeGraph}` : null,
  ].filter(Boolean);
  const summary = (pkg = {}) => {
    const manifest = pkg.manifest || {};
    const permissions = permissionText(pkg.permissions || manifest.permissions || {});
    return _.article(
      { class: "tl-flow-package-card" },
      _.div({ class: "tl-flow-package-card-title" }, icon(manifest.icon || "extension", "sm"), _.strong(pkg.name || manifest.name || pkg.packageId), _.span(`${pkg.version || manifest.version || ""}`)),
      _.p(`${pkg.publisher || manifest.publisher || "Local package"} · ${pkg.category || manifest.category || "custom"}`),
      _.p({ class: "tl-flow-package-card-state" }, `Trust: ${pkg.trustLevel || "local-dev"} · Runtime: blocked`),
      _.p(permissions.length ? `Permessi dichiarati: ${permissions.join(", ")}` : "Nessun permesso dichiarato."),
      _.p(`${(pkg.files || []).length} file · SHA-256 ${pkg.archive?.sha256 || pkg.archiveSha256 || ""}`)
    );
  };
  const openDialog = async () => {
    if (!isAvailable()) return CMSwift.notify?.error?.("L'import Custom Node è disponibile solo nell'app desktop.");
    let packages = await refreshInstalled();
    let review = null;
    let busy = false;
    let dialog = null;
    const render = () => _.div(
      { class: "tl-flow-package-dialog-body" },
      _.p("Importa un archivio .tl-node.zip. Il manifest e i permessi vengono revisionati prima della copia; runtime.js resta bloccato."),
      review ? _.section({ class: "tl-flow-package-review" }, _.h3("Revisione import"), summary(review), _.div({ class: "tl-flow-package-actions" },
        btn({ class: "st-btn-primary", disabled: busy, onclick: async () => {
          busy = true; refresh();
          try { await bridge().install({ importId: review.importId }); review = null; packages = await refreshInstalled(); CMSwift.notify?.success?.("Custom Node importato: aggiungilo dalla palette, runtime bloccato."); }
          catch (error) { CMSwift.notify?.error?.(error?.message || "Import non riuscito."); }
          finally { busy = false; refresh(); }
        } }, icon("archive", "sm"), busy ? "Importazione…" : "Importa pacchetto"),
        btn({ disabled: busy, onclick: () => { review = null; refresh(); } }, "Annulla")
      )) : _.div({ class: "tl-flow-package-actions" }, btn({ class: "st-btn-primary", disabled: busy, onclick: async () => {
        busy = true; refresh();
        try { const result = await bridge().inspect(); if (!result?.cancelled) review = result; }
        catch (error) { CMSwift.notify?.error?.(error?.message || "Archivio non valido."); }
        finally { busy = false; refresh(); }
      } }, icon("upload_file", "sm"), busy ? "Lettura…" : "Scegli .tl-node.zip")),
      _.hr(), _.h3("Pacchetti installati"), packages.length ? _.div({ class: "tl-flow-package-list" }, ...packages.map(summary)) : _.p("Nessun Custom Node installato.")
    );
    const refresh = () => {
      const host = document.querySelector("[data-custom-node-package-dialog]");
      if (host) host.replaceWith(_.div({ "data-custom-node-package-dialog": "true" }, render()));
    };
    dialog = _.Dialog({
      class: "tl-flow-package-dialog",
      title: "Custom Node Packages",
      subtitle: "Manifest-only import · codice runtime disabilitato",
      content: () => _.div({ "data-custom-node-package-dialog": "true" }, render()),
      footer: () => btn({ onclick: () => dialog?.close?.() }, "Chiudi")
    });
    dialog.open();
  };
  if (isAvailable()) refreshInstalled();
  return Object.freeze({ isAvailable, openDialog, paletteGroups, refreshInstalled });
})();
